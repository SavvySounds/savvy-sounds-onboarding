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

## Client page

The page a client opens from their private link: `corporate/client/index.html`
with `client.css` and `client.js` beside it. Six parts of a form, a read-back
before they send, a receipt, and the brief for their event. Every question,
every helping line, every option and every one of the five answer states is
read out of `questions.json` at the moment the page opens — no question is
written down twice, and a word that file does not hold does not appear.

### Look at it working

    python3 corporate/seed.py
    python3 corporate/server.py

`seed.py` prints a private link per person. Open one in a browser:

    http://127.0.0.1:8790/c/<the 32 characters it printed>

The link works once as a link: the page takes the pass out of the address bar
and keeps it for that browser tab only, so the address goes back to
`http://127.0.0.1:8790/c` and a shoulder-surfed screen shows nothing. A refresh
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

Expect the last line to read **175 of 175 checks passed** and one `PASS` line
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

- **`questions.json` has no words for the parts of the night.** The `moments`
  question lists `arrival`, `dinner`, `awards`, `custom` and the rest as bare
  words with no `option_labels`, so the page shows them capitalised as they are
  written — including **Custom**, which is not a thing a client would say, and
  which they have no way to name once they turn it on. The page does not invent
  a word for it. Two words that the composite control needs and the file does
  not carry — **Starts** and **Ends** — are the page's own, and are flagged
  here rather than hidden.
- **The time-zone question has no plain labels either**, so its choices read
  `America/Los_Angeles`. `clean_versions` shows how it would be fixed
  (`option_labels`); `tz` was missed. In the brief, where the page is writing a
  sentence rather than offering a choice, it says "the clock in Los Angeles".
- **Single-answer choices are toggle buttons**, not radio buttons, so each is
  its own tab stop and a screen reader says "pressed" rather than "one of
  seven". That is the deliberate call: on a phone, one reachable control per
  answer beats an arrow-key group, and the walk counts the focus ring on every
  one of them.

### Two things this page could not fix from where it sits

**One check still needs one word changed, by whoever owns `tests/`.**
`tests/test_http.py` pins the placeholder: it asks the door for a private link
and looks for the words "Screen coming" on the page that comes back. The real
page does not say that, so that one check is red until its line reads something
the real page carries — `self.assertIn("Savvy Sounds", page)` does it. The same
line sits in `test_miles_page_opens` for the other screen, and will go red the
same way. Nothing else in the 109 checks is red.

**The names sweep can no longer see this screen.**
`tests/test_ship_safe.py` reads the words out of `client/*.html` and `dj/*.html`
only. Every word a client now reads comes out of `client.js` and
`questions.json` instead, so the sweep walks a shell with four words in it and
reports clean. The shell's own words were chosen to stay inside its allowlist,
but the sweep should be pointed at `client/*.js` and `dj/*.js` as well — and its
list of ordinary capitalised words will have to grow when it is.

### Note for whoever writes `run-all.sh`'s last step

