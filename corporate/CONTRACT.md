# Corporate onboarding — the contract every crew builds to

Written 2026-09-14 by the lead desk after reading the build plan
(`~/Documents/Savvy-Corporate-Onboarding-Build-Plan.md`), the house rules, the
wedding form, gig-tools, and the Savvy Suite handoffs. This file pins the WORDS:
folder names, door names, field names, states. Two crews building to one loose
contract once invented two vocabularies; that is why this file exists. If a
crew finds a word here unsatisfiable, it refuses and says why — it never
invents a second word.

## 0. Stage 0 findings (read-only inspection, verified)

| Subject | Finding |
|---|---|
| Wedding form receiving setup | `index.html` POSTs `{text,data}` with `mode:'no-cors'` to a Google Apps Script web app. The response is opaque: the page shows "Received" without any proof the row was saved. The script's source is NOT on this Mac; the response workbook (Drive id `1pKQcQVGGHlUO22JhaSGn3YCHLAdVTQN5tUDeK1Iytbw`) is owned by Miles's personal Google account. Editing the script needs his Google login. **Not reusable as the corporate saved home for Stage 1**, and it must not be touched (preserve the wedding experience). |
| Hosting | GitHub Pages from `main` of `SavvySounds/savvy-sounds-onboarding` (public repo; Vercel mirror). Static only — cannot run a server. Push = deploy; no push is authorized. |
| Ownership | Main tree clean at `b8d41d5`. No other desk has a process rooted here. The Savvy Suite desk works in `~/Projects/the-booth-*` worktrees on the Booth's own gig storage (`data/gigs/`, owner `talk/box.py`) — separate product, separate repo. We do not touch it or copy it. |
| Prep entry points (gig-tools, `~/gig-tools`) | `crate_list.py` (client CSV → track list), `crate_match.py` (list → crate + GAPS), `tidal_pick.py`. Client must-plays historically live in `SWAP SHEET.csv` not `SOURCE POOL.csv`. **Stage 4 material; nothing in Stage 1 calls them.** |
| Port 8765 | Held by someone else's node process. Ours is **8790**. |
| The saved home (decided) | A private on-Mac store: one JSON file per event under `corporate/data/events/`, an append-only change log per event, and one access file — written ONLY by `corporate/store.py`, atomically (temp file + fsync + rename). Served by a stdlib Python server (`corporate/server.py`). This passes every check the plan demands (save confirmation, private access, simultaneous edits, repeat-send protection, version history, interrupted-write recovery) and adds no dependency. **The hosted home is the one prerequisite left to Miles**: this server has to run somewhere clients can reach (a private host, or Apps Script rebuilt with confirmation) — Stage 1 is a faithful local preview. |

## 1. Folders (one feature, one folder)

```
corporate/
  CONTRACT.md        this file
  questions.json     THE vocabulary of the form: sections, questions, states, options, conditions
  store.py           the ONLY writer of corporate/data/  (events, changes, access)
  rules.py           pure functions: validate, required-to-submit, open items, change effects, conflicts
  daysheet.py        event -> printable day-sheet HTML (reads through store, never writes)
  server.py          stdlib HTTP server on 127.0.0.1:8790: static files + JSON doors
  seed.py            wipes corporate/data/, loads fixtures/, prints the private links
  client/index.html  the client's private page (start/resume, form, review, receipt, brief, questions)
  dj/index.html      Miles's private view (events, what changed / what needs me, brief, running order, questions, changes & approvals, day sheet link)
  fixtures/          harbor-studio.json, northstar-awards.json  (FICTIONAL, ship-safe)
  tests/             python -m unittest discover corporate/tests ; mutate.py runner
  proof/             walk.mjs (headless Chrome via CDP, node 24, zero deps), frames/ (gitignored)
  data/              runtime store (gitignored — the repo is PUBLIC)
  run-all.sh         tests + mutation runner + proof walk, in that order
```

