"""The only writer of the corporate store.

Everything durable about an event — the event record, its change log and the
private links — is written here and nowhere else.  Every write is atomic: a
temp file beside the real one, flushed to the disk, then renamed over the top.
A write interrupted half way leaves the temp file behind and the last complete
file still wins, because nothing ever reads a temp file.

One lock per event.  The server is one process, so an in-process lock is the
whole story; a second process would need a file lock.
# ponytail: threading.Lock per event, one process. File locks if it ever forks.
"""

import json
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import rules

HERE = Path(__file__).resolve().parent
STORE_DIRNAME = "data"
EVENTS_DIRNAME = "events"
CHANGES_DIRNAME = "changes"
ACCESS_FILENAME = "access.json"
TEMP_PREFIX = ".tmp-"

_EVENT_ID = re.compile(r"^ev_[0-9a-f]{10}$")
_TOKEN = re.compile(r"^[0-9a-f]{32}$")

_locks = {}
_locks_guard = threading.Lock()


# ------------------------------------------------------------------- plumbing

def root():
    """Where the store lives.  CORP_DATA lets a test own a private folder."""
    override = os.environ.get("CORP_DATA")
    return Path(override).resolve() if override else HERE / STORE_DIRNAME


def events_dir():
    return root() / EVENTS_DIRNAME


def changes_dir():
    return root() / CHANGES_DIRNAME


def load_questions():
    return json.loads((HERE / "questions.json").read_text(encoding="utf-8"))


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lock_for(event_id):
    with _locks_guard:
        return _locks.setdefault(event_id, threading.Lock())


def _ensure():
    events_dir().mkdir(parents=True, exist_ok=True)
    changes_dir().mkdir(parents=True, exist_ok=True)


def _safe(event_id):
    """An event id is minted by us and is never text somebody typed."""
    if not _EVENT_ID.match(str(event_id or "")):
        raise ValueError("that is not an event id we minted: %r" % (event_id,))
    path = (events_dir() / (event_id + ".json")).resolve()
    if path.parent != events_dir().resolve():
        raise ValueError("that event id tried to leave the store")
    return path


def _changes_path(event_id):
    _safe(event_id)
    path = (changes_dir() / (event_id + ".jsonl")).resolve()
    if path.parent != changes_dir().resolve():
        raise ValueError("that event id tried to leave the store")
    return path


def _write_json(path, obj):
    """Temp file in the same folder, flushed, then renamed over the real one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(prefix=TEMP_PREFIX, suffix=".json",
                                    dir=str(path.parent))
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(obj, out, indent=2, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise
    folder = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(folder)
    finally:
        os.close(folder)


def _read_json(path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback
    except OSError as problem:
        raise RuntimeError("cannot read %s: %s" % (path.name, problem))


def _append_changes(event_id, lines):
    path = _changes_path(event_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as out:
        for line in lines:
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
        out.flush()
        os.fsync(out.fileno())


# --------------------------------------------------------------------- events

def load_event(event_id):
    return _read_json(_safe(event_id))


def list_events():
    folder = events_dir()
    if not folder.exists():
        return []
    out = []
    # The glob is the whole guard: a half-written file is named with the temp
    # prefix and never begins "ev_", so nothing here can read one.  A second
    # check on the name would be a twin covering for this one, and a twin that
    # can be broken alone while its partner keeps the test green is a hole.
    for path in sorted(folder.glob("ev_*.json")):
        record = _read_json(path)
        if record:
            out.append(record)
    return out


def _blank_answer():
    return {"value": None, "state": "blank", "supplied_by": None,
            "supplied_at": None, "source": "form", "approved_by": None,
            "approved_at": None, "previous": None, "proposal": None}


def create_event(name, company, date, tz, people=(), actor="p_miles",
                 origin="dj-edit", stage="draft"):
    _ensure()
    event_id = "ev_" + secrets.token_hex(5)
    while _safe(event_id).exists():
        event_id = "ev_" + secrets.token_hex(5)
    stamp = now()
    questions = load_questions()
    answers = {}
    for question in questions["questions"]:
        answers[question["id"]] = _blank_answer()
        if question.get("default") is not None:
            answers[question["id"]].update(
                {"value": question["default"], "state": "confirmed",
                 "source": "form", "supplied_at": stamp})
    for qid, value in (("event_name", name), ("company", company),
                       ("event_date", date), ("tz", tz)):
        if value:
            answers[qid].update({"value": value, "state": "confirmed",
                                 "source": "dj", "supplied_by": actor,
                                 "supplied_at": stamp})
    event = {
        "event_id": event_id, "revision": 1, "created_at": stamp,
        "updated_at": stamp, "stage": stage, "submitted_at": None,
        "tz": tz or "America/Los_Angeles", "answers": answers,
        "people": [dict(p) for p in people], "moments": [], "songs": [],
        "open_items": [], "sources": [], "dj_notes": "",
        "receipts": {}, "next_action": "",
    }
    event["next_action"] = rules.next_action(event)
    with _lock_for(event_id):
        _write_json(_safe(event_id), event)
        _append_changes(event_id, [{
            "change_id": "ch_" + secrets.token_hex(6), "event_id": event_id,
            "revision": 1, "at": stamp, "actor": actor, "role": "dj",
            "origin": origin, "field": "event", "before": None,
            "after": {"name": name, "company": company, "date": date, "tz": tz},
            "affected": [], "decision_required": False,
            "resolved_by": None, "resolved_at": None, "submission_id": None,
        }])
    return event


# ------------------------------------------------------------- field flatteners

def _answer_pair(answer):
    return {"value": answer.get("value"), "state": answer.get("state")}


def current_fields(event, touched):
    """The event's value for each field the caller touched."""
    out = {}
    moments = {m.get("moment_id"): m for m in event.get("moments") or []}
    for field in touched:
        if field.startswith("answers."):
            answer = (event.get("answers") or {}).get(field.split(".", 1)[1])
            out[field] = _answer_pair(answer) if answer else None
        elif field.startswith("moments."):
            _, mid, attr = field.split(".", 2)
            moment = moments.get(mid)
            out[field] = moment.get(attr) if moment else None
        elif field == "people":
            out[field] = event.get("people")
    return out


