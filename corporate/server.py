"""The corporate onboarding server: static pages plus the JSON doors.

Local only, one process, no dependency outside the standard library.

Who is knocking is checked at ONE seam before anything is routed: the Host
header has to be our own address, and any POST carrying an Origin has to carry
ours.  A local address is not a door lock — another program, a browser
extension or a page that re-points a name at 127.0.0.1 can all knock.
"""

import json
import os
import re
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import daysheet
import rules
import store

HERE = Path(__file__).resolve().parent
CLIENT_DIR = HERE / "client"
DJ_DIR = HERE / "dj"
PORT = int(os.environ.get("CORP_PORT", "8790"))
MAX_BODY = 1024 * 1024

_TOKEN = re.compile(r"^[0-9a-f]{32}$")
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".json": "application/json",
         ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
         ".woff2": "font/woff2", ".ico": "image/x-icon"}


def allowed_hosts(port=None):
    port = port or PORT
    return {"127.0.0.1:%d" % port, "localhost:%d" % port}


def allowed_origins(port=None):
    return {"http://" + host for host in allowed_hosts(port)}


# ------------------------------------------------------------------- audience

def for_client(event, person_id):
    """What a client may see.  Private things are removed, never just hidden."""
    seen = deepcopy(event)
    seen.pop("dj_notes", None)
    seen.pop("receipts", None)
    seen.pop("pending_people", None)
    for person in seen.get("people") or []:
        if person.get("person_id") != person_id:
            person["email"] = ""
            person["phone"] = ""
    for answer in (seen.get("answers") or {}).values():
        proposal = answer.get("proposal")
        if proposal and proposal.get("by") == "p_miles":
            proposal["note"] = ""
    return seen


def for_audience(event, who):
    return event if who["role"] == "dj" else for_client(event, who["person_id"])


def changes_for_audience(lines, who):
    if who["role"] == "dj":
        return lines
    out = []
    for line in deepcopy(lines):
        if line.get("field") == "dj_notes":
            continue
        out.append(line)
    return out


def summarise(event):
    items = [i for i in (event.get("open_items") or [])
             if i.get("active", True) and not i.get("resolved")]
    proposals = sum(1 for a in (event.get("answers") or {}).values() if a.get("proposal"))
    proposals += sum(1 for m in (event.get("moments") or []) if m.get("proposal"))
    seen = event.get("dj_seen_revision") or 0
    answers = event.get("answers") or {}

    def value(qid):
        answer = answers.get(qid) or {}
        return answer.get("value") if answer.get("state") == "confirmed" else None

    return {"event_id": event["event_id"], "name": value("event_name") or event["event_id"],
            "company": value("company") or "", "date": value("event_date") or "",
            "tz": event.get("tz"), "stage": event.get("stage"),
            "revision": event.get("revision"), "updated_at": event.get("updated_at"),
            "changed_since_seen": len(store.changes_since(event["event_id"], seen)),
            "needs_me": len([i for i in items if i.get("owner") == "dj"]) + proposals,
            "waiting_on_client": len([i for i in items if i.get("owner") != "dj"]),
            "next_action": event.get("next_action") or rules.next_action(event)}


# ------------------------------------------------------- starting a booking

# Who a booking can be started for.  Miles is not on this list: he is the one
# starting it, and `dj` is not a person a private link is ever minted for.
BOOKING_ROLES = ("approver", "planner", "production", "contact")

# CONTRACT.md section 2, the same words: what each role gets to decide.
DECIDES = {"approver": ["direction", "event"], "planner": ["running_order"],
           "production": ["production"], "contact": []}


def people_for_a_new_booking(given, questions=None):
    """The people a booking is started for, or what is wrong with them.

    A name here is text Miles typed, so the id a person is known by is built
    from a reduced leaf of it and never from the text itself.  One person per
    role: the links come back keyed by role, so two planners would lose one
    of the two links without a word.
    """
    people, errors, taken = [], [], {}
    for index, person in enumerate(given or []):
        if not isinstance(person, dict):
            errors.append({"field": "people.%d" % index,
                           "message": "A person is a name, a role and an email."})
            continue
        name = str(person.get("name") or "").strip()
        role = str(person.get("role") or "").strip()
        if role not in BOOKING_ROLES:
            errors.append({"field": "people.%d" % index,
                           "message": "That is not one of the roles a booking starts with."})
            continue
        if role in taken:
            errors.append({"field": "people.%d" % index,
                           "message": "Only one person for each role."})
            continue
        taken[role] = True
        person_id = "p_" + rules.slug(name)
        while person_id in [p["person_id"] for p in people]:
            person_id += "x"
        people.append({"person_id": person_id, "name": name, "role": role,
                       "email": str(person.get("email") or "").strip(),
                       "phone": str(person.get("phone") or "").strip(),
                       "decides": list(DECIDES.get(role, []))})
    # Names, roles and email addresses are checked by the same rule the save
    # door uses; nothing here invents a second opinion about them.
    questions = questions or store.load_questions()["questions"]
    errors.extend(rules.validate(questions, {"people": people}, False))
    if not [p for p in people if p["role"] == "approver"]:
        errors.append({"field": "people",
                       "message": "We need the person who gives the final yes."})
    return people, errors