The wedding form (`index.html`), `laura-ronnie/`, `aruba/`, `quality-check/`
are NOT touched. `VERIFY.md` at the repo root gets a "Corporate onboarding"
section that points at `corporate/VERIFY.md` (the feature's own recipe).

## 2. Words

### Answer states (exactly these five strings)

| state | meaning |
|---|---|
| `blank` | never answered |
| `none` | deliberately none ("No do-not-plays") |
| `unknown` | "Not sure yet" — generates an open item |
| `miles` | "Miles to suggest" — generates an open item owned by `dj` |
| `confirmed` | a real answer, supplied by someone |

### Roles (people[].role)

`approver` · `contact` · `planner` · `production` · `dj`

### Decision owners (who may CONFIRM which answers)

| answer group (`questions.json` → question.owner) | owner role | fallback if that role has nobody |
|---|---|---|
| `direction` (company preferences, sound, do-not-plays, requests, guest policy) | `approver` | — |
| `running_order` (moment times, order, durations) | `planner` | `approver` |
| `production` (access, sound, equipment, live act) | `production` | `approver` |
| `prep` (versions, cues, preparation, release of suggestions) | `dj` | — |
| `event` (name, company, date, venue, tz, contacts, people) | `approver` | — |

Anyone with event access may PROPOSE. A save from a non-owner lands as a
`proposal` on the answer, never as its value. `dj` may resolve any proposal
and it is recorded as resolved by Miles.

### Moment kinds

`arrival` · `networking` · `dinner` · `presentations` · `awards` · `dancing` · `closing` · `custom`

### Moment approval

`draft` · `proposed` · `confirmed`

### Event stage (Stage 1 uses the first three)

`draft` · `waiting` · `preparing` · `review` · `ready` · `completed`

### Change log `origin` values

`form-draft` · `form-submit` · `client-edit` · `dj-edit` · `proposal` · `resolve` · `seed`

## 3. The event record (`data/events/<event_id>.json`)

```jsonc
{
  "event_id": "ev_3f9a2c7b1d",        // permanent; never derived from name/date
  "revision": 7,                       // +1 on every accepted save
  "created_at": "2026-09-14T22:10:00Z",
  "updated_at": "2026-09-14T22:41:12Z",
  "stage": "waiting",
  "submitted_at": "2026-09-14T22:30:00Z" | null,
  "tz": "America/Chicago",             // the EVENT's zone, IANA
  "answers": {
    "<question_id>": {
      "value": <string | string[] | null>,
      "state": "blank|none|unknown|miles|confirmed",
      "supplied_by": "<person_id>" | null,
      "supplied_at": "<iso>" | null,
      "source": "form|dj|planner|seed",
      "approved_by": "<person_id>" | null,
      "approved_at": "<iso>" | null,
      "previous": { "value": ..., "state": ..., "supplied_by": ..., "supplied_at": ... } | null,
      "proposal": { "value": ..., "state": ..., "by": "<person_id>", "at": "<iso>", "note": "" } | null
    }
  },
  "people": [
    { "person_id": "p_dana", "name": "Dana Whitfield", "role": "approver",
      "email": "dana@example.com", "phone": "", "decides": ["direction","event"] }
  ],
  "moments": [
    { "moment_id": "m_awards", "kind": "awards", "label": "Awards",
      "date": "2026-11-06", "start": "19:30", "end": "20:15", "duration_min": 45,
      "purpose": "", "room": "Main hall",
      "music_owner": "dj", "cue_owner": "planner",
      "cue_text": "", "pronunciation": "",
      "approval": "confirmed", "active": true,
      "previous": { "date": ..., "start": ..., "end": ..., "cue_text": ... } | null,
      "proposal": { "date":..., "start":..., "end":..., "by":..., "at":... } | null }
  ],
  "songs": [],                          // Stage 2
  "open_items": [
    { "item_id": "oi_awards_names", "question": "Who are the award recipients, and how are their names pronounced?",
      "why": "Read on mic during the awards; a wrong name is unrecoverable.",
      "moments": ["m_awards"], "owner": "approver", "due": null,
      "resolved": false, "resolved_by": null, "resolved_at": null,
      "origin": "rule:awards", "active": true }
  ],
  "sources": [],                        // Stage 3
  "dj_notes": "",                       // PRIVATE. Never in any client response or client export.
  "next_action": "Waiting on Dana: 4 open questions."
}
```

Time: `date` is `YYYY-MM-DD`, `start`/`end` are `HH:MM` wall-clock in the
event's `tz`. A moment that crosses midnight has an `end` earlier than
`start` and is understood as ending the next day. The day sheet prints in the
event's zone and, when it differs from the Mac's, says so in one line.
Times are stored as `HH:MM` and shown as `h:MM AM/PM` by `clock()` in
`client.js`, `dj.js`, and `rules.py`.

## 4. The change log (`data/changes/<event_id>.jsonl`, one JSON object per line)

```jsonc
{ "change_id": "ch_…", "event_id": "ev_…", "revision": 8, "at": "<iso>",
  "actor": "<person_id>", "role": "planner", "origin": "client-edit",
  "field": "moments.m_awards.start",     // or "answers.<qid>" / "people" / "open_items.<id>"
  "before": "19:30", "after": "19:45",
  "affected": ["m_awards", "oi_awards_cue"],   // what prep this touched
  "decision_required": true, "resolved_by": null, "resolved_at": null,
  "submission_id": "sub_…" }
```

## 5. Access (`data/access.json`)

```jsonc
{ "tokens": { "<token>": { "event_id": "ev_…", "person_id": "p_dana", "role": "approver",
              "created_at": "<iso>", "expires_at": "<iso>" | null, "revoked_at": null } },
  "dj_token": "<token>" }
```

Tokens are 32 hex chars from `secrets.token_hex(16)`. A revoked or expired
token answers **403** with `{ "ok": false, "error": "link-expired" }` on every
door — read, save, day sheet, export. The page address `/c/<token>` with a dead
or malformed token answers **403** with one plain static sentence
(`client/expired.html`, no script, no data) — never the page itself. A token scopes to exactly one event;
asking for any other event with it is **403** `not-your-event`. The `dj_token`
reaches every event. Tokens travel in the `X-Access-Token` header (never in the
URL of an API call); the private page link is `/c/<token>` and the page moves
the token into memory + `sessionStorage`, then the address bar shows `/c` or
`/c/`; both spellings serve the shell. **This is the local preview's access story. A hosted version keeps the
same doors and swaps nothing else.**

## 6. Doors (all JSON; every non-200 carries `{ok:false, error:"<word>"}`)

| Door | Who | Answers |
|---|---|---|
| `GET /api/questions` | any token | `questions.json` verbatim |
| `GET /api/me` | any token | `{ok, event_id, person:{person_id,name,role}, role, expires_at}` |
| `GET /api/events` | dj | `[{event_id, name, company, date, tz, stage, revision, updated_at, changed_since_seen: n, needs_me: n, waiting_on_client: n, next_action}]` |
| `GET /api/events/<id>` | token for that event | the event record, **filtered by audience** (client audience: no `dj_notes`, no other people's emails/phones except roles+names, no `proposal.note` written by dj) |
| `POST /api/events/<id>/save` | token for that event | see §7 |
| `POST /api/events/<id>/resolve` | owner role of the field, or dj | `{field, take:"proposal"|"current", submission_id}` → 200 `{ok, revision}` |
| `POST /api/events/<id>/open-items/<item_id>` | any token for that event | `{resolved: true|false, answer: "<text>", submission_id}` → 200 `{ok, revision}` |
| `GET /api/events/<id>/changes?since=<revision>` | token for that event | change log lines after that revision, audience-filtered |
| `GET /api/events/<id>/daysheet` | dj | printable HTML; header prints build time, revision, tz, and the source list |
| `GET /api/events/<id>/daysheet.csv` | dj | key times + contacts + open items as CSV; every cell starting with `= + - @` or a tab/CR is prefixed with `'` |
| `GET /api/events/<id>/brief` | any token for that event | client-facing brief JSON: header, moments, confirmed answers, open items owned by the caller's role, next action |
| `POST /api/dj/events` | dj | create an event from `{name, company, date, tz, people:[{name, role, email, phone}]}` → `{event_id, links:{approver: "/c/<token>", ...}}` (Stage 1: how Miles starts a booking). The people are who the links are for: roles from `approver` · `planner` · `production` · `contact` — never `dj` — one person per role, because the links come back keyed by role and two people on one role would lose a link without a word. An approver is required: a booking nobody can say yes on has no owner for any decision. Each `person_id` is built from a reduced leaf of the name, never from the typed text. Names, roles and emails are checked by the same rule the save door uses; anything wrong is **422** `{ok:false, error:"invalid", errors:[{field, message}]}` and no event is made. |
| `POST /api/dj/access` | dj | `{event_id, person_id, role, expires_at}` → `{token, link}`; `{revoke: "<token>"}` → `{ok}` |
| `POST /api/dj/seen` | dj | `{event_id, revision}` → `{ok, dj_seen_revision}`; the store holds the number down to the event's own revision and up to the one already remembered, so the bookmark never runs ahead of the record and never moves back. Nothing is logged and the revision does not move: this is what Miles has read, not a change to the event. It is what `changed_since_seen` counts against. |

Every door checks, at ONE seam in `server.py` before routing: `Host` is
`127.0.0.1:8790` or `localhost:8790` (else 421), and for any POST the `Origin`
header, when present, is our own origin (else 403 `bad-origin`). Static files
are served from `corporate/client/` and `corporate/dj/` only; `/c/<token>`
serves `client/index.html`; `/dj/` serves `dj/index.html`; `../` never escapes.

## 7. The save door (`POST /api/events/<id>/save`)

Request:
```jsonc
{ "base_revision": 7,                  // the revision the editor SAW
  "submission_id": "sub_<random>",     // minted by the page ONCE per attempt, reused on retry
  "submit": false,                     // true = the client pressed Send: run required-to-submit
  "answers": { "<qid>": { "value": ..., "state": "..." } },   // only the ones touched
  "moments": [ { ...full moment objects the editor touched... } ],
  "people":  [ ... ] }
```

Server, in this order, under one lock per event:
1. Token → event/role (403s above).
2. **Repeat send:** if `submission_id` was already accepted for this event, answer the SAME receipt again with `"duplicate": true` and change nothing.
3. **Stale base:** if `base_revision != event.revision`, compute per field: if only the other editor changed it since `base_revision` → merge theirs; if BOTH changed it and values differ → conflict. Any conflict → **409**
   `{ok:false, error:"conflict", current_revision, conflicts:[{field, label, yours, theirs, theirs_by:"<name>", theirs_at}], merged: {…the fields that merged cleanly…}}`. Nothing is written.
4. **Ownership:** for each touched field, if the caller's role is not the field's owner (§2), store it as `proposal` (with `previous` untouched) and list it in the response `proposed`. If it changes a value another person confirmed, ALSO log `decision_required: true`.
5. **Validation** (`rules.validate`): types/options from `questions.json`; and when `submit` is true, required-to-submit: event name or company; contact name AND email; date OR `event_date` state `unknown`; event type (or "other" text); approver named OR `approver` state `unknown`. Errors → **422** `{ok:false, error:"invalid", errors:[{field, message}]}`, nothing written.
6. Apply, keep `previous` on each changed answer/moment, `revision += 1`, run `rules.effects(before, after)` → open items added/deactivated + `affected`, recompute `next_action`, append change lines, write atomically, then answer:
   **200** `{ok:true, revision, receipt:{event_id, revision, saved_at, submission_id, name}, proposed:[fields], effects:{open_items_added:[…], open_items_closed:[…], cues_to_recheck:[moment_ids], coverage:{target_min, overlaps:[…], gaps:[…]}}}`.

The page treats anything but a 200 with `ok:true` as NOT saved: it keeps the
draft in memory + `sessionStorage`, shows the failure in words ("Not saved yet —
your answers are still here"), offers Retry (same `submission_id`) and Copy.
A receipt shows the event name and revision.

## 8. Change effects Stage 1 must implement (`rules.effects`)

| Change | Effect |
|---|---|
| a moment of kind `awards` becomes active | open items (owner `approver` unless a planner exists for cue items): recipients' names + pronunciation; walk-on music; exact cue wording with start/stop; who introduces whom; who calls each cue. **Never invent names or timings.** |
| a moment's `start`/`end`/`date` changes | every moment with non-empty `cue_text` inside the changed window → `cues_to_recheck`; open item "Re-confirm the cue for <moment> at the new time" (owner: cue_owner); open item "Re-check soundcheck and arrival against the new times" (owner `production` → fallback) |
| `duration_min` / `end` changes | coverage: `target_min` = sum of active moments whose `music_owner` is `dj`; `overlaps`/`gaps` between consecutive active moments (crossing midnight handled) |
| `event_date`, `venue`, `tz` changes | identity kept (same `event_id`); open item "Re-check load-in, arrival and the room plan for the new venue/date"; every moment's `date` shifts by the same number of days when only the date moved |
| a moment goes `active: false` | its open items go `active: false` (never deleted); no new items for it |
| an answer lands `unknown` or `miles` | one open item per such answer (owner = the answer's owner role; `miles` → `dj`), closed automatically when the answer becomes `confirmed`/`none` |
| a do-not-play matches a request/must-play (case-insensitive artist or title) | open item "X is both requested and excluded — which wins?" owner `approver` |

Idempotent: running `effects` twice on the same before/after adds nothing the
second time (open items are keyed by `item_id` derived from rule + target).

## 9. The fixtures (fictional, ship-safe; these exact names are the allowlist)

**Harbor Studio Networking** — company Harbor Studio; contact + approver
Dana Whitfield (dana@example.com); day-of contact Priya Raman; venue
"Pier 9 Loft, San Francisco"; tz `America/Los_Angeles`; ~80 guests; purpose
networking, music supports conversation; sound polished/warm; dancing not
planned; moments arrival 18:00, networking 18:30–21:00, closing 21:00; no
awards. Simple.

**Northstar Staff Awards** — company Northstar Logistics; approver Theo Marsh
(theo@example.com); planner / show caller Jules Okafor; production contact
Sam Reyes (venue side); day-of contact Mina Park; venue "The Lakeside Hall,
Chicago"; tz `America/Chicago` (NOT the Mac's zone); ~220 guests; purpose
awards + staff celebration; dancing expected; moments arrival 18:00, dinner
19:00–20:00, awards 20:00–21:00 (cue_text present, one pronunciation note
"Siobhan — shi-VAWN"), dancing 21:30–00:30 (crosses midnight), closing 00:30.
Must-plays include one song that is also on the do-not-play list (the
conflict rule must fire). One planner proposal already present: awards start
20:15 vs confirmed 20:00 (the conflict Miles must resolve in the walk).

No real client, venue, couple, guest, planner, or company name anywhere in
`corporate/`. `tests/test_ship_safe.py` pins: (a) every proper name in
`fixtures/` and in `client/`+`dj/` hint text is on the allowlist above;
(b) no file under `corporate/` contains the home-folder path spelling or the
session scratch-root spelling (assembled from fragments, never spelled);
(c) a handful of real surnames known to this Mac's other projects are pinned
by 8-char sha256 prefixes and must not appear (the test derives the prefix
list from a `NEEDLE_HASHES` tuple; a spelled needle never enters the repo).

## 10. Proof the crews owe (see `corporate/VERIFY.md` for the exact steps)

- `python3 -m unittest discover -s corporate/tests -t .` green; `corporate/tests/mutate.py`
  runs each needle exactly once against a copy under a private temp folder,
  refuses a missing/ambiguous needle, and reports a table.
- One-writer check: `tests/test_one_writer.py` walks every `.py` under
  `corporate/` and fails if any module other than `store.py` opens a path
  under `corporate/data` for writing or spells the `data/` folder name.
- Private fields: `tests/test_private.py` proves `dj_notes` and other people's
  contact details never appear in a client-audience response or export, on
  real HTTP against the running server.
- Real HTTP tests cover: save receipt; duplicate `submission_id`; 409 with both
  values; proposal from a non-owner; 403 on revoked/expired/other-event token;
  422 on submit without required; CSV formula prefix; Host/Origin seam.
- `proof/walk.mjs` (node 24 built-in WebSocket + headless Chrome with
  `--use-mock-keychain --password-store=basic --headless=new`): walks both
  fixtures on 390×844 and 1440×900, keyboard-only reach, no horizontal
  scroll, contrast readings on the real ground, reduced-motion still state,
  the full loop of the Stage 1 gate (change an awards time → cues flagged →
  resolve the planner conflict → client view, Miles's view and regenerated day
  sheet agree on revision and values). It asserts the world before it records
  (innerWidth, visibilityState) and throws its first load away.
