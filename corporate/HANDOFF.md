# Corporate onboarding — handoff after Stages 0 and 1 (2026-09-14)

Written by the lead desk (Fable) for whoever picks this up: Miles, a later
Claude desk, or a Codex job. The plan is
`~/Documents/Savvy-Corporate-Onboarding-Build-Plan.md`; this note says what of it
is done, how it was proven, and what is deliberately not done.

## Where the work is

| What | Where |
|---|---|
| Bench (git worktree) | `~/Projects/savvy-sounds-onboarding-corporate`, branch `corporate-onboarding` (tip `d7f5996` at the time of writing), folded into `main` locally afterwards (nothing pushed) |
| Everything corporate | `corporate/` — one folder, its own `VERIFY.md`, `CONTRACT.md` (the words), `run-all.sh` (the whole gate) |
| The wedding form | Untouched. `index.html`, `laura-ronnie/`, `aruba/`, `quality-check/` are byte-identical to `b8d41d5`. |
| Runtime data | `corporate/data/` (gitignored — the repo is PUBLIC). `python3 corporate/seed.py` rebuilds it from the two fictional fixtures. |
| Screens | `corporate/client/` (the client's private page), `corporate/dj/` (Miles's view), `corporate/daysheet.py` (the printable sheet and its CSV) |
| Proof | `corporate/tests/` (unit + real-HTTP), `corporate/tests/mutate.py` (deliberate breaks), `corporate/proof/walk.mjs` (the real-screen gate; runs `walk-client.mjs`, `walk-dj.mjs`, then the Stage 1 loop) |

## Stage 0 — what was found (read-only)

- The wedding form posts to a Google Apps Script with no confirmation of the
  save; the script's source is not on this Mac and needs Miles's Google login to
  change. Not reusable as the corporate home; left exactly as it is.
- Hosting is GitHub Pages (static) from `main`: it cannot run a server, and a
  push is a deploy. No push is authorized and none happened.
- The Savvy Suite desk owns the Booth's gig storage in its own worktrees; this
  work does not touch it. Stage 4 will hand the day sheet's songs to the
  existing prep tools (`~/gig-tools`) rather than rebuild matching.
- **The saved home, decided:** one JSON record per event under
  `corporate/data/`, written only by `corporate/store.py` (atomic writes, a
  revision per accepted save, an append-only change log, tokens per person and
  role with expiry and revoke), served by a stdlib Python server on
  `127.0.0.1:8790`. It passes every check the plan asked for locally.

## Stage 1 — what works now

- A booked client gets one private link per person (approver, planner,
  production, day-of contact). The link opens the six-section form drawn from
  `questions.json`; every answer can be typed, "Not sure yet", "Miles to
  suggest" (where offered) or "There are none"; awards and dancing questions
  appear only for the parts of the night selected and never lose what was typed.
- Drafts save to the event as they type (with a visible "Saved · revision N"),
  survive refresh, Back and a second device; if the server is unreachable the
  page says "Saved on this device only" and never pretends.
- Sending shows a receipt with the event name and revision only after a real
  save; a retry of the same attempt never doubles it; two people changing the
  same answer get a "Two answers" screen with both values and choose.
- A change by someone who does not own that decision lands as a proposal, shown
  to the owner (and to Miles) with both values and the person's name.
- Miles's view opens on "Needs you" and "Waiting on the client", shows the
  running order in the event's own time zone (a block that runs past midnight
  says so), the cue words and pronunciations verbatim, every change since he
  last looked, and links to the day sheet and its spreadsheet copy.
- The day sheet prints its build time, the event revision, the zone and its
  sources; it is a snapshot and says so. Spreadsheet cells can never run as
  formulas.
- Changing a time flags the cues under it and opens the questions the change
  needs; selecting Awards opens the five cue questions; a moved date keeps the
  event's identity and moves every part of the night with it; a song that is
  both requested and excluded is asked about once.

## How it was proven (all re-runnable: `./corporate/run-all.sh`)

