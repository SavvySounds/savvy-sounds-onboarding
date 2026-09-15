"""Pure rules for corporate onboarding.

No file reads, no file writes, no clock of its own: everything it needs comes
in as arguments so the same call always gives the same answer.  The words in
here are the words in CONTRACT.md; nothing invents a second spelling.
"""

import re
from datetime import date as _date

STATES = ("blank", "none", "unknown", "miles", "confirmed")
ROLES = ("approver", "contact", "planner", "production", "dj")
MOMENT_KINDS = ("arrival", "networking", "dinner", "presentations",
                "awards", "dancing", "closing", "custom")
MOMENT_APPROVAL = ("draft", "proposed", "confirmed")
STAGES = ("draft", "waiting", "preparing", "review", "ready", "completed")
ORIGINS = ("form-draft", "form-submit", "client-edit", "dj-edit",
           "proposal", "resolve", "seed")

# CONTRACT.md section 2: which role owns each answer group.
OWNER_ROLE = {
    "direction": "approver",
    "running_order": "planner",
    "production": "production",
    "prep": "dj",
    "event": "approver",
}
# Fallback when nobody on the event holds that role.
OWNER_FALLBACK = {"running_order": "approver", "production": "approver"}

# Which answer group owns each attribute of a moment.
MOMENT_FIELD_OWNER = {
    "date": "running_order", "start": "running_order", "end": "running_order",
    "duration_min": "running_order", "label": "running_order",
    "kind": "running_order", "approval": "running_order",
    "active": "running_order", "purpose": "running_order",
    "room": "running_order", "order": "running_order",
    "cue_text": "running_order", "pronunciation": "running_order",
    "cue_owner": "running_order",
    "music_owner": "prep",
}

# Answers that hold songs a client asked for, matched against the exclusions.
REQUEST_QIDS = ("requests", "must_plays", "dancing_opener",
                "dancing_closer", "awards_walkon")
EXCLUSION_QID = "dnp_songs"

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_YMD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SLUG = re.compile(r"[^a-z0-9]+")


# ---------------------------------------------------------------- small tools

def slug(text):
    return _SLUG.sub("-", str(text).lower()).strip("-")[:40] or "x"


def hhmm_to_min(value):
    hh, mm = str(value).split(":")
    return int(hh) * 60 + int(mm)


def ymd_to_ord(value):
    y, m, d = str(value).split("-")
    return _date(int(y), int(m), int(d)).toordinal()


def span_min(moment):
    """Minutes a moment lasts.  An end earlier than its start is the next day."""
    start, end = moment.get("start"), moment.get("end")
    if start and end and _HHMM.match(str(start)) and _HHMM.match(str(end)):
        return (hhmm_to_min(end) - hhmm_to_min(start)) % 1440
    return int(moment.get("duration_min") or 0)


def abs_start(moment):
    """Minutes since the year zero, so moments on two days sort correctly."""
    if not (moment.get("date") and moment.get("start")):
        return None
    if not (_YMD.match(str(moment["date"])) and _HHMM.match(str(moment["start"]))):
        return None
    return ymd_to_ord(moment["date"]) * 1440 + hhmm_to_min(moment["start"])


def placed(moments):
    """Active moments that have a date and a start, in time order."""
    out = [m for m in moments if m.get("active", True) and abs_start(m) is not None]
    out.sort(key=abs_start)
    return out


# ---------------------------------------------------------------- who decides

def owner_of(target, questions=()):
    """The answer group that owns a question record or a field path.

    target: a question dict, or 'answers.<qid>', 'moments.<mid>.<attr>',
            'moments.<mid>', 'people', 'event'.
    """
    if isinstance(target, dict):
        return target.get("owner") or "event"
    field = str(target)
    if field.startswith("answers."):
        qid = field.split(".", 1)[1]
        for q in questions:
            if q.get("id") == qid:
                return q.get("owner") or "event"
        raise KeyError("no question named %r, so nobody owns it" % qid)
    if field.startswith("moments."):
        parts = field.split(".")
        attr = parts[2] if len(parts) > 2 else "date"
        if attr not in MOMENT_FIELD_OWNER:
            raise KeyError("no moment attribute named %r" % attr)
        return MOMENT_FIELD_OWNER[attr]
    if field in ("people", "event") or field.startswith("open_items"):
        return "event"
    raise KeyError("no owner rule for field %r" % field)


