#!/usr/bin/env python3
"""Break the script brain one guard at a time and prove a Node check notices."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


CORPORATE = Path(__file__).resolve().parent.parent


def needle(file, find, put, check, cost):
    return file, find, put, check, cost


NEEDLES = [
    # rules.gs: 13 guards
    needle("script/rules.gs", '  const suffix = hour < 12 ? "AM" : "PM";', '  const suffix = hour < 12 ? "AM" : "AM";', "rules.test.mjs — every stored time is said the way miles reads it", "afternoon and evening times lose their PM words"),
    needle("script/rules.gs", '  cue_text: "running_order", pronunciation: "running_order",', '  cue_text: "prep", pronunciation: "prep",', "rules.test.mjs — moment times belong to the running order", "the cue words change hands"),
    needle("script/rules.gs", "  if (!held.includes(role) && group in OWNER_FALLBACK) return OWNER_FALLBACK[group];", "  if (held.includes(role) && group in OWNER_FALLBACK) return OWNER_FALLBACK[group];", "rules.test.mjs — the fallback only applies when nobody holds the role", "the fallback fires when the real owner IS there"),
    needle("script/rules.gs", "    if (_equal(theirs, was) || _equal(theirs, mine)) merged[field] = mine;", "    if (true) merged[field] = mine;", "rules.test.mjs — both moved it differently is a clash carrying both values", "a clash between two editors stops being a clash"),
    needle("script/rules.gs", "    return (hhmm_to_min(end) - hhmm_to_min(start) + 1440) % 1440;", "    return hhmm_to_min(end) - hhmm_to_min(start);", "rules.test.mjs — a span across midnight is three hours not minus twentyone", "a set that runs past midnight counts backwards"),
    needle("script/rules.gs", '    offer(_item("oi_awards_cue_caller_" + mid,', '    void (_item("oi_awards_cue_caller_" + mid,', "rules.test.mjs — awards going live adds exactly the five cue questions", "one of the five awards questions is never asked"),
    needle("script/rules.gs", "    for (const other of after.moments || []) {", "    for (const other of []) {", "rules.test.mjs — a time change flags the cues and adds the two questions", "a moved time no longer flags the cues under it"),
    needle("script/rules.gs", "      if (bad_norm === want_norm || bad_norm.includes(want_norm) || want_norm.includes(bad_norm)) {", "      if (false) {", "rules.test.mjs — a do not play that is also a must play asks once", "a song on both lists is never questioned"),
    needle("script/rules.gs", "      if ((item.active === undefined || item.active) && (item.moments || []).some((mid) => gone.has(mid))) {", "      if (false) {", "rules.test.mjs — a moment switched off quietens its questions and makes none", "a part of the night that was cancelled keeps asking questions"),
    needle("script/rules.gs", "      if (shift_days) {", "      if (false) {", "rules.test.mjs — a reschedule keeps the event and walks every moment forward", "a moved date leaves every time on the old day"),
    needle("script/rules.gs", '    if (["unknown", "miles"].includes(state)) {', '    if (["unknown"].includes(state)) {', "rules.test.mjs — not sure yet and miles to suggest each open a question", '"Miles to suggest" stops putting anything on his list'),
    needle("script/rules.gs", '    if (!(_confirmed(answers, "event_name") || _confirmed(answers, "company"))) errors.push({field: "answers.event_name", message: "We need the event name or the company."});', '    if (false) errors.push({field: "answers.event_name", message: "We need the event name or the company."});', "rules.test.mjs — sending needs the five things and nothing else", "a form can be sent with no event name and no company"),
    needle("script/rules.gs", '    return "Waiting on " + who + ": " + client.length + " open question" + (client.length === 1 ? "" : "s") + ".";', '    return "Waiting on " + who + ": " + client.length + " open questions.";', "rules.test.mjs — one question is singular", "the one sentence Miles reads goes ungrammatical"),

    # store.gs: 12 guards
    needle("script/store.gs", '  if (!STORE_EVENT_ID.test(String(event_id || ""))) {', "  if (false) {", "store.test.mjs — a name that tries to be a path is refused in words", "a typed name can become a path into the event store"),
    needle("script/store.gs", "    if (submission_id && Object.prototype.hasOwnProperty.call(receipts, submission_id)) {", "    if (false) {", "store.test.mjs — the same send twice gives the same receipt and no second booking", "a repeat send is no longer recognised"),
    needle("script/store.gs", "    event.revision += 1;\n    event.updated_at = stamp;", "    event.revision += 0;\n    event.updated_at = stamp;", "store.test.mjs — a save answers with a receipt and moves the revision on", "an accepted save stops moving the revision on"),
    needle("script/store.gs", "    if (/^ev_[0-9a-f]{10}\\.json$/.test(file.getName())) found.push(file);", "    if (/\\.json$/.test(file.getName())) found.push(file);", "store.test.mjs — a write cut off half way leaves the last good answer standing", "a half-written temp file is read as if it were an event"),
    needle("script/store.gs", "function _lock_for(event_id) { return LockService.getScriptLock(); }", "function _lock_for(event_id) { return {waitLock: function () {}, releaseLock: function () {}}; }", "store.test.mjs — four processes make twenty saves and the revision never repeats", "every save gets its own lock, so two saves can run at once"),
    needle("script/store.gs", "      if (!dry) answer.previous = {value: answer.value, state: answer.state,", "      if (false) answer.previous = {value: answer.value, state: answer.state,", "store.test.mjs — what was there before is kept on every changed answer", "the old answer is thrown away instead of kept"),
    needle("script/store.gs", "      if (may_confirm(group, role, event.people || [])) applied[field] = touched[field];", "      if (true) applied[field] = touched[field];", "store.test.mjs — somebody who does not own the field only proposes", "anybody with a link can confirm anybody's decision"),
    needle("script/store.gs", "      if (combined[1].length) {", "      if (false) {", "store.test.mjs — two editors on one time get both values back and nothing is written", "two editors on one field quietly overwrite each other"),
    needle("script/store.gs", "grant.revoked_at ||", "false ||", "doors.test.mjs — a revoked link stops working on every door", "a link Miles took back still works"),
    needle("script/store.gs", "    if (!log.length) {", "    if (false) {", "store.test.mjs — a send that changes no answer still leaves a line in the history", "a revision with no history line, for good"),
    needle("script/store.gs", '    if (take !== "proposal" && take !== "current") {', "    if (false) {", "store.test.mjs — settling with a word that is not proposal or current is refused and the proposal stays", "a typo settles a proposal by throwing it away"),
    needle("script/store.gs", "(grant.expires_at && grant.expires_at <= now())", "false", "doors.test.mjs — a link that ran out stops working", "a link that ran out still works"),
    needle("script/store.gs", "Math.min(wanted, Number(event.revision || 0))", "wanted", "doors.test.mjs — the bookmark never runs past where the event is or moves back", "what Miles has read can run past the event and hide a change"),
    needle("script/store.gs", "wanted = Math.max(Math.min(wanted, Number(event.revision || 0)), standing);", "wanted = Math.min(wanted, Number(event.revision || 0));", "doors.test.mjs — the bookmark never runs past where the event is or moves back", "what Miles has read can move back and show him old changes again"),

    # The Host seam moved into the stand-in with the listeners (Google reads no
    # headers; CONTRACT section 11). Two needles, one per listener.
    needle("script/standin.mjs", "  if (!ownHost(request, port)) return answer(response, 421, 'bad host\\n', {'Content-Type': 'text/plain; charset=utf-8'});", "  if (false) return answer(response, 421, 'bad host\\n', {'Content-Type': 'text/plain; charset=utf-8'});", "standin.test.mjs — stand-in matches the two-listener Google hop", "any name pointed at this Mac can reach the pages door"),
    needle("script/standin.mjs", "  if (!ownHost(request, homePort)) return answer(response, 421, 'bad host\\n', {'Content-Type': 'text/plain; charset=utf-8'});", "  if (false) return answer(response, 421, 'bad host\\n', {'Content-Type': 'text/plain; charset=utf-8'});", "standin.test.mjs — stand-in matches the two-listener Google hop", "any name pointed at this Mac can reach the home door"),
    needle("script/doors.gs", "  delete seen.dj_notes; delete seen.receipts; delete seen.pending_people;", "  seen.dj_notes = null; delete seen.receipts; delete seen.pending_people;", "private.test.mjs — Miles's notes are nowhere in the client's reading", "Miles's private notes go to the client"),
    needle("script/doors.gs", '    if (person.person_id !== person_id) { person.email = ""; person.phone = ""; }', "    if (false) {}", "private.test.mjs — one person never sees another person's phone or email", "one person on the event reads everybody else's email"),
    needle("script/doors.gs", '          if (person && typeof person === "object" && person.person_id !== who.person_id) {', "          if (false) {", "private.test.mjs — a change to the people list never carries another person's details", "a change to the people list hands every client everybody's phone and email"),
    needle("script/doors.gs", '  return who.role !== "dj" && who.event_id !== event_id ?', "  return false ?", "doors.test.mjs — a link for one event cannot read another", "one client's link opens another client's event"),
    needle("script/doors.gs", '  if (!people.some(function (person) { return person.role === "approver"; })) {', "  if (false) {", "doors.test.mjs — a booking needs the person who says yes", "a booking starts with nobody who can say yes to anything"),
    needle("script/doors.gs", "    if (taken[role]) {", "    if (false) {", "doors.test.mjs — two people cannot share one role and lose a link", "two people on one role, and one of the two links is lost silently"),
    needle("script/doors.gs", '    return who.role === "dj" ? set_seen(body.event_id, body.revision) :', '    return true ? set_seen(body.event_id, body.revision) :', "doors.test.mjs — only Miles says what Miles has read", "a client can say what Miles has read and hide their own changes"),

    needle("script/store.gs", "        if (g.event_id === kw.event_id && g.person_id === kw.person_id && !g.revoked_at) { g.revoked_at = now(); taken += 1; }", "        if (g.event_id === kw.event_id && g.person_id === kw.person_id && !g.revoked_at) { taken += 1; }", "doors.test.mjs — Miles can take back every link one person holds, and only Miles", "taking a person's links back counts them and revokes nothing"),
    # daysheet.gs: 2 guards
    needle("script/daysheet.gs", '  return (question.option_labels || {})[tz] || String(tz || "").split("/").pop().replace(/_/g, " ") + " time";', '  return String(tz || "");', "doors.test.mjs — the day sheet prints the revision the zone and the cue words", "the day sheet shows the zone as a file name again"),
    needle("script/daysheet.gs", '  return FORMULA_STARTS.indexOf(text.slice(0, 1)) !== -1 ? "\'" + text : text;', "  return text;", "doors.test.mjs — a cell that would run as a formula leaves behind a quote", "a pasted formula runs when the sheet is opened"),
]


def count_needles(only):
    sources, problems, chosen = {}, [], []
    for item in NEEDLES:
        name, find = item[0], item[1]
        if only and only not in name:
            continue
        if name not in sources:
            sources[name] = (CORPORATE / name).read_text(encoding="utf-8")
        hits = sources[name].count(find)
        if hits != 1:
            problems.append((name, find.strip().splitlines()[0], hits))
        else:
            chosen.append(item)
    return chosen, problems


def run_suite(folder):
    done = subprocess.run("node --test corporate/tests/*.test.mjs", cwd=folder,
                          shell=True, capture_output=True, text=True, timeout=900)
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
            print("  %-22s %-4s %s" % (name, "%d x" % hits, line))
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
        print("Baseline green: node suite passed\n")
        rows = []
        for name, find, put, expect, story in chosen:
            room = fresh_copy(tempfile.mkdtemp(dir=scratch))
            target = Path(room) / "corporate" / name
            source = target.read_text(encoding="utf-8")
            assert source.count(find) == 1, "the copy lost the needle: %s" % name
            target.write_text(source.replace(find, put), encoding="utf-8")
            code, unused = run_suite(room)
            caught = code != 0
            rows.append((name, story, expect, caught))
            print("  %-8s %s" % ("caught" if caught else "SURVIVED", story))
        print("\n%-22s %-56s %-72s %s" % ("file", "what was broken", "the check that should notice", "result"))
        print("-" * 164)
        for name, story, check, caught in rows:
            print("%-22s %-56s %-72s %s" % (name, story[:56], check[:72], "caught" if caught else "SURVIVED"))
        survived = [row for row in rows if not row[3]]
        print("-" * 164)
        print("%d of %d caught." % (len(rows) - len(survived), len(rows)))
        if survived:
            print("\nA survivor is a question about the check, never a reason to lower it.")
            print("Ask: does the fixture contain the trap at all?")
            return 1
        return 0
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