def _touched_fields(payload):
    fields = {}
    for qid, answer in (payload.get("answers") or {}).items():
        fields["answers." + qid] = {"value": answer.get("value"),
                                    "state": answer.get("state", "confirmed")}
    for moment in payload.get("moments") or []:
        mid = moment.get("moment_id")
        if not mid:
            continue
        for attr, value in moment.items():
            if attr in ("moment_id", "previous", "proposal"):
                continue
            fields["moments.%s.%s" % (mid, attr)] = value
    if payload.get("people") is not None:
        fields["people"] = payload["people"]
    return fields


def _changed_since(event_id, base_revision):
    """What the base revision held, for every field touched since."""
    was, who = {}, {}
    for line in read_changes(event_id):
        if line.get("revision", 0) > base_revision:
            field = line.get("field")
            if field not in was:
                was[field] = line.get("before")
            who[field] = (line.get("actor"), line.get("at"))
    return was, who


def read_changes(event_id):
    path = _changes_path(event_id)
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def changes_since(event_id, since):
    return [c for c in read_changes(event_id) if c.get("revision", 0) > int(since)]


# ----------------------------------------------------------------- the save door

def _label_for(field, questions):
    if field.startswith("answers."):
        qid = field.split(".", 1)[1]
        for question in questions:
            if question["id"] == qid:
                return question["label"]
        return qid
    return field


def _person_name(event, person_id):
    for person in event.get("people") or []:
        if person.get("person_id") == person_id:
            return person.get("name")
    return "Miles" if person_id == "p_miles" else person_id


