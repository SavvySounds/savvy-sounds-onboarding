# Corporate onboarding — how to prove it works

Everything for corporate bookings lives in this one folder. Nothing outside it
was touched: the wedding form, the couple's page, the Aruba sheet and the
quality-check page are exactly as they were.

Run every command from the folder one level up from this one (the top of this
working copy). Nothing here opens a window, plays a sound or takes the mouse.

**What is finished:** the part that remembers — the questions, the saving, the
private links, the rules that turn an answer into a job, and the printable day
sheet. **What is not:** the two screens. They are one placeholder page each
that says "Screen coming", written by the crew after this one. The doors behind
them are real and complete.

**The one thing still left to Miles:** this runs on his own Mac. For a client
to reach it from their phone it has to live somewhere they can get to. That is
a decision, not a build step, and nothing here pretends otherwise.

---

## Look at it working (two minutes)

    python3 corporate/seed.py
    python3 corporate/server.py

The first command empties the practice store and puts two invented events back
in it — a small networking evening and an awards dinner with dancing past
midnight. It prints a private link for every person on each event and one for
Miles's own view. The second opens the door at `http://127.0.0.1:8790/`.

Stop the server with control-C.

Expect: six private links, one for Miles, and two lines like
"Waiting on Theo: 8 open questions."

---

## The questions (`questions.json`)

This is the form's whole vocabulary: six sections, 52 questions, and for each
one who owns the answer, what kind of answer it is, and whether it offers
"Miles to suggest" as well as "Not sure yet".

    python3 -c "import json; q=json.load(open('corporate/questions.json')); \
      print(len(q['questions']),'questions'); print(q['sections'])"

Expect: `52 questions` and the six section names in order.

Clean versions are ON before anybody touches the form:

    python3 -c "import json; q=json.load(open('corporate/questions.json')); \
      print([x['default'] for x in q['questions'] if x['id']=='clean_versions'])"

Expect: `['clean']`.

---

## The store — one writer, and only one (`store.py`)

Everything that gets remembered is written by this one file and nothing else.
A check reads the other files' source and fails if any of them names the store
folder or puts bytes on the disk itself.

    python3 -m unittest corporate.tests.test_one_writer -v

Expect: 5 checks green, including one that poisons a copy of a clean file and
watches the check notice — so a green here is a green that has been seen to
go red.

### Prove a broken write is survived

Every save writes to a temporary file first, pushes it all the way down to the
disk, then renames it over the real one in a single step. Nothing ever reads a
temporary file, so a save cut off half way leaves the last complete answer
standing.

    python3 -m unittest corporate.tests.test_store.BrokenWrite -v

That check plants a half-written file beside a good event, reads the event back
and gets the good one, then saves on top of it and reads that back too.

To watch it fail if that ever breaks, the mutation runner below turns the
"only read the real files" line into "read everything" — and the check goes red.

---

## The rules — the part with no disk and no server (`rules.py`)

Who owns which decision, what happens when two people edit at once, how long
the music has to cover, and what a change sets off.

    python3 -m unittest corporate.tests.test_rules -v

Expect: 37 checks green. The ones worth knowing by name:

- dancing from 21:30 to 00:30 counts as **180 minutes**, and midnight is not a
  hole in the night.
- switching the awards on asks **exactly five** questions and no more: the
  recipients' names and how to say them, the walk-on music, the exact words
  that start and stop the music, who introduces whom, and who calls each cue.
- moving a time flags every cue underneath it and adds two questions: re-confirm
  the cue, re-check soundcheck and arrival.
- a song on the must-play list that is also on the do-not-play list asks once,
  not once per run.
- a part of the night that gets cancelled goes quiet and stops asking for
  anything.
- moving the date keeps the same event and walks every time forward with it.
- running the whole thing twice adds nothing the second time.

### Prove the checks are reading THIS code

The checks are worthless if they are reading something else. Break the brain on
a copy and watch them go red:

    cp corporate/rules.py /tmp/rules-kept.py
    python3 - <<'EOF'
    import pathlib
    p = pathlib.Path("corporate/rules.py")
    p.write_text(p.read_text().replace(
        'return {"target_min": target', 'return {"target_min": 0'))
    EOF
    python3 -m unittest corporate.tests.test_rules            # expect RED
    cp /tmp/rules-kept.py corporate/rules.py
    python3 -m unittest corporate.tests.test_rules            # expect green

Do not undo it with git — that eats work nobody meant to lose. Copy the file
back from where you put it.

---

## The doors (`server.py`)

A local address is not a lock. Another program on this Mac, a browser add-on,
or a web page that points a made-up name at this Mac can all knock on the door.
So every request is checked in **one place** before it is sent anywhere:

- the address it says it came to has to be this one, or it gets 421;
- anything that saves and says which page it came from has to say this one, or
  it gets 403.

    python3 -m unittest corporate.tests.test_http -v

