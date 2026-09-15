"""Empty the store and put the two pretend events back in it.

Run this whenever you want a clean pair of events to look at.  It prints one
private link per person and the link for Miles's own view.  Everybody in here
is invented; none of it is a real client.
"""

import json
import sys
from pathlib import Path

import store

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def plant(fixture):
    questions = store.load_questions()["questions"]
    event = store.create_event(fixture["name"], fixture["company"],
                               fixture["date"], fixture["tz"],
                               people=fixture["people"])
    event_id = event["event_id"]

    answers = {qid: {"value": value, "state": "confirmed"}
               for qid, value in fixture["answers"].items()}
    for state in ("unknown", "miles", "none"):
        for qid in fixture.get(state, []):
            answers[qid] = {"value": None, "state": state}
    code, body = store.save(event_id, "p_miles", "dj",
                            {"base_revision": event["revision"],
                             "submission_id": "sub_seed_" + event_id,
                             "answers": answers}, questions)
    if code != 200:
        raise SystemExit("the fixture would not save: %s" % json.dumps(body, indent=2))

    code, body = store.seed_apply(event_id, moments=fixture["moments"],
                                  proposals=fixture.get("proposals", []),
                                  dj_notes=fixture.get("dj_notes"),
                                  stage=fixture.get("stage"), questions=questions)
    if code != 200:
        raise SystemExit("the moments would not save: %s" % json.dumps(body, indent=2))

    links = []
    for person in fixture["people"]:
        grant = store.access("mint", event_id=event_id,
                             person_id=person["person_id"], role=person["role"])
        links.append((person["name"], person["role"], grant["link"]))
    return store.load_event(event_id), links


def main():
    store.wipe()
    print("Store emptied.\n")
    for name in ("harbor-studio.json", "northstar-awards.json"):
        fixture = load_fixture(name)
        event, links = plant(fixture)
        print(event["answers"]["event_name"]["value"])
        print("  " + event["next_action"])
        print("  %d parts of the night, %d questions still open."
              % (len([m for m in event["moments"] if m.get("active", True)]),
                 len([i for i in event["open_items"]
                      if i.get("active", True) and not i.get("resolved")])))
        for who, role, link in links:
            print("  %-16s %-11s http://127.0.0.1:8790%s" % (who, role, link))
        print()
    dj = store.access("dj")
    print("Miles's own view:  http://127.0.0.1:8790/dj/")
    print("His pass, for the page to carry:  %s" % dj["token"])
    print("\nStart the server with:  python3 corporate/server.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