def brief(event, who):
    answers = event.get("answers") or {}
    confirmed = {qid: a.get("value") for qid, a in answers.items()
                 if a.get("state") == "confirmed"}
    mine = [i for i in (event.get("open_items") or [])
            if i.get("active", True) and not i.get("resolved")
            and (who["role"] == "dj" or i.get("owner") == who["role"])]
    return {"ok": True,
            "header": {"event_id": event["event_id"],
                       "name": confirmed.get("event_name") or event["event_id"],
                       "company": confirmed.get("company") or "",
                       "date": confirmed.get("event_date") or "",
                       "venue": confirmed.get("venue") or "",
                       "tz": event.get("tz"), "revision": event.get("revision"),
                       "stage": event.get("stage")},
            "moments": [m for m in (event.get("moments") or []) if m.get("active", True)],
            "answers": confirmed, "open_items": mine,
            "next_action": event.get("next_action") or ""}


# -------------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    server_version = "SavvyCorporate/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # --- the one seam ------------------------------------------------------
    def knock_refused(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").strip()
        if host not in allowed_hosts(port):
            return 421, {"ok": False, "error": "bad-host"}
        if self.command == "POST":
            origin = (self.headers.get("Origin") or "").strip()
            if origin and origin not in allowed_origins(port):
                return 403, {"ok": False, "error": "bad-origin"}
        return None

    def do_GET(self):
        refused = self.knock_refused()
        if refused:
            return self.send_json(*refused)
        try:
            self.route_get(urlparse(self.path))
        except Exception as problem:            # never leak a stack to a client
            self.send_json(500, {"ok": False, "error": "server-problem",
                                 "detail": str(problem)})

    def do_POST(self):
        refused = self.knock_refused()
        if refused:
            return self.send_json(*refused)
        try:
            self.route_post(urlparse(self.path))
        except Exception as problem:
            self.send_json(500, {"ok": False, "error": "server-problem",
                                 "detail": str(problem)})

    # --- plumbing ----------------------------------------------------------
    def send_json(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def send_bytes(self, code, raw, kind):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(raw)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def whoami(self):
        """Who is on the other end, or a refusal in words."""
        return store.access("lookup", token=(self.headers.get("X-Access-Token") or "").strip())

    def reach(self, who, event_id):
        if who["role"] == "dj":
            return None
        if who.get("event_id") != event_id:
            return 403, {"ok": False, "error": "not-your-event"}
        return None

    # --- static ------------------------------------------------------------
    def serve_file(self, folder, name):
        target = (folder / name).resolve()
        if folder.resolve() not in target.parents and target != folder.resolve():
            return self.send_json(403, {"ok": False, "error": "not-allowed"})
        if not target.is_file():
            return self.send_json(404, {"ok": False, "error": "no-such-page"})
        kind = TYPES.get(target.suffix, "application/octet-stream")
        self.send_bytes(200, target.read_bytes(), kind)

    # --- routes ------------------------------------------------------------
    def route_get(self, url):
        path = url.path
        parts = [p for p in path.split("/") if p]
        query = parse_qs(url.query)

        if path == "/c" or (len(parts) == 2 and parts[0] == "c"):
            if len(parts) == 2 and not _TOKEN.match(parts[1]):
                return self.send_json(403, {"ok": False, "error": "link-expired"})
            return self.serve_file(CLIENT_DIR, "index.html")
        if parts[:1] == ["client"] and len(parts) > 1:
            return self.serve_file(CLIENT_DIR, "/".join(parts[1:]))
        if parts[:1] == ["dj"]:
            return self.serve_file(DJ_DIR, "/".join(parts[1:]) or "index.html")

        if not path.startswith("/api/"):
            return self.send_json(404, {"ok": False, "error": "no-such-door"})

        who = self.whoami()
        if not who.get("ok"):
            return self.send_json(403, who)

        if path == "/api/questions":
            return self.send_json(200, store.load_questions())
        if path == "/api/me":
            person = {"person_id": who["person_id"], "name": "Miles", "role": "dj"}
            if who["role"] != "dj":
                event = store.load_event(who["event_id"])
                for candidate in (event or {}).get("people") or []:
                    if candidate.get("person_id") == who["person_id"]:
                        person = {"person_id": candidate["person_id"],
                                  "name": candidate.get("name"),
                                  "role": candidate.get("role")}
            return self.send_json(200, {"ok": True, "event_id": who.get("event_id"),
                                        "person": person, "role": who["role"],
                                        "expires_at": who.get("expires_at")})
        if path == "/api/events":
            if who["role"] != "dj":
                return self.send_json(403, {"ok": False, "error": "not-allowed"})
            return self.send_json(200, [summarise(e) for e in store.list_events()])

        if parts[:2] == ["api", "events"] and len(parts) >= 3:
            event_id = parts[2]
            denied = self.reach(who, event_id)
            if denied:
                return self.send_json(*denied)
            event = store.load_event(event_id) if re.match(r"^ev_[0-9a-f]{10}$", event_id) else None
            if event is None:
                return self.send_json(404, {"ok": False, "error": "no-such-event"})
            tail = parts[3] if len(parts) > 3 else ""
            if not tail:
                return self.send_json(200, for_audience(event, who))
            if tail == "changes":
                since = int((query.get("since") or ["0"])[0])
                return self.send_json(200, {"ok": True, "changes": changes_for_audience(
                    store.changes_since(event_id, since), who)})
            if tail == "brief":
                return self.send_json(200, brief(for_audience(event, who), who))
            if tail == "daysheet":
                if who["role"] != "dj":
                    return self.send_json(403, {"ok": False, "error": "not-allowed"})
                return self.send_bytes(200, daysheet.html_sheet(event).encode("utf-8"),
                                       "text/html; charset=utf-8")
            if tail == "daysheet.csv":
                if who["role"] != "dj":
                    return self.send_json(403, {"ok": False, "error": "not-allowed"})
                return self.send_bytes(200, daysheet.csv_sheet(event).encode("utf-8"),
                                       "text/csv; charset=utf-8")
        return self.send_json(404, {"ok": False, "error": "no-such-door"})

    def route_post(self, url):
        parts = [p for p in url.path.split("/") if p]
        who = self.whoami()
        if not who.get("ok"):
            return self.send_json(403, who)
        body = self.read_body()
        if body is None:
            return self.send_json(400, {"ok": False, "error": "bad-json"})

        if parts == ["api", "dj", "events"]:
            if who["role"] != "dj":
                return self.send_json(403, {"ok": False, "error": "not-allowed"})
            people, errors = people_for_a_new_booking(body.get("people"))
            if errors:
                return self.send_json(422, {"ok": False, "error": "invalid",
                                            "errors": errors})
            event = store.create_event(body.get("name"), body.get("company"),
                                       body.get("date"), body.get("tz"),
                                       people=people)
            links = {}
            for person in event["people"]:
                grant = store.access("mint", event_id=event["event_id"],
                                     person_id=person["person_id"], role=person["role"])
                links[person["role"]] = grant["link"]
            return self.send_json(200, {"ok": True, "event_id": event["event_id"],
                                        "links": links})

        if parts == ["api", "dj", "seen"]:
            if who["role"] != "dj":
                return self.send_json(403, {"ok": False, "error": "not-allowed"})
            code, answer = store.set_seen(body.get("event_id"), body.get("revision"))
            return self.send_json(code, answer)

        if parts == ["api", "dj", "access"]:
            if who["role"] != "dj":
                return self.send_json(403, {"ok": False, "error": "not-allowed"})
            if body.get("revoke"):
                return self.send_json(200, store.access("revoke", token=body["revoke"]))
            grant = store.access("mint", event_id=body["event_id"],
                                 person_id=body["person_id"], role=body["role"],
                                 expires_at=body.get("expires_at"))
            return self.send_json(200, grant)

        if parts[:2] == ["api", "events"] and len(parts) >= 4:
            event_id = parts[2]
            denied = self.reach(who, event_id)
            if denied:
                return self.send_json(*denied)
            tail = parts[3]
            if tail == "save":
                code, answer = store.save(event_id, who["person_id"], who["role"], body)
                return self.send_json(code, answer)
            if tail == "resolve":
                code, answer = store.resolve(event_id, who["person_id"], who["role"],
                                             body.get("field"), body.get("take"),
                                             body.get("submission_id", ""))
                return self.send_json(code, answer)
            if tail == "open-items" and len(parts) >= 5:
                code, answer = store.set_open_item(
                    event_id, who["person_id"], who["role"], parts[4],
                    bool(body.get("resolved")), body.get("answer", ""),
                    body.get("submission_id", ""))
                return self.send_json(code, answer)
        return self.send_json(404, {"ok": False, "error": "no-such-door"})


def serve(port=None):
    port = port or PORT
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return httpd


if __name__ == "__main__":
    httpd = serve()
    print("Corporate onboarding is open at http://127.0.0.1:%d/dj/" % httpd.server_address[1])
    print("Stop it with control-C.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()
