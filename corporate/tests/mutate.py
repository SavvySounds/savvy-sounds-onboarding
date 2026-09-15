#!/usr/bin/env python3
"""Break the brain on purpose, one line at a time, and see whether a check notices.

How it runs:

* Every needle is counted against the real source FIRST — before the baseline,
  before a single sandbox is made.  A needle that matches no place, or more than
  one, stops the whole run in words.  A rotted quote read as "untested" is how a
  runner sits green for a week while a guard watches nothing.
* The unmutated suite runs once.  A red baseline scores every mutation "caught",
  so a red baseline refuses to go on.
* Each mutation gets a FRESH copy of the folder in a private temp directory this
  runner makes and owns, with PYTHONDONTWRITEBYTECODE=1 and -B so no stale
  bytecode from a same-length edit can answer for the new source.
* A surviving mutation is a question about the check, never a reason to lower it.

    python3 corporate/tests/mutate.py            # everything
    python3 corporate/tests/mutate.py store      # only needles in store.py
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CORPORATE = Path(__file__).resolve().parent.parent
BENCH = CORPORATE.parent
# The port every sandbox's HTTP checks bind.  It is the runner's own, not the
# preview's (8790) and not the suite's (8791).  CORP_MUTATE_PORT moves it when
# another desk on this Mac is already holding this one — a busy port makes the
# baseline red, and a red baseline scores every mutation "caught", so the way
# round it has to be a deliberate, visible one.
SANDBOX_PORT = os.environ.get("CORP_MUTATE_PORT", "8792")

# file, what to break, what to put there instead, and the check that must notice.
NEEDLES = [
    ("rules.py",
     '    suffix = "AM" if hour < 12 else "PM"',
     '    suffix = "AM" if hour < 12 else "AM"',
     "corporate.tests.test_rules.Clock."
     "test_every_stored_time_is_said_the_way_miles_reads_it",
     "afternoon and evening times lose their PM words"),

    # --- store.py: the one writer -----------------------------------------
    ("store.py",
     'def _safe(event_id):\n'
     '    """An event id is minted by us and is never text somebody typed."""\n'
     '    if not _EVENT_ID.match(str(event_id or "")):',
     'def _safe(event_id):\n'
     '    """An event id is minted by us and is never text somebody typed."""\n'
     '    if False:',
     "corporate.tests.test_store.Making."
     "test_a_name_that_tries_to_be_a_path_is_refused_in_words",
     "a typed name can become a path into the event store"),

    ("store.py",
     "        if submission_id and submission_id in receipts:",
     "        if False and submission_id in receipts:",
     "corporate.tests.test_store.Saving."
     "test_the_same_send_twice_gives_the_same_receipt_and_no_second_booking",
     "a repeat send is no longer recognised"),

    ("store.py",
     '            event["stage"] = "waiting"\n        event["revision"] += 1',
     '            event["stage"] = "waiting"\n        event["revision"] += 0',
     "corporate.tests.test_store.Saving."
     "test_a_save_answers_with_a_receipt_and_moves_the_revision_on",
     "an accepted save stops moving the revision on"),

    ("store.py",
     '    for path in sorted(folder.glob("ev_*.json")):',
     '    for path in sorted(folder.glob("*.json")):',
     "corporate.tests.test_store.BrokenWrite."
     "test_a_write_cut_off_half_way_leaves_the_last_good_answer_standing",
     "a half-written temp file is read as if it were an event"),

    ("store.py",
     "        return _locks.setdefault(event_id, threading.Lock())",
     "        return threading.Lock()",
     "corporate.tests.test_store.OneLock."
     "test_ten_saves_at_once_all_land_and_the_revision_never_repeats",
     "every save gets its own lock, so two saves can run at once"),

    ("store.py",
     '            if not dry:\n                answer["previous"] = {"value": answer.get("value"),',
     '            if False:\n                answer["previous"] = {"value": answer.get("value"),',
     "corporate.tests.test_store.Saving."
     "test_what_was_there_before_is_kept_on_every_changed_answer",
     "the old answer is thrown away instead of kept"),

    ("store.py",
     "            if rules.may_confirm(group, role, people):",
     "            if True:",
     "corporate.tests.test_store.Saving."
     "test_somebody_who_does_not_own_the_field_only_proposes",
     "anybody with a link can confirm anybody's decision"),

    ("store.py",
     "            if raw:",
     "            if False:",
     "corporate.tests.test_store.Saving."
     "test_two_editors_on_one_time_get_both_values_back_and_nothing_is_written",
     "two editors on one field quietly overwrite each other"),

    ("store.py",
     '        if grant.get("revoked_at"):',
     "        if False:",
     "corporate.tests.test_http.Doors.test_a_revoked_link_stops_working_on_every_door",
     "a link Miles took back still works"),

    ("store.py",
     "        if expires and expires <= now():",
     "        if False:",
     "corporate.tests.test_http.Doors.test_a_link_that_ran_out_stops_working",
     "a link that ran out still works"),

    ("store.py",
     "        wanted = min(wanted, int(event.get(\"revision\") or 0))",
     "        wanted = int(wanted)",
     "corporate.tests.test_http.Doors."
     "test_the_bookmark_never_runs_past_where_the_event_is",
     "what Miles has read can run past the event and hide a change"),

    ("store.py",
     "        wanted = max(wanted, standing)",
     "        wanted = int(wanted)",
     "corporate.tests.test_http.Doors.test_the_bookmark_never_moves_back",
     "what Miles has read can move back and show him old changes again"),

    # --- rules.py: the brain ----------------------------------------------
    ("rules.py",
     '    "cue_text": "running_order", "pronunciation": "running_order",',
     '    "cue_text": "prep", "pronunciation": "prep",',
     "corporate.tests.test_rules.OwnerTable."
     "test_moment_times_belong_to_the_running_order",
     "the cue words change hands"),

    ("rules.py",
     "    if role not in held and group in OWNER_FALLBACK:",
     "    if role in held and group in OWNER_FALLBACK:",
     "corporate.tests.test_rules.OwnerTable."
     "test_the_fallback_only_applies_when_nobody_holds_the_role",
     "the fallback fires when the real owner IS there"),

    ("rules.py",
     "        if theirs == was or theirs == mine:",
     "        if True:",
     "corporate.tests.test_rules.ThreeWay."
     "test_both_moved_it_differently_is_a_clash_carrying_both_values",
     "a clash between two editors stops being a clash"),

    ("rules.py",
     "        return (hhmm_to_min(end) - hhmm_to_min(start)) % 1440",
     "        return hhmm_to_min(end) - hhmm_to_min(start)",
     "corporate.tests.test_rules.Coverage."
     "test_a_span_across_midnight_is_three_hours_not_minus_twentyone",
     "a set that runs past midnight counts backwards"),

    ("rules.py",
     '        offer(_item("oi_awards_cue_caller_" + mid,',
     '        _dropped = (_item("oi_awards_cue_caller_" + mid,',
     "corporate.tests.test_rules.Effects."
     "test_awards_going_live_adds_exactly_the_five_cue_questions",
     "one of the five awards questions is never asked"),

    ("rules.py",
     '        for other in (after.get("moments") or []):',
     "        for other in []:",
     "corporate.tests.test_rules.Effects."
     "test_a_time_change_flags_the_cues_and_adds_the_two_questions",
     "a moved time no longer flags the cues under it"),

    ("rules.py",
     "            if bad_norm == want_norm or bad_norm in want_norm or want_norm in bad_norm:",
     "            if False:",
     "corporate.tests.test_rules.Effects."
     "test_a_do_not_play_that_is_also_a_must_play_asks_once",
     "a song on both lists is never questioned"),

    ("rules.py",
     '            if item.get("active", True) and gone.intersection(item.get("moments") or []):',
     "            if False:",
     "corporate.tests.test_rules.Effects."
     "test_a_moment_switched_off_quietens_its_questions_and_makes_none",
     "a part of the night that was cancelled keeps asking questions"),

    ("rules.py",
     "            if shift_days:",
     "            if False:",
     "corporate.tests.test_rules.Effects."
     "test_a_reschedule_keeps_the_event_and_walks_every_moment_forward",
     "a moved date leaves every time on the old day"),

    ("rules.py",
     '        if state in ("unknown", "miles"):',
     '        if state in ("unknown",):',
     "corporate.tests.test_rules.Effects."
     "test_not_sure_yet_and_miles_to_suggest_each_open_a_question",
     '"Miles to suggest" stops putting anything on his list'),

    ("rules.py",
     '        if not (_confirmed(answers, "event_name") or _confirmed(answers, "company")):',
     "        if False:",
     "corporate.tests.test_rules.Validate."
     "test_sending_needs_the_five_things_and_nothing_else",
     "a form can be sent with no event name and no company"),

    ("rules.py",
     '        return "Waiting on %s: %d open question%s." % (who, count, "" if count == 1 else "s")',
     '        return "Waiting on %s: %d open questions." % (who, count)',
     "corporate.tests.test_rules.NextAction.test_one_question_is_singular",
     "the one sentence Miles reads goes ungrammatical"),

    # --- server.py: who is knocking, and what they may see -----------------
    ("server.py",
     "        if host not in allowed_hosts(port):",
     "        if False:",
     "corporate.tests.test_http.Doors."
     "test_a_foreign_host_is_turned_away_before_anything_is_routed",
     "any name pointed at this Mac can reach every door"),

    ("server.py",
     "            if origin and origin not in allowed_origins(port):",
     "            if False:",
     "corporate.tests.test_http.Doors."
     "test_a_post_wearing_somebody_elses_origin_is_refused",
     "another site's page can save into an event"),

    ("server.py",
     '    seen.pop("dj_notes", None)',
     '    seen.setdefault("dj_notes", None)',
     "corporate.tests.test_private.Private."
     "test_miles_notes_are_nowhere_in_the_clients_reading",
     "Miles's private notes go to the client"),

    ("server.py",
     '        if person.get("person_id") != person_id:\n            person["email"] = ""',
     '        if person.get("person_id") != person_id:\n            person["email"] = person["email"]',
     "corporate.tests.test_private.Private."
     "test_one_person_never_sees_another_persons_phone_or_email",
     "one person on the event reads everybody else's email"),

    ("server.py",
     '                    if isinstance(person, dict) and person.get("person_id") != who["person_id"]:',
     '                    if False:',
     "corporate.tests.test_private.Private."
     "test_a_change_to_the_people_list_never_carries_another_persons_details",
     "a change to the people list hands every client everybody's phone and email"),

    ("server.py",
     '        if who.get("event_id") != event_id:',
     "        if False:",
     "corporate.tests.test_http.Doors.test_a_link_for_one_event_cannot_read_another",
     "one client's link opens another client's event"),

    ("server.py",
     '    if not [p for p in people if p["role"] == "approver"]:',
     "    if False:",
     "corporate.tests.test_http.Doors.test_a_booking_needs_the_person_who_says_yes",
     "a booking starts with nobody who can say yes to anything"),

    ("server.py",
     "        if role in taken:",
     "        if False:",
     "corporate.tests.test_http.Doors."
     "test_two_people_cannot_share_one_role_and_lose_a_link",
     "two people on one role, and one of the two links is lost silently"),

    ("server.py",
     '            if who["role"] != "dj":\n'
     '                return self.send_json(403, {"ok": False, "error": "not-allowed"})\n'
     '            code, answer = store.set_seen(',
     '            if False:\n'
     '                return self.send_json(403, {"ok": False, "error": "not-allowed"})\n'
     '            code, answer = store.set_seen(',
     "corporate.tests.test_http.Doors.test_only_miles_says_what_miles_has_read",
     "a client can say what Miles has read and hide their own changes"),

    # --- daysheet.py: the sheet that leaves the building -------------------
    ("daysheet.py",
     "    if text[:1] in FORMULA_STARTS:",
     "    if False:",
     "corporate.tests.test_http.Doors."
     "test_a_cell_that_would_run_as_a_formula_leaves_behind_a_quote",
     "a pasted formula runs when the sheet is opened"),
]


def count_needles(only):
    """Every needle, counted against the real source, before anything is copied."""
    sources = {}
    problems, chosen = [], []
    for needle in NEEDLES:
        name, find = needle[0], needle[1]
        if only and only not in name:
            continue
        if name not in sources:
            sources[name] = (CORPORATE / name).read_text(encoding="utf-8")
        hits = sources[name].count(find)
        if hits != 1:
            problems.append((name, find.strip().splitlines()[0], hits))
        else:
            chosen.append(needle)
    return chosen, problems


def run_suite(folder, target=None):
    room = dict(os.environ)
    room["PYTHONDONTWRITEBYTECODE"] = "1"
    room["CORP_PORT"] = SANDBOX_PORT
    room["CORP_DATA"] = str(Path(folder) / "store-for-this-run")
    room.pop("PYTHONPATH", None)
    command = [sys.executable, "-B", "-m", "unittest"]
    command += [target] if target else ["discover", "-s", "corporate/tests", "-t", "."]
    done = subprocess.run(command, cwd=folder, env=room, capture_output=True,
                          text=True, timeout=900)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def fresh_copy(into):
    shutil.copytree(CORPORATE, Path(into) / "corporate",
                    ignore=shutil.ignore_patterns("__pycache__", "data", "frames"))
    return into


def main(argv):
    only = argv[1] if len(argv) > 1 else ""
    chosen, problems = count_needles(only)

    if problems:
        print("STOPPED. These quotes no longer match the source exactly once:\n")
        for name, line, hits in problems:
            print("  %-12s %-4s %s" % (name, "%d x" % hits, line))
        print("\nA quote that matches nothing is a rotted quote, not an untested guard.")
        print("Fix the quote before reading anything else from this runner.")
        return 2
    if not chosen:
        print("No needles matched %r." % only)
        return 2
    print("%d needles, each matching its file exactly once." % len(chosen))

    scratch = tempfile.mkdtemp(prefix="corp-mutate-")
    try:
        print("Running the suite untouched first...")
        base = fresh_copy(tempfile.mkdtemp(dir=scratch))
        code, output = run_suite(base)
        if code != 0:
            print("\nSTOPPED. The suite is already red, so every mutation would")
            print("score as caught. Fix this first:\n")
            print(output[-4000:])
            return 2
        ran = [line for line in output.splitlines() if line.startswith("Ran ")]
        print("Baseline green: %s\n" % (ran[-1] if ran else "ok"))

        rows = []
        for name, find, put, expect, story in chosen:
            room = fresh_copy(tempfile.mkdtemp(dir=scratch))
            target = Path(room) / "corporate" / name
            source = target.read_text(encoding="utf-8")
            assert source.count(find) == 1, "the copy lost the needle: %s" % name
            target.write_text(source.replace(find, put), encoding="utf-8")
            code, output = run_suite(room, expect)
            caught = code != 0
            rows.append((name, story, expect.rsplit(".", 1)[1], caught))
            print("  %-7s %s" % ("caught" if caught else "SURVIVED", story))

        print("\n%-12s %-56s %-52s %s" % ("file", "what was broken", "the check that should notice", "result"))
        print("-" * 132)
        for name, story, check, caught in rows:
            print("%-12s %-56s %-52s %s"
                  % (name, story[:56], check[:52], "caught" if caught else "SURVIVED"))
        survived = [r for r in rows if not r[3]]
        print("-" * 132)
        print("%d of %d caught." % (len(rows) - len(survived), len(rows)))
        if survived:
            print("\nA survivor is a question about the check, never a reason to")
            print("lower it. Ask: does the fixture contain the trap at all?")
            return 1
        return 0
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