def role_of(group, people=()):
    """The role that may CONFIRM this group, after the fallback in section 2."""
    role = OWNER_ROLE[group]
    held = {p.get("role") for p in people}
    if role not in held and group in OWNER_FALLBACK:
        return OWNER_FALLBACK[group]
    return role


def may_confirm(group, role, people=()):
    return role == "dj" or role == role_of(group, people)


# ---------------------------------------------------------------- validation

def _is_empty(value):
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple)):
        return len([v for v in value if str(v).strip()]) == 0
    return False


def _type_errors(question, value):
    kind = question.get("type")
    options = question.get("options") or []
    qid = question["id"]
    bad = []
    if kind in ("text", "textarea", "email", "date", "choice"):
        if not isinstance(value, str):
            return [{"field": "answers." + qid, "message": "That answer should be words."}]
    if kind == "email" and not _EMAIL.match(value.strip()):
        bad.append("That does not look like an email address.")
    if kind == "date" and not _YMD.match(value.strip()):
        bad.append("A date looks like 2026-11-06.")
    if kind == "number":
        try:
            float(str(value).strip())
        except (TypeError, ValueError):
            bad.append("That should be a number.")
    if kind == "choice" and options and value not in options:
        bad.append("Pick one of the choices offered.")
    if kind in ("multi", "songs", "links"):
        if not isinstance(value, list):
            return [{"field": "answers." + qid, "message": "That answer should be a list."}]
        for item in value:
            if not isinstance(item, str) or not item.strip():
                bad.append("One of the lines is empty.")
                break
        if kind == "multi" and options:
            for item in value:
                if item not in options:
                    bad.append("Pick from the choices offered.")
                    break
    return [{"field": "answers." + qid, "message": m} for m in bad]


def _confirmed(answers, qid):
    a = answers.get(qid) or {}
    return a.get("state") == "confirmed" and not _is_empty(a.get("value"))


def validate(questions, payload, submit):
    """Errors in the PROSPECTIVE record.  Empty list means it may be written."""
    qmap = {q["id"]: q for q in questions}
    errors = []
    answers = payload.get("answers") or {}
    for qid, answer in answers.items():
        if qid not in qmap:
            errors.append({"field": "answers." + qid,
                           "message": "We do not have a question called that."})
            continue
        state = answer.get("state")
        if state not in STATES:
            errors.append({"field": "answers." + qid,
                           "message": "That is not one of the five answer states."})
            continue
        value = answer.get("value")
        if state == "confirmed":
            if _is_empty(value):
                errors.append({"field": "answers." + qid,
                               "message": "Marked answered but nothing was written."})
            else:
                errors.extend(_type_errors(qmap[qid], value))
        elif not _is_empty(value):
            errors.append({"field": "answers." + qid,
                           "message": "Only an answered question carries a value."})

    for moment in payload.get("moments") or []:
        mid = moment.get("moment_id") or "?"
        if moment.get("kind") not in MOMENT_KINDS:
            errors.append({"field": "moments." + mid,
                           "message": "That is not one of the parts of a night we know."})
        if moment.get("approval") not in MOMENT_APPROVAL:
            errors.append({"field": "moments." + mid,
                           "message": "A moment is draft, proposed or confirmed."})
        for attr in ("start", "end"):
            if moment.get(attr) and not _HHMM.match(str(moment[attr])):
                errors.append({"field": "moments.%s.%s" % (mid, attr),
                               "message": "A time looks like 19:30."})
        if moment.get("date") and not _YMD.match(str(moment["date"])):
            errors.append({"field": "moments.%s.date" % mid,
                           "message": "A date looks like 2026-11-06."})

    for person in payload.get("people") or []:
        pid = person.get("person_id") or "?"
        if person.get("role") not in ROLES:
            errors.append({"field": "people." + pid,
                           "message": "That is not one of the roles we know."})
        if not str(person.get("name") or "").strip():
            errors.append({"field": "people." + pid, "message": "A person needs a name."})
        if person.get("email") and not _EMAIL.match(str(person["email"]).strip()):
            errors.append({"field": "people." + pid,
                           "message": "That does not look like an email address."})

    if submit:
        if not (_confirmed(answers, "event_name") or _confirmed(answers, "company")):
            errors.append({"field": "answers.event_name",
                           "message": "We need the event name or the company."})
        if not _confirmed(answers, "contact_name"):
            errors.append({"field": "answers.contact_name",
                           "message": "We need a name we can talk to."})
        if not _confirmed(answers, "contact_email"):
            errors.append({"field": "answers.contact_email",
                           "message": "We need an email for the private link."})
        date_state = (answers.get("event_date") or {}).get("state")
        if not (_confirmed(answers, "event_date") or date_state == "unknown"):
            errors.append({"field": "answers.event_date",
                           "message": "Give the date, or say it is not settled yet."})
        if not _confirmed(answers, "event_type"):
            errors.append({"field": "answers.event_type",
                           "message": "Tell us what kind of event it is."})
        elif (answers["event_type"].get("value") == "Other"
              and not _confirmed(answers, "event_type_other")):
            errors.append({"field": "answers.event_type_other",
                           "message": "Tell us what kind of event it is."})
        approver_state = (answers.get("approver_name") or {}).get("state")
        if not (_confirmed(answers, "approver_name") or approver_state == "unknown"):
            errors.append({"field": "answers.approver_name",
                           "message": "Name who gives the final yes, or say it is not settled yet."})
    return errors