`run-all.sh` looks for `corporate/proof/walk.mjs`. This crew wrote
`corporate/proof/walk-client.mjs` and the shared Chrome helper
`corporate/proof/cdp.mjs` (which Miles's screen and the final walk reuse). The
combined `walk.mjs` that `run-all.sh` names is still to be written, and should
call both screens' walks.

## Miles's page

His own view of every corporate booking. Nobody else can open it.

### How to reach it

    python3 corporate/seed.py
    python3 corporate/server.py

Then open `http://127.0.0.1:8790/dj/` and paste the pass `seed.py` printed
("His pass, for the page to carry"). The pass lives in that browser window and
nowhere else: not on the disk, not in the address bar. Close the window and it
is gone; open it again and it asks once more.

What he sees, in this order: every booking with the one that needs him at the
top; inside a booking, what needs him, what is waiting on each person by name,
the running order, what changed, the brief, the day sheet, and his own notes.

### The walk that proves it

    node corporate/proof/walk-dj.mjs

It takes about two minutes. It seeds its own practice store, starts its own
server on port **8793** (never 8790, which is the preview's, and a busy 8793 is
a RED walk, not a skipped one), opens a headless Chrome nobody can see, and
prints one line per reading with the number it measured. Nothing pops up,
nothing makes a sound, and it kills its own server and its own Chrome before it
prints the last line.

Expect the last line to read **91 of 91 readings passed**, and pictures of the
real screen in `corporate/proof/frames/` (not committed).

What it measures, and what it read on 2026-09-14:

| Reading | Measured |
|---|---|
| the window it thinks it is in | 390 and 1440 wide, and the page visible both times |
| a wrong pass | shows the door's own words, and never reaches the address bar |
| the three counts on the overview | equal to the numbers the door answers, every event, both widths |
| the planner's proposed time | 20:00 and 20:15 both on screen, Jules named, "Take Jules's 20:15" / "Keep 20:00" |
| taking it | revision moves 3 → 4, the running order shows 20:15–21:00, the cue under it is flagged, 2 new questions appear under the people who owe them |
| marking it as looked at | "changes since you last looked" goes to 0, one client save later it is 1 |
| his own question | answered from the page, off the list, and what he wrote is what was kept |
| the dancing | 21:30–00:30, "finishes the next day", counted as 3 hrs |
| the day sheet | opens in its own tab and carries the same revision as the view (3), says it is a snapshot, and does not carry his private note |
| sideways scroll | none: 390px of page in a 390px window, 1440 in 1440 |
| the keyboard | 18 stops at 390 and 19 at 1440, every one of them with a real ring, none under 44px tall |
| contrast on the real ground | worst word 7.79:1 (the floor is 7), worst action 4.65:1 (the floor is 4.5), 201 pieces of text measured |
| Copy | says "Copied" only when the clipboard actually took it; when the browser refuses it selects the words and says "Press ⌘C" |
| with motion turned down | the screen is byte-for-byte still |
| the pictures | each one is checked against the window it claims to be of |
| the words | every name on screen came from the booking or from the short list of words this page says in its own voice |
| who owns which decision | the three tables in `dj/dj.js` are read out of `rules.py` and compared |
| somebody else's words | nothing on the page turns them into markup |

**This walk is not yet in `corporate/run-all.sh`.** That file runs the checks,
then the breaking-on-purpose, then `corporate/proof/walk.mjs` — the client
page's walk, written by the other desk. A walk nobody runs is not a guard, so
whoever owns `run-all.sh` adds a line for `walk-dj.mjs` beside it. Until then
this one is run by hand, with the command above.

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

With the server running and the pass from `seed.py` in `$T`, and an event id
from the list:

    curl -s -H "X-Access-Token: $T" http://127.0.0.1:8790/api/events \
      | python3 -c "import json,sys; [print(e['event_id'], e['changed_since_seen'], e['revision']) for e in json.load(sys.stdin)]"
    curl -s -X POST -H "X-Access-Token: $T" -H 'Content-Type: application/json' \
      -d '{"event_id":"ev_...","revision":99}' http://127.0.0.1:8790/api/dj/seen

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
| "Taken. Awards — start time is now what they asked for." cannot be checked by a man holding a microphone. | "Taken. Awards — start time is now 20:15, was 20:00." |
| "Take Jules's 20:15" and "Keep 20:00" were identical twins 10px apart on a phone, with no undo behind either. | Only the one that changes something is a filled button. |
| The cue he has to hit live, and the name he has to say, were the quietest things on the page — body-sized words on a background the same colour as an empty box. | Both are bigger, and "say it like this" sits on its own gold ground. The client's own words on that page: a wrong name is unrecoverable. |
| Seven jump buttons stood between him and the thing that needed him, eating a sixth of a phone screen before he read a word. | The first block comes first; the jump bar sits under it. |
| "37 changes since you last looked", and the first thirty-five were the form arriving in one second. | They fold into one line: "35 answers arrived together", with the names of the first six. The event page went from 13,000px to 8,700px on a phone. |
| "revision 3" was a pill in the top six lines, where it tells him nothing he can act on. | It moved next to the day sheet, which is the one place the number means something: a sheet printed from the same answers says the same number. |
| Every contact's words were a keyboard stop that does nothing, so reaching the last Copy took thirteen presses instead of six. | The words are words again; only the buttons are stops. |
| Sizes were in pixels, so making text bigger in his browser did nothing. | Everything is in rem. Bigger text makes the whole screen bigger, and the walk proves it: 16px to 24px, headings still bigger than the words, buttons still 44px, nothing off the side. |
| A prose line ran 122 characters at a desk. | Prose stops at 68 characters. |
| "The page and the server disagree about where they are." | "That did not reach your Mac the way it had to. Reload the page." |
| A change line printed the practice fixture's own word, "fixture loaded". | "This practice booking was loaded." |
| A moment with no length printed as "00:30–00:30". | It prints one time. |
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