- 128 checks, including real-HTTP ones against a private server and a private
  data folder; 33 deliberate breaks across store, rules, server and day sheet,
  every one caught by a named check; the runner refuses a red baseline and a
  needle that does not match exactly once.
- Real-screen walks in headless Chrome at 390×844 and 1440×900 with mock
  keychain flags (nothing pops up for Miles): the client page (175 readings),
  Miles's view (101 readings) and the Stage 1 gate itself — the planner moves
  the awards start 8:00 PM → 8:15 PM, Miles sees both times with Jules named and
  takes it, the approver's brief, Miles's view and the regenerated day sheet
  all read the new time on the same revision, and the simple networking event
  submits on a phone and shows its receipt.
- Two design passes on each screen (impeccable + apple-design) with the
  findings and fixes recorded in `corporate/VERIFY.md`.
- Three outside reviews (Codex) on read-only exports: seven findings on the
  first two, all fixed and re-proven; the third read the finished branch (its
  verdict is recorded below). Reports live in `~/Developer/handoff/jobs/`.
- First-hand in the desktop app's browser pane: the client page on a phone
  size and Miles's view on the desktop, no console errors.
- Every time a person READS is 12-hour ("8:15 PM"), on Miles's page, the
  client page, the day sheet and its CSV; stored values stay `HH:MM`. One
  `clock()` per language (client.js, dj.js, rules.py). Miles's word, 09-14:
  "I don't read things that way" — never show him 24-hour time.

## Deliberately not done (Stage 2 and later, or Miles's call)

- Nothing is hosted yet. The private link only works on this Mac. **Miles
  decided the home on 09-14 evening: no money.** Pages stay on the free home
  the wedding form already uses (GitHub Pages from `main`), under his own
  address `clients-prep.savvysoundscollective.com` (the domain's name records
  are at Google, his account; one record + the name in the Pages settings).
  Answers save into his Google Drive through a Google Apps Script rebuilt
  WITH a real confirmation (revision in the receipt), keeping the same doors
  and vocabulary as `CONTRACT.md`. Vercel was ruled out: its free plan is
  personal-use only. Building this is the next bounded task; Miles adds the
  record and presses the live button himself — nothing goes out before.
- No music: no song cards, listening links, releases, show copy, source
  reconciliation, matching or unattended checks (Stages 2–5).
- Time-to-complete has not been measured with a person (the plan asks for a
  real measurement, not a claim).
- Miles's view can resolve proposals, answer his own questions and start a
  booking; it does not yet edit a client's answers directly (Stage 2).
- The client page's session storage carries the token for the tab only; a
  hosted version should add expiry defaults on minted links (`expires_at` is
  supported by the door, the seed mints links without one).

## Next bounded task

Stage 2 (client review and show copy) on this same bench, one crew per piece:
released song suggestions with a checked listening route, decisions, the
"Ready for show" fixed copy, and the approval that reopens when a cue changes.
Before that, Miles decides the hosted home; that is the only question for him.

## The last outside review

`review-corporate-stage1` (Codex, read-only export of `d7f5996`) found four
things; all four were checked against the code by the lead desk:

- HIGH, real, fixed: a change to the people list wrote whole records into the
  history, and any client of the event could read that history — other
  people's emails and phones included. History is now scrubbed for the client
  audience exactly like the event record; pinned by a real-HTTP check and a
  mutation needle.
- HIGH, pre-existing, fixed the one line: the repo-root `VERIFY.md` spelled the
  home folder in its serve command (from before this work). Now `"$(pwd)"`.
  Its other sections describe the couple's page and are not this work's.
- MEDIUM, real, fixed: the day sheet printed `21:30–00:30` with no sign the
  block runs past midnight; it now says `(into the next day)`, pinned by a
  door check and by the gate walk.
- LOW, kept on purpose: "Saved · revision N" on the client's status line. The
  contract pins the receipt's wording and the same number is what the day
  sheet prints, so a client and Miles can say the same number to each other.

The reviewer's sandbox could not create a temp folder or bind a port, so its
own suite run was not green; the lead desk ran `run-all.sh` after the fixes.
