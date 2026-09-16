# Corporate onboarding — how to prove it works

Everything for corporate bookings lives in this one folder. Nothing outside it
was touched: the wedding form, the couple's page, the Aruba sheet and the
quality-check page are exactly as they were.

Run every command from the folder one level up from this one (the top of this
working copy). Nothing here opens a window, plays a sound or takes the mouse.

**What is finished:** the whole thing, as a proven local preview — the
questions, the saving, the private links, the rules that turn an answer into a
job, the printable day sheet, the client's page and Miles's page — and, since
09-14 evening, the shape it takes when it goes live: the pages on the free
GitHub Pages home, the answers in Miles's Google Drive behind a Google Apps
Script that IS the brain. The script is `corporate/script/*.gs`; the same file
runs on this Mac in node as its own stand-in, so every check below exercises
the real code, not a copy of it.

**What is not:** nothing has been published. The script has not been pasted
into Google, the address is not on the domain, the one line in `home.js` is a
placeholder. "Going live" at the bottom is the exact set of clicks; they are
Miles's.

---

## Look at it working (two minutes)

    node corporate/script/seed.mjs
    node corporate/script/standin.mjs

The first command empties the practice store (`corporate/data/drive/`) and
puts two invented events back in it — a small networking evening and an awards
dinner with dancing past midnight. It prints a private link for every person
on each event and one pass for Miles's own view. The second opens two doors:
the pages at `http://127.0.0.1:8790/` and a stand-in for Google at
`http://127.0.0.1:8793/`, deliberately on a different origin so the pages
reach their home the way they will from the real address.

Stop it with control-C.

Expect: six private links ending in `/corporate/client/#<32 characters>`, a
line "Miles's own view: …/corporate/dj/", his pass, and two lines like
"Waiting on Theo: 8 open questions."

---

## The script (`corporate/script/`)

| File | What it is |
|---|---|
| `rules.gs` | the brain with no disk: validate, who owns what, merge and conflict, effects, next action, `clock()` |
| `store.gs` | the ONE writer: the event files, the history, the links, the receipts, the revision, the lock |
| `doors.gs` | `doPost` — every door of `CONTRACT.md` §6 behind one address — plus `setup()` and `doGet` |
| `daysheet.gs` | the day sheet and its spreadsheet |
| `load.mjs` | node only: runs the `.gs` files in one shared scope with Google's Drive, lock, properties and output services stood in over a folder on disk |
| `standin.mjs` | node only: serves the pages and answers the script's address the way Google does (a redirect to a one-shot answer) |
| `seed.mjs`, `bundle.mjs` | the practice events; the one file to paste into Google |

Every function keeps the name it had in the Python it replaced, so a check or
a deliberate break written for one still names the other.

    node corporate/script/bundle.mjs | head -3
    node corporate/script/bundle.mjs | wc -c

Expect the first line `// ---- daysheet.gs ----` and about 88,000 characters,
all of them plain ASCII (the bundler refuses otherwise — a paste through the
clipboard must not change a byte).

---