def save(event_id, actor, role, payload, questions=None):
    """CONTRACT.md section 7, steps 2 to 6, in that order, under one lock.

    Returns (status_code, body).  Step 1 (token to event and role) is the
    server's; by the time we are called the caller is known.
    """
    questions = questions or load_questions()["questions"]
    with _lock_for(event_id):
        event = load_event(event_id)
        if event is None:
            return 404, {"ok": False, "error": "no-such-event"}

        # 2. repeat send
        submission_id = payload.get("submission_id") or ""
        receipts = event.setdefault("receipts", {})
        if submission_id and submission_id in receipts:
            kept = receipts[submission_id]
            return 200, {"ok": True, "revision": kept["revision"], "receipt": kept,
                         "duplicate": True, "proposed": [],
                         "effects": {"open_items_added": [], "open_items_closed": [],
                                     "cues_to_recheck": [],
                                     "coverage": rules.coverage(event)}}

        touched = _touched_fields(payload)
        base_revision = payload.get("base_revision", event["revision"])
        current = current_fields(event, touched)

        # 3. stale base
        conflicts = []
        if base_revision != event["revision"]:
            was, who = _changed_since(event_id, base_revision)
            base = {f: was.get(f, current.get(f)) for f in touched}
            merged, raw = rules.three_way(base, current, touched)
            if raw:
                for clash in raw:
                    actor_id, when = who.get(clash["field"], (None, None))
                    conflicts.append({
                        "field": clash["field"],
                        "label": _label_for(clash["field"], questions),
                        "yours": clash["yours"], "theirs": clash["theirs"],
                        "theirs_by": _person_name(event, actor_id),
                        "theirs_at": when})
                return 409, {"ok": False, "error": "conflict",
                             "current_revision": event["revision"],
                             "conflicts": conflicts, "merged": merged}
            touched = merged

        # 4. ownership
        proposed, applied = [], {}
        people = event.get("people") or []
        qmap = {q["id"]: q for q in questions}
        for field, value in touched.items():
            try:
                group = rules.owner_of(field, questions)
            except KeyError as unknown:
                return 422, {"ok": False, "error": "invalid",
                             "errors": [{"field": field, "message": str(unknown)}]}
            if rules.may_confirm(group, role, people):
                applied[field] = value
            else:
                proposed.append(field)

        # 5. validation, on the record the save would leave behind
        prospective = json.loads(json.dumps(event))
        _apply_fields(prospective, applied, actor, role, stamp=now(), dry=True)
        errors = rules.validate(questions, prospective, bool(payload.get("submit")))
        if errors:
            return 422, {"ok": False, "error": "invalid", "errors": errors}

        # 6. apply
        before = json.loads(json.dumps(event))
        stamp = now()
        lines = _apply_fields(event, applied, actor, role, stamp=stamp, dry=False)
        for field in proposed:
            _apply_proposal(event, field, touched[field], actor, stamp)
        effects = rules.effects(before, event, questions)
        for item in effects["open_items_added"]:
            event["open_items"].append(item)
        if payload.get("submit"):
            event["submitted_at"] = stamp
            event["stage"] = "waiting"
        event["revision"] += 1
        event["updated_at"] = stamp
        event["next_action"] = rules.next_action(event)

        origin = "form-submit" if payload.get("submit") else (
            "dj-edit" if role == "dj" else "client-edit")
        log = []
        for line in lines:
            line.update({"event_id": event_id, "revision": event["revision"],
                         "at": stamp, "actor": actor, "role": role,
                         "origin": origin, "submission_id": submission_id,
                         "affected": effects["cues_to_recheck"],
                         "resolved_by": None, "resolved_at": None})
            log.append(line)
        for field in proposed:
            log.append({"change_id": "ch_" + secrets.token_hex(6),
                        "event_id": event_id, "revision": event["revision"],
                        "at": stamp, "actor": actor, "role": role,
                        "origin": "proposal", "field": field,
                        "before": current.get(field), "after": touched[field],
                        "affected": [], "decision_required": True,
                        "resolved_by": None, "resolved_at": None,
                        "submission_id": submission_id})

        receipt = {"event_id": event_id, "revision": event["revision"],
                   "saved_at": stamp, "submission_id": submission_id,
                   "name": _event_name(event)}
        if submission_id:
            event["receipts"][submission_id] = receipt

        _write_json(_safe(event_id), event)
        if log:
            _append_changes(event_id, log)
        return 200, {"ok": True, "revision": event["revision"], "receipt": receipt,
                     "proposed": proposed,
                     "effects": {
                         "open_items_added": [i["item_id"] for i in effects["open_items_added"]],
                         "open_items_closed": effects["open_items_closed"],
                         "cues_to_recheck": effects["cues_to_recheck"],
                         "coverage": effects["coverage"]}}


def _event_name(event):
    answers = event.get("answers") or {}
    for qid in ("event_name", "company"):
        value = (answers.get(qid) or {}).get("value")
        if value:
            return value
    return event["event_id"]