# ------------------------------------------------------- simultaneous editors

_MISSING = object()


def three_way(base, current, yours):
    """Merge one editor's fields onto a record that moved under them.

    base / current / yours are flat {field: value} maps.  A field only the
    other editor touched stays theirs; a field only you touched is yours;
    a field both touched with different values is a conflict and nothing in
    that field is written.
    """
    merged, conflicts = {}, []
    for field, mine in yours.items():
        was = base.get(field, _MISSING)
        theirs = current.get(field, _MISSING)
        if theirs == was or theirs == mine:
            merged[field] = mine
        else:
            conflicts.append({"field": field, "yours": mine,
                              "theirs": None if theirs is _MISSING else theirs})
    return merged, conflicts


# ------------------------------------------------------------------- coverage

def coverage(event):
    """How many minutes of music Miles owes, and where the order does not meet."""
    moments = placed(event.get("moments") or [])
    target = sum(span_min(m) for m in moments if m.get("music_owner") == "dj")
    overlaps, gaps = [], []
    for first, second in zip(moments, moments[1:]):
        first_end = abs_start(first) + span_min(first)
        second_start = abs_start(second)
        if second_start < first_end:
            overlaps.append({"a": first["moment_id"], "b": second["moment_id"],
                             "minutes": first_end - second_start})
        elif second_start > first_end:
            gaps.append({"after": first["moment_id"], "before": second["moment_id"],
                         "minutes": second_start - first_end})
    return {"target_min": target, "overlaps": overlaps, "gaps": gaps}


# -------------------------------------------------------------------- effects

def _item(item_id, question, why, moments, owner, origin):
    return {"item_id": item_id, "question": question, "why": why,
            "moments": list(moments), "owner": owner, "due": None,
            "resolved": False, "resolved_by": None, "resolved_at": None,
            "origin": origin, "active": True}


def _by_id(moments):
    return {m.get("moment_id"): m for m in moments if m.get("moment_id")}


def _window(moment):
    start = abs_start(moment)
    if start is None:
        return None
    return (start, start + span_min(moment))