## The checks (`corporate/tests/*.test.mjs`)

    node --test corporate/tests/*.test.mjs

One file per piece of the script, one `describe` per subject, every check
named in words. Expect `pass 115`, `fail 0`, `skipped 0` in well under two
seconds. Among them:

- `rules.test.mjs` — every rule (while the port was being made, a parity
  check ran the old Python brain beside it on both practice events and diffed
  every answer; it went with the Python once the two agreed). Also the words:
  every part of the night and every time zone in `questions.json` has plain
  words of its own (a zone's never spelled like a file name), and the words
  the moments control needs — Starts, Ends, "What is it?" — are in that file,
  not in the page.
- `store.test.mjs` — receipts, repeat sends, both values on a clash,
  proposals, the four states after a round trip, a half-written history
  line, the last good answer standing after a cut-off write, and the lock:
  four node processes saving on one event at once land all twenty saves on
  twenty distinct revisions.
- `doors.test.mjs`, `private.test.mjs` — every door with the right and the
  wrong link; Miles's notes and other people's details never reach a client;
  the brief and the day sheet carry the name a client gave "Something else"
  (the practice raffle) and say the zone as "Central time (Chicago)", never
  `America/Chicago`.
- `standin.test.mjs` — the stand-in on a private port: a foreign `Host` is
  turned away on both doors, a path cannot climb out, the answer comes
  through the redirect with the header a browser needs, once.

### Prove the checks are reading THIS code

    cp corporate/script/rules.gs /tmp/rules-kept.gs
    sed -i '' 's/hour < 12 ? "AM" : "PM"/hour < 12 ? "AM" : "AM"/' corporate/script/rules.gs
    node --test corporate/tests/rules.test.mjs        # expect fail 2
    cp /tmp/rules-kept.gs corporate/script/rules.gs
    node --test corporate/tests/rules.test.mjs        # expect fail 0

### Prove the lock is doing the work

    cp corporate/script/store.gs /tmp/store-kept.gs
    sed -i '' '/^function save(/,/^}/s/lock.waitLock(30000);//' corporate/script/store.gs
    node --test corporate/tests/store.test.mjs        # expect fail 1: saves lost
    cp /tmp/store-kept.gs corporate/script/store.gs

---

## One writer, and only one (`test_one_writer.py`)

    python3 -m unittest corporate.tests.test_one_writer -v

Reads the source, not memory: among the `.gs` files only `store.gs` may name
Drive, and among the node files only `load.mjs` (the stand-in's disk under the
writer) may put bytes on the disk. The check breaks a copy of `doors.gs` on
purpose and shows it would see it.

## Nothing real ships (`test_ship_safe.py`)

    python3 -m unittest corporate.tests.test_ship_safe -v

Every proper name in the practice events and on both screens is one we
invented; no file in this folder spells this Mac's home folder or a session
scratch folder; two real surnames are pinned by fingerprint and must not appear.

---

## Breaking it on purpose (`tests/mutate.py`)

    python3 corporate/tests/mutate.py
    python3 corporate/tests/mutate.py store          # one file's breaks only

Every needle is counted against the source before anything runs (a quote that
matches nowhere or twice stops the run in words); the unbroken checks run
first and a red baseline refuses to go on; each break gets a fresh copy of the
folder in a temp directory the runner owns. Expect `38 of 38 caught.` (13 in
the rules, 13 in the writer, 8 in the doors, 2 in the day sheet, 2 in the
stand-in's Host seam).

---

## Everything, in order

    corporate/run-all.sh

Five steps. The two sweeps, then the checks (115), then the breaking-on-purpose
(38), then `corporate/proof/walk.mjs`: the client walk (the networking event at
phone width) and Miles's walk against one shared stand-in on 8794, then the
Stage 1 loop itself — the planner moves the awards start 8:00 PM → 8:15 PM on
the real page, Miles sees both times with Jules named and takes it, the
approver's brief, Miles's view and the day sheet agree on one revision, the
sheet marks the dancing block "into the next day", the CSV has no formula cell,
and the networking event submits on a phone and shows its receipt. Then, fifth,
`corporate/proof/walk-dj.mjs` on its own: its own seed, its own server on 8800
(never the preview's 8790/8793, never the shared walk's 8794/8797, so the two
walks cannot meet even back to back). Red anywhere and the whole thing exits
red — a red reading on Miles's page reds the run in its own named step.

Takes about twelve minutes. `CORP_GATE_ONLY=1 node corporate/proof/walk.mjs`
reruns just the loop while fixing it (about two minutes).

Every time a person reads is shown with AM or PM. The one rule lives in
`rules.gs` as `clock()`; the pages carry their own copy in `client.js` and
`dj.js`.

---

## Client page

The page a client opens from their private link: `corporate/client/index.html`
with `client.css` and `client.js` beside it. Six parts of a form, a read-back
before they send, a receipt, and the brief for their event. Every question,
every helping line, every option and every one of the five answer states is
read out of `questions.json` at the moment the page opens — no question is
written down twice, and a word that file does not hold does not appear.

### Look at it working

    node corporate/script/seed.mjs
    node corporate/script/standin.mjs

`seed.mjs` prints a private link per person. Open one in a browser:

    http://127.0.0.1:8790/corporate/client/#<the 32 characters it printed>

The link works once as a link: the page takes the pass out of the address bar
and keeps it for that browser tab only, so the address goes back to
`http://127.0.0.1:8790/corporate/client/` and a shoulder-surfed screen shows
nothing. (Live, the same link starts `https://clients-prep.savvysoundscollective.com`.) A refresh
still works; a fresh tab does not, which is the point.

To see it the way a client will, make the window 390 wide (Chrome: View >
Developer > Developer Tools, then the phone icon, iPhone 14 Pro).

Expect, in order: the words "Let's set the tone for your event.", the name of
the event, who the page thinks you are, and where you left off. **Continue**
walks the six parts; the bar at the top fills as you go; the line at the bottom
says one of exactly four things and nothing else:

| The line says | It means |
|---|---|
| `Saved · revision 7` | The event has it. |
| `Saving…` | On its way. |
| `Not saved yet — your answers are still here.` with **Retry** | The door said no. Nothing was lost. |
| `Saved on this device only — not yet sent to Savvy Sounds.` with **Retry** | The line is down. Nothing was lost. |

Things worth doing by hand once:

- Type half an answer and press **Back**, then **Next**. The half is still there.
- Press "Not sure yet" under any question. The box goes quiet but the words
  stay on screen; press it again and they come back, live.
- On **The moments**, turn "Something else" on. A box asks "What is it?";
  type a name (a raffle, a toast) and that name — not "Custom", not
  "Something else" — is what the read-back, the brief, Miles's page and the
  day sheet all call it.
- On **The moments**, turn Awards on, type into "How to say the tricky names",
  turn Awards off, turn it on again. The pronunciation is still there.
- Stop the server (control-C), type something, wait two seconds: the bottom
  line says the answers are on this device only. Start the server again and
  press **Retry**: one save, one revision, nothing landed twice.

### The walk that proves it

    node corporate/proof/walk-client.mjs

It needs nothing running: it seeds a practice store of its own in a throwaway
folder the Mac hands out for temporary work, opens a server on a free port
(never 8790, so it cannot touch what you are looking at), and drives a real
headless Chrome. It walks **both** practice events at **390x844** and at
**1440x900**, plus the planner's own screen on the awards event, and kills
every process it started before it prints the last line.

Expect the last line to read **217 of 217 checks passed** and one `PASS` line
per check above it — the last of them says the walk left nothing of its own
running, because one of its servers once sat on a random port for twenty
minutes after a run. Any `FAIL` and it exits red. Frames land in
`corporate/proof/frames/` (not kept in the repo).

What it measures, in numbers, on the real screen:

| Reading | Needs | Measured |
|---|---|---|
| Body text on the paper | 7:1 | **8.77:1** (ink 78,72,60 on 253,251,246) |
| A question's label | 7:1 | **16.04:1** |
| The gold action button | 4.5:1 | **5.13:1** (cream 255,249,238 on gold 142,98,16) |
| Controls reached by Tab, each wearing our own ring | all of them | **8 of 8, 0 with only Chrome's grey ring** |
| Every control's height | 44px | all of them |
| Page width against window width | never wider | **390 in 390**, **1440 in 1440**, every screen |
| With motion turned down | arrives finished | opacity 1, no transform, 0 animations running |

And in words: every part of the night on the form and every time zone on
offer is the plain phrase `questions.json` gives it, in that file's order —
"Guests arrive", "Something else", "Central time (Chicago)" — and nothing on
the form, the read-back or the brief ever reads like a file name
(`America/…`) or a bare word ("Custom"). The Starts and Ends words under a
part of the night, and the "What is it?" that asks for a name, are read out
of that file too. On the networking event (no planner, so the person who
signs it off owns the running order) the walk types "Charity auction" into
that box and reads it back off the booking, the read-back and the brief. On
the awards event the box already holds the practice booking's own "Raffle".

And in behaviour: the four answer states come back apart from each other
(`blank` / `none` / `unknown` / `confirmed`); a refresh mid-form brings the
draft back; a save under way never takes the box away from the person typing;
sending without a needed answer puts the door's own words beside that question
and the cursor in it; the receipt carries the event's name and revision; the
same attempt sent twice gives the same receipt and no second revision; two
people changing one answer opens the two-answers screen with both values, the
name of who changed it and when; the person who owns a decision sees it and
nobody else does; and a link that has run out says "This link has expired — ask
Miles for a fresh one." and shows nothing else at all.

### Watch the walk catch a real break

The two-answers screen only ever appears because the page tells the door which
revision it was looking at. Take that away and the client silently overwrites
whatever Miles typed:

    cp corporate/client/client.js /tmp/client-kept.js
    python3 - <<'EOF'
    import pathlib
    p = pathlib.Path("corporate/client/client.js")
    p.write_text(p.read_text().replace(
        "var body = {base_revision: S.event.revision, submission_id: S.attempt,",
        "var body = {submission_id: S.attempt,"))
    EOF
    CORP_WALK_ONLY=harbor-390 node corporate/proof/walk-client.mjs     # expect RED
    cp /tmp/client-kept.js corporate/client/client.js
    CORP_WALK_ONLY=harbor-390 node corporate/proof/walk-client.mjs     # expect green

Seen going red, twice, on the run above: *"when two people change one answer
the page shows both, side by side — no two-answers screen … the door answered
200"*, and then *"no control says Keep mine"*. The door answers 200 because it
has been told the page saw the newest revision, which it had not — so one
person's answer quietly lands on top of the other's. Put the file back with the
copy, never with git: that eats work nobody meant to lose.

`CORP_WALK_ONLY=harbor-390` narrows the walk to one event at one width while
working; leave it off for the whole thing.

Seen going red on 2026-09-16, one break at a time, restored from a copy each
time: the chips drawing the bare word (`text: kind` in `momentsControl`) —
"the parts of the night are the file's plain words" and "no part of the night
is a bare word like Custom" both red, and the walk stopped there because no
control said "Something else"; the name box writing nothing
(`setMoment(kind, {})`) — "the name reaches the booking" red with `[""]`, and
the read-back and the brief red after it; the brief spelling the zone the
machine's way (`placeOf` returning the zone) — "the brief says which clock its
times are on" red with `America/Los_Angeles`. And with the `moments` labels
deleted from `questions.json`, `rules.test.mjs` goes red twice before any
browser opens.

### What the two design passes found

The finished screens went through a design review and an Apple-HIG usability
review, both reading the real frames. What changed because of them:

- A letter typed while a save was in the air was thrown away on any connection
  slower than this Mac talking to itself, because the draft was cleared by
  matching the answer's *state* instead of its value. Now only what was really
  sent is let go, and a save that lands while somebody is typing redraws the
  status line alone. There is a check for it.
- The bar at the top never went away — a `display` rule of ours outranks the
  browser's own way of hiding things — so a full six-of-six bar sat over the
  review, the receipt and the brief.
- Every tap threw the focus to the top of the document: the code that was meant
  to put it back read a value nothing ever set. On a phone that closes the
  keyboard mid-answer.
- The error ink measured 4.97:1 and is now 7.97:1.
- "Not sure yet" used to take the typed words off the screen. They were kept,
  but nobody could tell. They now stay, quietly.
- The read-back said "The parts of the night — Not answered" however many parts
  were set, because they are kept beside the answers and it never went to look.
- Times read `18:00`; they now read `6:00 PM`, and `21:30 to 00:30` reads
  "9:30 PM to 12:30 AM, into the next day". The date reads
  "Friday, November 6, 2026". The brief called a venue "Where" when the form
  calls it "Venue".

### Where this page refuses

- **The parts of the night and the time zones wear `questions.json`'s words
  and nothing else (fixed 2026-09-16).** The `moments` question's
  `option_labels` name every part in plain words ("Guests arrive", "Wrapping
  up", "Something else"); its `time_labels` carry Starts and Ends, and its
  `custom_name` carries the "What is it?" box that lets a client name
  "Something else" — that name is the part's own label from then on, on every
  screen. The `tz` question's `option_labels` read "Pacific time (Los
  Angeles)" and so on; the brief says "Every time below is Central time
  (Chicago)." A zone the file does not list gets no words in the brief rather
  than a machine's spelling. The page has no fallback word of its own for
  either: a part with no label in the file would show its bare id, and the
  check in `rules.test.mjs` plus the walk's chip readings make sure that
  never ships.
- **Single-answer choices are toggle buttons**, not radio buttons, so each is
  its own tab stop and a screen reader says "pressed" rather than "one of
  seven". That is the deliberate call: on a phone, one reachable control per
  answer beats an arrow-key group, and the walk counts the focus ring on every
  one of them.

---

## Miles's page

His own view of every corporate booking. Nobody else can open it.

### How to reach it

    node corporate/script/seed.mjs
    node corporate/script/standin.mjs

Then open `http://127.0.0.1:8790/corporate/dj/` and paste the pass `seed.mjs` printed
("His pass, for the page to carry"). The pass lives in that browser window and
nowhere else: not on the disk, not in the address bar. Close the window and it
is gone; open it again and it asks once more.

What he sees, in this order: every booking with the one that needs him at the
top; inside a booking, what needs him, what is waiting on each person by name,
the running order, what changed, the brief, the day sheet, and his own notes.
Every time on this page is shown with AM or PM; its one JavaScript spelling is
`clock()` in `dj/dj.js`.

### The walk that proves it

    node corporate/proof/walk-dj.mjs

It takes about two minutes. It seeds its own practice store, starts its own
server on port **8800** with its home on 8803 (never the preview's 8790/8793
nor the shared soundcheck's 8794/8797 — it refuses the preview's two outright
— and a busy 8800 is a RED walk, not a skipped one), opens a headless Chrome
nobody can see, and
prints one line per reading with the number it measured. Nothing pops up,
nothing makes a sound, and it kills its own server and its own Chrome before it
prints the last line.

Expect the last line to read **110 of 110 readings passed**, and pictures of
the real screen in `corporate/proof/frames/` (not committed).

What it measures, and what it read on 2026-09-14 (the last four rows added
2026-09-16):

| Reading | Measured |
|---|---|
| the window it thinks it is in | 390 and 1440 wide, and the page visible both times |
| a wrong pass | shows the door's own words, and never reaches the address bar |
| the three counts on the overview | equal to the numbers the door answers, every event, both widths |
| the planner's proposed time | 8:00 PM and 8:15 PM both on screen, Jules named, "Take Jules's 8:15 PM" / "Keep 8:00 PM" |
| taking it | revision moves 3 → 4, the running order shows 8:15 PM–9:00 PM, the cue under it is flagged, 2 new questions appear under the people who owe them |
| marking it as looked at | "changes since you last looked" goes to 0, one client save later it is 1 |
| his own question | answered from the page, off the list, and what he wrote is what was kept |
| the dancing | 9:30 PM–12:30 AM, "finishes the next day", counted as 3 hrs |
| the day sheet | opens in its own tab and carries the same revision as the view (3), says it is a snapshot, and does not carry his private note |
| sideways scroll | none: 390px of page in a 390px window, 1440 in 1440 |
| the keyboard | 18 stops at 390 and 19 at 1440, every one of them with a real ring, none under 44px tall |
| contrast on the real ground | worst word 7.79:1 (the floor is 7), worst action 4.65:1 (the floor is 4.5), 201 pieces of text measured |
| Copy | says "Copied" only when the clipboard actually took it; when the browser refuses it selects the words and says "Press ⌘C" |
| with motion turned down | the screen is byte-for-byte still |
| the pictures | each one is checked against the window it claims to be of |
| the words | every name on screen came from the booking or from the short list of words this page says in its own voice |
| who owns which decision | the three tables in `dj/dj.js` are read out of `script/rules.gs` and compared |
| somebody else's words | nothing on the page turns them into markup |
| the zone, in words | "Central time (Chicago)" from `questions.json`, and no `America/` anywhere on the page or the sheet |
| the part the client named | "Raffle" on his running order and on the day sheet, never "Custom" or a made-up phrase |
| the zone picker on "Start a booking" | the form's six zones, each in the form's words, and "Somewhere else" left off |

**This walk is in `corporate/run-all.sh` twice over:** once inside
`corporate/proof/walk.mjs` against the shared stand-in on 8794, and once on
its own as step 5 of 5, on 8800. A red reading in either reds the whole run.

### Prove the walk can see a break

Copy the file first, break it, watch the walk go red, then copy it back. Never
undo it with git — that eats work nobody meant to lose.

    cp corporate/dj/dj.js /tmp/dj-kept.js
    # take out the words "finishes the next day"; change one line of the
    # owner table (music_owner) ; add an innerHTML somewhere
    node corporate/proof/walk-dj.mjs        # expect RED, three named readings
    cp /tmp/dj-kept.js corporate/dj/dj.js
    node corporate/proof/walk-dj.mjs        # expect green again

Watched happening on 2026-09-14: those three went red and nothing else did,
and each line said what to repair. A fourth (a 700px minimum width in the
stylesheet) turned the sideways-scroll reading red at 390 and named the three
things hanging over the edge; a fifth (a Copy button that says "Copied" when
the clipboard refused) turned the honesty reading red.

Watched on 2026-09-16: `zoneWords` returning the raw zone and the running
order drawing `kindWords(moment.kind)` instead of the moment's own label —
five readings red (both zone lines on the phone, the "Raffle" line, and two
on the booking form's picker), 105 of 110, nothing else. The day sheet's own
two breaks (`_zone_words` returning the raw zone; `label: moment.kind`) each
red one check in `doors.test.mjs`, and the first is a needle in `mutate.py`.

### What the walk caught that looking would not have

Four real defects, all on the first run:

1. At 390 the page ran 25px off the side, because one line of the history
   printed a whole answer record as a single unbreakable word.
2. "37 changes since you last looked" measured 6.8:1 against its own
   background, under the 7:1 this work holds itself to.
3. The pictures were lying. A plain screenshot on this Mac lays the page out
   at the real window's width and then crops it to the narrow one, so the
   frames showed a wide page cut off at 390 while every live measurement said
   390 and was right. Frames are now captured whole and each one is checked
   against the window it claims to be of.
4. The walk itself read the screen in the gap between the sentence that says
   what happened and the screen being rebuilt, so it passed or failed on
   milliseconds. It now waits for the rebuilt screen.

### Marking an event as looked at, by hand

With the stand-in running and the pass from `seed.mjs` in `$T`, and an event
id from the list (every door is one POST to the home; `-L` follows the
redirect the way a browser does):

    H=http://127.0.0.1:8793/macros/s/local/exec
    curl -s -L -d "{\"door\":\"/api/events\",\"token\":\"$T\"}" $H \
      | python3 -c "import json,sys; [print(e['event_id'], e['changed_since_seen'], e['revision']) for e in json.load(sys.stdin)['events']]"
    curl -s -L -d "{\"door\":\"/api/dj/seen\",\"token\":\"$T\",\"body\":{\"event_id\":\"ev_...\",\"revision\":99}}" $H

Expect the door to answer with the event's OWN revision, never 99 — the
bookmark cannot run ahead of the record, and asking again with a smaller
number cannot move it back. Ask for the list again and that event's count of
changes since he last looked is 0.

### What the design passes found

Two passes on the finished screen: a design review reading the real pictures,
and a mechanical one that measured the live page in a browser.

**Changed because of them:**

| Found | Changed |
|---|---|
| The line above the two buttons said the planner "decides this one", and then the buttons let Miles decide it. A two-second hesitation at the worst moment. | It now says Jules "owns this part of the night". The buttons are his either way. |
| "Taken. Awards — start time is now what they asked for." cannot be checked by a man holding a microphone. | "Taken. Awards — start time is now 8:15 PM, was 8:00 PM." |
| "Take Jules's 8:15 PM" and "Keep 8:00 PM" were identical twins 10px apart on a phone, with no undo behind either. | Only the one that changes something is a filled button. |
| The cue he has to hit live, and the name he has to say, were the quietest things on the page — body-sized words on a background the same colour as an empty box. | Both are bigger, and "say it like this" sits on its own gold ground. The client's own words on that page: a wrong name is unrecoverable. |
| Seven jump buttons stood between him and the thing that needed him, eating a sixth of a phone screen before he read a word. | The first block comes first; the jump bar sits under it. |
| "37 changes since you last looked", and the first thirty-five were the form arriving in one second. | They fold into one line: "35 answers arrived together", with the names of the first six. The event page went from 13,000px to 8,700px on a phone. |
| "revision 3" was a pill in the top six lines, where it tells him nothing he can act on. | It moved next to the day sheet, which is the one place the number means something: a sheet printed from the same answers says the same number. |
| Every contact's words were a keyboard stop that does nothing, so reaching the last Copy took thirteen presses instead of six. | The words are words again; only the buttons are stops. |
| Sizes were in pixels, so making text bigger in his browser did nothing. | Everything is in rem. Bigger text makes the whole screen bigger, and the walk proves it: 16px to 24px, headings still bigger than the words, buttons still 44px, nothing off the side. |
| A prose line ran 122 characters at a desk. | Prose stops at 68 characters. |
| "The page and the server disagree about where they are." | "That did not reach your Mac the way it had to. Reload the page." |
| A change line printed the practice fixture's own word, "fixture loaded". | "This practice booking was loaded." |
| A moment with no length printed as "12:30 AM–12:30 AM". | It prints one time. |
| A pass that stops working mid-session left him on a screen he could not refresh. | Any door answering that the pass is finished takes him back to the one box that fixes it. |

**Found and deliberately kept:**

- The mechanical pass flags the coloured bar down the side of the cue block as
  a tell of machine-made design. It is the one thing that separates the words
  Miles says out loud from the words describing the moment, and it is ink, not
  a brand colour. Kept on purpose.
- The page is light only. A dark room is where he reads it, and a dark version
  is worth doing — but it belongs with the client's page, so the two sides of
  one tool are decided together, not in this folder alone.
- His own notes are shown, not editable. Writing them needs a door that does
  not exist yet.
- Taking a proposal cannot be undone from this page. Both values are on screen
  before the tap and in the sentence afterwards, and the change log keeps what
  it was — but putting it back needs an edit this screen does not have.

**One thing worth knowing about the mechanical pass:** run as it ships, it
cannot read this page at all. Every word on the screen is built as the page
runs, and the scanner reads files, so it reported nothing for a page it had
never seen. That is not a clean bill of health, and the walk in this section is
what actually reads the screen.

---

## What the practice events are for

`corporate/script/seed.mjs` empties the practice store and loads two invented events.
Nothing in them is real.

**Harbor Studio Networking** — a straightforward evening. Arrival, then two and
a half hours of networking, then lights up. No awards, no dancing.

**Northstar Staff Awards** — everything that can go wrong in one night. The
event is in a different time zone from this Mac. The dancing runs past midnight.
One song is on the must-play list and the do-not-play list at the same time.
There is a pronunciation note that has to be printed word for word. And the
planner has already proposed moving the awards from 20:00 to 20:15, which is the
disagreement Miles settles in the walk.

The practice store (`corporate/data/`) is never committed, and `seed.mjs` refuses
to empty that folder if it finds anything in it that this tool did not make.

---

## Going live (step 1 done 2026-09-16; step 2 is Miles's push and the address)

Everything below is the exact set of clicks; the local proof runs against a
stand-in of Google on this Mac. **Step 1 was done on 2026-09-16** in the
milesdipaola@gmail.com account: project "Savvy corporate prep", `setup` run
(the folder exists in Drive), deployed as a web app (Me / Anyone), and the
address is on the one line in `home.js`. The first `setup` run failed on a
file type Google does not have (`MimeType.JSON`); fixed in 3e14de4. Step 3's
curl lines were run the same day: the stranger got `403 link-expired`, the
pass got `{"status":200,"ok":true,"events":[]}`.

### 1. Put the script into your Google account (about three minutes)

    node corporate/script/bundle.mjs | LANG=en_US.UTF-8 pbcopy

That puts the whole script (one file) on the clipboard. Then, signed into the
Google account that owns your Drive:

1. Open https://script.google.com and press **New project**.
2. In the editor, click into the code box, select all (⌘A) and paste (⌘V).
   Name the project at the top: **Savvy corporate prep**. Press **Save** (⌘S).
3. In the toolbar, choose the function **setup** in the dropdown and press
   **Run**. Google asks for permission once (Drive) — allow it for this
   script. When it finishes, open **Execution log** (bottom) and copy the line
   `Your pass for the view: …` — that is your pass for your own page. Keep it
   somewhere private; it is not stored anywhere on GitHub.
   Running `setup` a second time changes nothing (same folder, same pass).
4. Press **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone**. Press **Deploy**, then copy the **Web app URL**
   (it ends in `/exec`).

Send that address to Fable. It goes on the one line in `corporate/home.js`.
Until it is there, both pages say "This page is not connected to its home
yet" and refuse to pretend.

Expect in your Drive afterwards: one folder **Savvy Sounds - corporate prep**
holding `access.json`; each booking adds `ev_….json` and `ev_….changes.jsonl`.

### 2. Put the pages on the address (about five minutes, after step 1)

1. The line in `corporate/home.js` is filled in (Fable) and committed; you
   press the push (that is the live button for the pages).
2. GitHub → the repo → **Settings → Pages → Custom domain**: type
   `clients-prep.savvysoundscollective.com`, **Save**. GitHub adds a `CNAME`
   file to the repo by itself.
3. Google Domains (your account) → DNS for savvysoundscollective.com → add
   one record: type **CNAME**, name **clients-prep**, data
   **savvysounds.github.io.** (with the trailing dot). Save. It can take
   up to an hour to be seen; the Pages settings page shows a green check when
   it is, and then **Enforce HTTPS** can be ticked.

**Say this out loud before pressing:** the wedding form lives at the root of
this same home, so its address ALSO becomes
`https://clients-prep.savvysoundscollective.com/` — every old link a couple
holds still lands (GitHub redirects the old address), but the address they see
changes. The form itself is untouched, byte for byte.

### 3. Prove it is live (Fable, after your clicks) — done 2026-09-16 on the github.io address

Walked on the live pages with the script as their home: the overview opened with
the pass and said "No bookings yet"; a practice booking (the invented Harbor
Studio names) was started from it and its private link printed; that link
opened on a phone-sized window, one answer typed, the bottom line read
"Saved · revision 2" and the events door answered revision 2 for it; the link
was revoked through the door and the phone then read "This link has expired —
ask Miles for a fresh one." Two defects found and fixed on the way: the script
asked Drive for a file type Google does not have (3e14de4), and the private
link was built from the origin alone, one folder too high on github.io
(6118283). **Still missing:** his page has no control to revoke a link — the
door exists (`/api/dj/access` with `{revoke}`), the button does not; until it
is built, a link is taken back with the curl line in this section.


- `curl -s https://clients-prep.savvysoundscollective.com/corporate/home.js`
  prints the script address, not the placeholder.
- A POST to the script address with `{"door":"/api/me","token":"x"}` answers
  `{"status":403,…}` through the redirect — the home is up and refusing
  strangers.
- Your own page at `…/corporate/dj/`, your pass typed in: the list is empty
  (no bookings yet) and says so. Start a practice booking with the fictional
  names from `corporate/fixtures/`, open its link on your phone, type one
  answer, see "Saved · revision 2", and read the same revision on your page.
  Then revoke that link from your page and confirm the phone says the link
  has expired.