def _apply_fields(event, applied, actor, role, stamp, dry):
    """Write the accepted fields onto the record, keeping what was there before."""
    lines = []
    moments = {m.get("moment_id"): m for m in event.setdefault("moments", [])}
    for field, value in applied.items():
        if field.startswith("answers."):
            qid = field.split(".", 1)[1]
            answer = event.setdefault("answers", {}).setdefault(qid, _blank_answer())
            before = _answer_pair(answer)
            after = {"value": value.get("value"), "state": value.get("state")}
            if before == after:
                continue
            if not dry:
                answer["previous"] = {"value": answer.get("value"),
                                      "state": answer.get("state"),
                                      "supplied_by": answer.get("supplied_by"),
                                      "supplied_at": answer.get("supplied_at")}
            answer["value"] = after["value"]
            answer["state"] = after["state"]
            answer["supplied_by"] = actor
            answer["supplied_at"] = stamp
            answer["source"] = "dj" if role == "dj" else "form"
            if after["state"] == "confirmed":
                answer["approved_by"] = actor
                answer["approved_at"] = stamp
            lines.append({"change_id": "ch_" + secrets.token_hex(6), "field": field,
                          "before": before, "after": after,
                          "decision_required": False})
        elif field.startswith("moments."):
            _, mid, attr = field.split(".", 2)
            moment = moments.get(mid)
            if moment is None:
                moment = {"moment_id": mid, "kind": "custom", "label": mid,
                          "date": None, "start": None, "end": None,
                          "duration_min": 0, "purpose": "", "room": "",
                          "music_owner": "dj", "cue_owner": "planner",
                          "cue_text": "", "pronunciation": "",
                          "approval": "draft", "active": True,
                          "previous": None, "proposal": None}
                event["moments"].append(moment)
                moments[mid] = moment
            before = moment.get(attr)
            if before == value:
                continue
            if not dry:
                keep = moment.get("previous") or {}
                keep[attr] = before
                moment["previous"] = keep
            moment[attr] = value
            lines.append({"change_id": "ch_" + secrets.token_hex(6), "field": field,
                          "before": before, "after": value,
                          "decision_required": False})
        elif field == "people":
            before = event.get("people")
            if before == value:
                continue
            event["people"] = value
            lines.append({"change_id": "ch_" + secrets.token_hex(6), "field": "people",
                          "before": before, "after": value,
                          "decision_required": False})
    return lines


def _apply_proposal(event, field, value, actor, stamp):
    proposal = {"by": actor, "at": stamp, "note": ""}
    if field.startswith("answers."):
        qid = field.split(".", 1)[1]
        answer = event.setdefault("answers", {}).setdefault(qid, _blank_answer())
        proposal.update({"value": value.get("value"), "state": value.get("state")})
        answer["proposal"] = proposal
    elif field.startswith("moments."):
        _, mid, attr = field.split(".", 2)
        for moment in event.get("moments") or []:
            if moment.get("moment_id") == mid:
                keep = moment.get("proposal") or dict(proposal)
                keep.update({attr: value, "by": actor, "at": stamp})
                moment["proposal"] = keep
    elif field == "people":
        event.setdefault("pending_people", []).append(
            {"people": value, "by": actor, "at": stamp})


# ------------------------------------------------------------------- resolving

def resolve(event_id, actor, role, field, take, submission_id="", questions=None):
    questions = questions or load_questions()["questions"]
    with _lock_for(event_id):
        event = load_event(event_id)
        if event is None:
            return 404, {"ok": False, "error": "no-such-event"}
        if submission_id and submission_id in event.setdefault("receipts", {}):
            kept = event["receipts"][submission_id]
            return 200, {"ok": True, "revision": kept["revision"], "duplicate": True}
        try:
            group = rules.owner_of(field, questions)
        except KeyError as unknown:
            return 422, {"ok": False, "error": "invalid",
                         "errors": [{"field": field, "message": str(unknown)}]}
        if not rules.may_confirm(group, role, event.get("people") or []):
            return 403, {"ok": False, "error": "not-your-decision"}
        stamp = now()
        proposal = _pull_proposal(event, field)
        if proposal is None:
            return 422, {"ok": False, "error": "invalid",
                         "errors": [{"field": field, "message": "Nothing is proposed there."}]}
        before = json.loads(json.dumps(event))
        change = None
        if take == "proposal":
            applied = {field: ({"value": proposal.get("value"),
                                "state": proposal.get("state")}
                               if field.startswith("answers.") else
                               proposal.get(field.split(".", 2)[2]))}
            lines = _apply_fields(event, applied, actor, role, stamp, dry=False)
            change = lines[0] if lines else None
        effects = rules.effects(before, event, questions)
        for item in effects["open_items_added"]:
            event["open_items"].append(item)
        event["revision"] += 1
        event["updated_at"] = stamp
        event["next_action"] = rules.next_action(event)
        line = change or {"change_id": "ch_" + secrets.token_hex(6), "field": field,
                          "before": None, "after": None}
        line.update({"event_id": event_id, "revision": event["revision"], "at": stamp,
                     "actor": actor, "role": role, "origin": "resolve",
                     "affected": effects["cues_to_recheck"], "decision_required": False,
                     "resolved_by": actor, "resolved_at": stamp,
                     "submission_id": submission_id})
        receipt = {"event_id": event_id, "revision": event["revision"],
                   "saved_at": stamp, "submission_id": submission_id,
                   "name": _event_name(event)}
        if submission_id:
            event["receipts"][submission_id] = receipt
        _write_json(_safe(event_id), event)
        _append_changes(event_id, [line])
        return 200, {"ok": True, "revision": event["revision"], "took": take}


