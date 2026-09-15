# Corporate onboarding — handoff after Stage 2 hosting (2026-09-14, late)

Written by the lead desk (Fable) for whoever picks this up: Miles, a later
Claude desk, or a Codex job. The plan is
`~/Documents/Savvy-Corporate-Onboarding-Build-Plan.md`; this note says what is
done, how it was proven, and what is deliberately not done. The earlier
handoff (Stages 0 and 1) is in git history at `314273e`.

## Where the work is

| What | Where |
|---|---|
| Bench (git worktree) | `~/Projects/savvy-sounds-onboarding-corporate`, branch `corporate-onboarding`; nothing pushed, nothing published |
| Everything corporate | `corporate/` — one folder, its own `VERIFY.md`, `CONTRACT.md` (the words; §11 is the hosted home), `run-all.sh` (the whole gate) |
| The wedding form | Untouched. `index.html`, `laura-ronnie/`, `aruba/`, `quality-check/` are byte-identical to `b8d41d5`. |
| The script | `corporate/script/*.gs` — the whole brain and the ONE writer, in Google Apps Script's JavaScript, same function names as the Python it replaced |
| The stand-in | `corporate/script/load.mjs` (Google's services over a disk folder) + `standin.mjs` (the pages on 8790, a Google look-alike on 8793) |
| The pages | `corporate/client/` (a client's private page), `corporate/dj/` (Miles's view), `corporate/home.js` (the ONE line naming the script's address — a placeholder until Miles publishes) |
| Runtime data | `corporate/data/drive/` (gitignored — the repo is PUBLIC). `node corporate/script/seed.mjs` rebuilds it. |
| Proof | `corporate/tests/*.test.mjs` (the brain, in-process and over HTTP), the two Python sweeps (`test_one_writer.py`, `test_ship_safe.py`), `tests/mutate.py` (35 deliberate breaks), `corporate/proof/walk.mjs` (the real-screen gate) |

## What was decided (by the lead, technical; Miles's constraint was "no money")

- **The brain lives in the Google script.** The client's page on the free home
  has no other server to trust, so ownership, conflicts, effects and the day
  sheet all run in the script; the script is the only thing that writes an
  event file in Miles's Drive. A "dumb store" would have pushed those rules
  into the browser or onto an unattended Mac; both are ruled out.
- **The script is its own stand-in.** The same `.gs` files run in node with
  Drive, the lock and the properties stood in over a folder, so every check
  and every walk exercises the real code. A Python stand-in would have been a
  second vocabulary.
- **Doors keep their names; only the envelope changed.** One `text/plain` POST
  to the script's address with `{door, token, body}`; the status rides inside
  the JSON (Google always answers 200 and reads no headers). The list door now
  answers `{ok, events}` so it can carry a status. The private link is
  `…/corporate/client/#<token>` (Pages cannot route `/c/<token>`); the token
  never leaves the fragment for any server or log.
- **The Python brain retired** the moment the script served (this commit).
  `mutate.py` and the two sweeps stayed: they are rulers, not a brain.

## How it was proven (all re-runnable: `./corporate/run-all.sh`)

- 12 sweeps (one writer: only `store.gs` names Drive, only `load.mjs` puts
  bytes on the disk; ship-safe: no real name, no personal path).
- 111 checks over the script: every check the Python had, plus the lock raced
  by four processes, plus the stand-in's redirect hop read over a real port.
- 35 deliberate breaks, every one caught by a named check, the runner refusing
  a needle that matches other than once and a red baseline.
- The real-screen gate in headless Chrome: the client page on a phone (41
  readings shared, 175 standalone across both fixtures and both widths),
  Miles's view (101), and the Stage 1 loop through the script's doors.
- First-hand in the desktop app's browser pane: the client page at phone width
  opened from a `#token` link through the cross-origin home, address bar
  stripped, "Saved · revision 3"; Miles's view at desktop width with the pass
  typed, both bookings listed, the network log showing the redirect-and-echo
  hop, no console errors.
- Crews: five Codex Sol jobs (rules 92k, store 106k, doors 107k, stand-in 73k,
  pages 68k, proof 109k tokens; 5–16 min each), verified by the lead: every
  "seen red" claim re-run by hand. Reports in `~/Developer/handoff/jobs/`.
  The lead fixed what the crews could not see without a port or Chrome: the
  list door's shape, the missing CORS header on the stand-in's 302, the pages'
  absolute asset paths, the seed parser, the opener's same-document hop, the
  gate's data reads, eight typographic dashes in the script.

## Deliberately not done

- **Nothing is published.** The script is not in Google, the address is not on
  the domain, `home.js` is a placeholder, nothing is pushed. `VERIFY.md`
  "Going live" is the exact set of Miles's clicks.
- **Google itself was never called.** The stand-in is faithful to Google's
  documented shape (302 to a one-shot answer, CORS header on both hops, no
  request headers, one address); the first real POST after Miles deploys is
  the proof of the door itself, and VERIFY names it.
- The Origin check of the local server has no counterpart on Google (no
  headers); the 128-bit token is the whole access story, as the contract says.
- One script lock serialises all events (Apps Script has no per-key lock);
  fine at a handful of bookings.
- Music, sources, unattended checks (Stages 2–5 of the plan): untouched.

## Next bounded task

Miles's clicks (VERIFY "Going live"), then the lead fills `home.js`, Miles
pushes, and the live proof runs. After that, Stage 2 of the plan (client
review and show copy) on this bench, one crew per piece.

## Receipt

Allowance on the ChatGPT plan is not exposed by the Codex CLI: unknown,
recorded as such. Six jobs, ~555k tokens by the ledger, ~50 minutes of Codex
time, zero retries, zero paid extras.