Expect: 30 checks green over real HTTP on port **8791** — never 8790, which is
the one the preview uses. A busy 8791 makes these checks RED, not skipped: a
check that cannot look refuses, it never answers "fine".

By hand, with the server running and a private link from `seed.py`:

    T=<paste one of the tokens from seed.py>
    curl -s -o /dev/null -w '%{http_code}\n' -H "Host: somewhere-else.example.com" \
      -H "X-Access-Token: $T" http://127.0.0.1:8790/api/me          # expect 421
    curl -s -o /dev/null -w '%{http_code}\n' -H "X-Access-Token: $T" \
      http://127.0.0.1:8790/api/me                                   # expect 200
    curl -s -o /dev/null -w '%{http_code}\n' -X POST \
      -H "Origin: https://somewhere-else.example.com" \
      -H "X-Access-Token: $T" -H 'Content-Type: application/json' \
      -d '{}' http://127.0.0.1:8790/api/events/EV/save               # expect 403

---

## Private things stay private (`test_private.py`)

Miles's own notes on an event, and the phone numbers and emails of the other
people on it, are **removed** from what a client's page is given — not hidden
with styling, not left in and covered up.

    python3 -m unittest corporate.tests.test_private -v

Expect: 9 checks green. One of them reads the same event twice, once as Miles
and once as a client, and looks for his note in the words themselves.

Where the line is drawn, and why: a client sees their own row in the contact
list in full and everybody else's with the email and phone emptied. They do see
the answers their own side typed into the form — that is the form working; they
have to be able to read back what they wrote before they send it.

---

## Nothing real ships (`test_ship_safe.py`)

This folder goes into a public place. Three sweeps:

    python3 -m unittest corporate.tests.test_ship_safe -v

1. Every name in the two invented events, and every name on the two screens, is
   on the short allowlist of people and places that do not exist. The four song
   lines are pinned exactly.
2. No file here spells this Mac's home-folder path, or the tail that a throwaway
   session folder is named with. Both spellings are built from pieces inside the
   check so the check itself does not contain either of them, and this file
   describes them in words rather than writing them down.
3. A couple of real surnames from other work on this Mac must not appear. They
   are pinned by the first eight characters of a fingerprint, so the names never
   enter this folder at all — and before the sweep trusts a clean answer it
   proves its own eyes by finding a name it knows IS here.

To watch sweep 1 work, put a real person's name into one of the invented events
and run it again — it goes red and says which name and where. Copy the file back
afterwards.

---

## Breaking it on purpose (`tests/mutate.py`)

    python3 corporate/tests/mutate.py

Expect the last line to read **27 of 27 caught**, above a table naming each
thing that was broken and the check that noticed.

It works on a fresh copy of this folder in a throwaway folder it makes for
itself, one break at a time, with stale compiled files switched off. Three
things it refuses to do:

- If any of its quotes no longer matches the source exactly once, it stops
  before it starts and says which. A quote that has rotted is a rotted quote,
  not an untested guard — they want different repairs and never share a heading.
- If the checks are already red it stops, because a red start scores every
  break as "caught".
- Anything that survives is a question about the check, never an excuse to
  lower it.

Both refusals have been watched happening.

Narrow it while working on one file:

    python3 corporate/tests/mutate.py rules

---

## Everything, in order

    corporate/run-all.sh

The checks, then the breaking-on-purpose, then the walk through the real screens
once the screen crew has written it. Red anywhere and the whole thing exits red.
Until `corporate/proof/walk.mjs` exists, the run says out loud that it proves
nothing about the screens.

Takes about a minute and a half.

---

## Client page — written by the screen crew

Placeholder. `corporate/client/index.html` currently says "Screen coming".

When it lands, this section gets: how to open a private link on a phone and on a
laptop, filling the form in without losing a half-typed answer, the review step,
the receipt with the event name and revision on it, what a failed save looks
like and that the answers are still there, and the same walk with the keyboard
only.

## Miles's page — written by the screen crew

Placeholder. `corporate/dj/index.html` currently says "Screen coming".

When it lands, this section gets: the list of events, "what changed" and "what
needs me", resolving the planner's proposed awards time, and checking that the
client's page, Miles's page and a freshly printed day sheet all agree on the
same revision and the same values.

---

## What the practice events are for

`corporate/seed.py` empties the practice store and loads two invented events.
Nothing in them is real.

**Harbor Studio Networking** — a straightforward evening. Arrival, then two and
a half hours of networking, then lights up. No awards, no dancing.

**Northstar Staff Awards** — everything that can go wrong in one night. The
event is in a different time zone from this Mac. The dancing runs past midnight.
One song is on the must-play list and the do-not-play list at the same time.
There is a pronunciation note that has to be printed word for word. And the
planner has already proposed moving the awards from 20:00 to 20:15, which is the
disagreement Miles settles in the walk.

The practice store (`corporate/data/`) is never committed, and `seed.py` refuses
to empty that folder if it finds anything in it that this tool did not make.