def _pull_proposal(event, field):
    if field.startswith("answers."):
        answer = (event.get("answers") or {}).get(field.split(".", 1)[1]) or {}
        proposal = answer.get("proposal")
        answer["proposal"] = None
        return proposal
    if field.startswith("moments."):
        _, mid, attr = field.split(".", 2)
        for moment in event.get("moments") or []:
            if moment.get("moment_id") == mid:
                proposal = moment.get("proposal")
                if proposal and attr in proposal:
                    moment["proposal"] = None
                    return proposal
    return None


def set_open_item(event_id, actor, role, item_id, resolved, answer="",
                  submission_id=""):
    with _lock_for(event_id):
        event = load_event(event_id)
        if event is None:
            return 404, {"ok": False, "error": "no-such-event"}
        if submission_id and submission_id in event.setdefault("receipts", {}):
            kept = event["receipts"][submission_id]
            return 200, {"ok": True, "revision": kept["revision"], "duplicate": True}
        stamp = now()
        found = None
        for item in event.get("open_items") or []:
            if item.get("item_id") == item_id:
                found = item
                break
        if found is None:
            return 404, {"ok": False, "error": "no-such-item"}
        before = dict(found)
        found["resolved"] = bool(resolved)
        found["resolved_by"] = actor if resolved else None
        found["resolved_at"] = stamp if resolved else None
        if answer:
            found["answer"] = answer
        event["revision"] += 1
        event["updated_at"] = stamp
        event["next_action"] = rules.next_action(event)
        receipt = {"event_id": event_id, "revision": event["revision"],
                   "saved_at": stamp, "submission_id": submission_id,
                   "name": _event_name(event)}
        if submission_id:
            event["receipts"][submission_id] = receipt
        _write_json(_safe(event_id), event)
        _append_changes(event_id, [{
            "change_id": "ch_" + secrets.token_hex(6), "event_id": event_id,
            "revision": event["revision"], "at": stamp, "actor": actor,
            "role": role, "origin": "resolve", "field": "open_items." + item_id,
            "before": before.get("resolved"), "after": bool(resolved),
            "affected": before.get("moments") or [], "decision_required": False,
            "resolved_by": actor if resolved else None,
            "resolved_at": stamp if resolved else None,
            "submission_id": submission_id}])
        return 200, {"ok": True, "revision": event["revision"]}


# ------------------------------------------------------------- what Miles read

def set_seen(event_id, revision):
    """Remember how far Miles has read this event's changes.

    Two things this must never do.  It must never move PAST where the event
    actually is: a bookmark ahead of the record hides changes he has not read.
    And it must never move BACK: an older number coming in late (a second
    window, a stale page) would put changes he has already read in front of him
    again.  So the number kept is the one he asked for, held down to the event's
    own revision and held up to the one already remembered.

    This is a bookmark, not a change to the event: nothing is logged and the
    revision does not move.
    """
    if not _EVENT_ID.match(str(event_id or "")):
        return 404, {"ok": False, "error": "no-such-event"}
    try:
        wanted = int(revision)
    except (TypeError, ValueError):
        return 422, {"ok": False, "error": "invalid",
                     "errors": [{"field": "revision",
                                 "message": "That is not a revision number."}]}
    with _lock_for(event_id):
        event = load_event(event_id)
        if event is None:
            return 404, {"ok": False, "error": "no-such-event"}
        standing = int(event.get("dj_seen_revision") or 0)
        wanted = min(wanted, int(event.get("revision") or 0))
        wanted = max(wanted, standing)
        if wanted != standing:
            event["dj_seen_revision"] = wanted
            _write_json(_safe(event_id), event)
        return 200, {"ok": True, "dj_seen_revision": wanted}


# ---------------------------------------------------------------------- access

_ACCESS_LOCK = threading.Lock()


def _access_path():
    return root() / ACCESS_FILENAME


def _load_access():
    return _read_json(_access_path(), {"tokens": {}, "dj_token": None}) or \
        {"tokens": {}, "dj_token": None}