def _norm_song(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def _answer_value(event, qid):
    return (event.get("answers", {}).get(qid) or {}).get("value")


def effects(before, after, questions=()):
    """What a save did to the prep.  Adds open items to `after` in place.

    Running it twice on the same pair adds nothing the second time: every
    item id is derived from the rule plus the thing it is about, and an item
    already active on the event is not added again.
    """
    people = after.get("people") or []
    after.setdefault("open_items", [])
    live = {i["item_id"] for i in after["open_items"] if i.get("active", True)}
    added, closed, cues = [], [], []

    def offer(item):
        if item["item_id"] in live:
            # Already open.  Nothing is added, but who owns it can have moved
            # (an answer that was "Not sure yet" and is now "Miles to suggest").
            for standing in after["open_items"]:
                if standing["item_id"] == item["item_id"]:
                    standing["owner"] = item["owner"]
                    standing["question"] = item["question"]
                    standing["why"] = item["why"]
            return
        live.add(item["item_id"])
        added.append(item)

    def role_for(group):
        return role_of(group, people)

    b_moments, a_moments = _by_id(before.get("moments") or []), _by_id(after.get("moments") or [])

    # --- a moment of kind awards becomes active
    def awards_ids(record):
        return {m["moment_id"] for m in (record.get("moments") or [])
                if m.get("kind") == "awards" and m.get("active", True)}

    cue_role = "planner" if any(p.get("role") == "planner" for p in people) else "approver"
    for mid in sorted(awards_ids(after) - awards_ids(before)):
        label = a_moments[mid].get("label") or "the awards"
        offer(_item("oi_awards_names_" + mid,
                    "Who are the award recipients, and how are their names pronounced?",
                    "Read on mic during %s; a wrong name is unrecoverable." % label,
                    [mid], "approver", "rule:awards"))
        offer(_item("oi_awards_walkon_" + mid,
                    "What walks each recipient on?",
                    "Walk-on music has to be cued to the second.",
                    [mid], "approver", "rule:awards"))
        offer(_item("oi_awards_cue_text_" + mid,
                    "What are the exact words that start and stop the music?",
                    "Miles goes on the words, not on a guess.",
                    [mid], cue_role, "rule:awards"))
        offer(_item("oi_awards_introducer_" + mid,
                    "Who introduces whom?",
                    "The order on stage decides the order of the music.",
                    [mid], cue_role, "rule:awards"))
        offer(_item("oi_awards_cue_caller_" + mid,
                    "Who calls each cue on the night?",
                    "One voice tells Miles to go.",
                    [mid], cue_role, "rule:awards"))

    # --- a moment's start / end / date changes
    for mid, moment in a_moments.items():
        old = b_moments.get(mid)
        if not old or not moment.get("active", True):
            continue
        if all(old.get(k) == moment.get(k) for k in ("date", "start", "end")):
            continue
        windows = [w for w in (_window(old), _window(moment)) if w]
        if not windows:
            continue
        low = min(w[0] for w in windows)
        high = max(w[1] for w in windows)
        for other in (after.get("moments") or []):
            if not other.get("active", True) or not str(other.get("cue_text") or "").strip():
                continue
            span = _window(other)
            if span and span[0] < high and span[1] > low and other["moment_id"] not in cues:
                cues.append(other["moment_id"])
        label = moment.get("label") or mid
        moment_cue_role = moment.get("cue_owner") or role_for("running_order")
        offer(_item("oi_cue_recheck_" + mid,
                    "Re-confirm the cue for %s at the new time" % label,
                    "The time moved; the words and the start point have to move with it.",
                    [mid], moment_cue_role, "rule:time-change"))
        offer(_item("oi_soundcheck_recheck_" + mid,
                    "Re-check soundcheck and arrival against the new times",
                    "Everything before the change was planned around the old clock.",
                    [mid], role_for("production"), "rule:time-change"))

    # --- the event date, venue or zone changes
    shift_days = 0
    moved = [q for q in ("event_date", "venue", "tz")
             if not _is_empty(_answer_value(before, q))
             and _answer_value(before, q) != _answer_value(after, q)]
    if moved:
        offer(_item("oi_reschedule_recheck",
                    "Re-check load-in, arrival and the room plan for the new venue/date",
                    "A new date or a new room changes every practical answer under it.",
                    [], role_for("production"), "rule:reschedule"))
        old_date, new_date = _answer_value(before, "event_date"), _answer_value(after, "event_date")
        if (moved == ["event_date"] and old_date and new_date
                and _YMD.match(str(old_date)) and _YMD.match(str(new_date))):
            shift_days = ymd_to_ord(new_date) - ymd_to_ord(old_date)
            if shift_days:
                for moment in (after.get("moments") or []):
                    if moment.get("date") and _YMD.match(str(moment["date"])):
                        moment["date"] = _date.fromordinal(
                            ymd_to_ord(moment["date"]) + shift_days).isoformat()

    # --- a moment goes inactive: its items go quiet, nothing new is born
    gone = {mid for mid, m in a_moments.items()
            if not m.get("active", True) and b_moments.get(mid, {}).get("active", True)}
    if gone:
        for item in after["open_items"]:
            if item.get("active", True) and gone.intersection(item.get("moments") or []):
                item["active"] = False
                closed.append(item["item_id"])
                live.discard(item["item_id"])
        added = [i for i in added if not gone.intersection(i["moments"])]

    # --- an answer lands on "Not sure yet" or "Miles to suggest"
    qmap = {q["id"]: q for q in questions}
    for qid, answer in (after.get("answers") or {}).items():
        state = answer.get("state")
        item_id = "oi_answer_" + qid
        if state in ("unknown", "miles"):
            if state == "miles":
                owner = "dj"
            else:
                if qid not in qmap:
                    raise KeyError(
                        "effects needs the question list to know who owns %r" % qid)
                owner = role_for(owner_of(qmap[qid]))
            label = (qmap.get(qid) or {}).get("label") or qid
            why = ("You said you'd suggest this — it's yours to answer."
                   if state == "miles" else
                   "Left open on the form; the night needs a real answer.")
            offer(_item(item_id, label + " — still open", why, [], owner, "rule:answer-state"))
        elif state in ("confirmed", "none"):
            for item in after["open_items"]:
                if item["item_id"] == item_id and item.get("active", True):
                    item["resolved"] = True
                    item["active"] = False
                    closed.append(item_id)
                    live.discard(item_id)

    # --- a do-not-play matches something asked for
    excluded = _answer_value(after, EXCLUSION_QID) or []
    request_ids = [q["id"] for q in questions
                   if q.get("type") == "songs" and q["id"] != EXCLUSION_QID] or list(REQUEST_QIDS)
    wanted = []
    for qid in request_ids:
        value = _answer_value(after, qid)
        if isinstance(value, list):
            wanted.extend(value)
        elif isinstance(value, str) and value.strip():
            wanted.append(value)
    for bad in (excluded if isinstance(excluded, list) else []):
        bad_norm = _norm_song(bad)
        if not bad_norm:
            continue
        for want in wanted:
            want_norm = _norm_song(want)
            if not want_norm:
                continue
            if bad_norm == want_norm or bad_norm in want_norm or want_norm in bad_norm:
                offer(_item("oi_exclusion_" + slug(bad_norm),
                            "%s is both requested and excluded — which wins?" % bad,
                            "It is on the must-play list and on the do-not-play list.",
                            [], "approver", "rule:exclusion"))
                break

    return {"open_items_added": added, "open_items_closed": closed,
            "cues_to_recheck": cues, "coverage": coverage(after),
            "date_shift_days": shift_days}


# ---------------------------------------------------------------- next action

def next_action(event):
    """One plain sentence for the top of both screens."""
    people = event.get("people") or []
    open_items = [i for i in (event.get("open_items") or [])
                  if i.get("active", True) and not i.get("resolved")]
    client = [i for i in open_items if i.get("owner") != "dj"]
    mine = [i for i in open_items if i.get("owner") == "dj"]
    if client:
        counts = {}
        for item in client:
            counts[item.get("owner")] = counts.get(item.get("owner"), 0) + 1
        wanted = sorted(counts, key=lambda r: (-counts[r], r != "approver", r))[0]
        name = ""
        for person in people:
            if person.get("role") == wanted:
                name = str(person.get("name") or "").split(" ")[0]
                break
        if not name:
            for person in people:
                if person.get("role") == "approver":
                    name = str(person.get("name") or "").split(" ")[0]
                    break
        who = name or "the client"
        count = len(client)
        return "Waiting on %s: %d open question%s." % (who, count, "" if count == 1 else "s")
    if mine:
        count = len(mine)
        return ("Nothing waiting on the client. %d thing%s need%s Miles."
                % (count, "" if count == 1 else "s", "s" if count == 1 else ""))
    return "Nothing open. Ready for the next step."