def access(op, **kw):
    """mint / revoke / lookup / dj — the private links, and who they are.

    A link we cannot read is refused in words, never waved through.
    """
    if op == "lookup":
        token = str(kw.get("token") or "")
        if not _TOKEN.match(token):
            return {"ok": False, "error": "link-expired"}
        book = _load_access()
        if token == book.get("dj_token"):
            return {"ok": True, "event_id": None, "person_id": "p_miles",
                    "role": "dj", "expires_at": None}
        grant = (book.get("tokens") or {}).get(token)
        if not grant:
            return {"ok": False, "error": "link-expired"}
        if grant.get("revoked_at"):
            return {"ok": False, "error": "link-expired"}
        expires = grant.get("expires_at")
        if expires and expires <= now():
            return {"ok": False, "error": "link-expired"}
        return {"ok": True, "event_id": grant.get("event_id"),
                "person_id": grant.get("person_id"), "role": grant.get("role"),
                "expires_at": expires}

    with _ACCESS_LOCK:
        _ensure()
        book = _load_access()
        if op == "mint":
            token = secrets.token_hex(16)
            book.setdefault("tokens", {})[token] = {
                "event_id": kw["event_id"], "person_id": kw["person_id"],
                "role": kw["role"], "created_at": now(),
                "expires_at": kw.get("expires_at"), "revoked_at": None}
            _write_json(_access_path(), book)
            return {"ok": True, "token": token, "link": "/c/" + token}
        if op == "revoke":
            token = str(kw.get("token") or "")
            grant = (book.get("tokens") or {}).get(token)
            if not grant:
                return {"ok": False, "error": "link-expired"}
            grant["revoked_at"] = now()
            _write_json(_access_path(), book)
            return {"ok": True}
        if op == "dj":
            if not book.get("dj_token"):
                book["dj_token"] = secrets.token_hex(16)
                _write_json(_access_path(), book)
            return {"ok": True, "token": book["dj_token"], "link": "/dj/"}
        if op == "all":
            return book
    raise ValueError("no such access operation: %r" % (op,))


# ------------------------------------------------------------------ seeding

def wipe():
    """Empty the store.  Refuses anything that is not plainly our own folder."""
    folder = root()
    if not folder.exists():
        _ensure()
        return
    ours = {EVENTS_DIRNAME, CHANGES_DIRNAME, ACCESS_FILENAME}
    strangers = [p.name for p in folder.iterdir()
                 if p.name not in ours and not p.name.startswith(TEMP_PREFIX)]
    if strangers:
        raise RuntimeError(
            "refusing to empty %s — it holds things this tool did not make: %s"
            % (folder, ", ".join(sorted(strangers))))
    import shutil
    shutil.rmtree(folder)
    _ensure()


def seed_apply(event_id, moments=None, proposals=(), dj_notes=None, stage=None,
               actor="p_miles", questions=None):
    """Write fixture state onto an event.  Used by seed.py and nothing else."""
    questions = questions or load_questions()["questions"]
    with _lock_for(event_id):
        event = load_event(event_id)
        if event is None:
            return 404, {"ok": False, "error": "no-such-event"}
        before = json.loads(json.dumps(event))
        stamp = now()
        if moments is not None:
            event["moments"] = [dict(m) for m in moments]
        if dj_notes is not None:
            event["dj_notes"] = dj_notes
        if stage:
            event["stage"] = stage
        for proposal in proposals:
            field = proposal["field"]
            _, mid, attr = field.split(".", 2)
            for moment in event["moments"]:
                if moment.get("moment_id") == mid:
                    keep = moment.get("proposal") or {}
                    keep.update({attr: proposal["value"], "by": proposal["by"],
                                 "at": stamp})
                    moment["proposal"] = keep
        effects = rules.effects(before, event, questions)
        for item in effects["open_items_added"]:
            event["open_items"].append(item)
        event["revision"] += 1
        event["updated_at"] = stamp
        event["next_action"] = rules.next_action(event)
        _write_json(_safe(event_id), event)
        _append_changes(event_id, [{
            "change_id": "ch_" + secrets.token_hex(6), "event_id": event_id,
            "revision": event["revision"], "at": stamp, "actor": actor,
            "role": "dj", "origin": "seed", "field": "event",
            "before": None, "after": "fixture loaded",
            "affected": effects["cues_to_recheck"], "decision_required": False,
            "resolved_by": None, "resolved_at": None, "submission_id": None}])
        return 200, {"ok": True, "revision": event["revision"],
                     "open_items_added": [i["item_id"] for i in effects["open_items_added"]]}
