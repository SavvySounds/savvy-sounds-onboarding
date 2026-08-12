# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

A client-facing **wedding music intake form** for Savvy Sounds Collective (a DJ /
AV company). Couples fill it out to tell the DJ what they want played at every
moment of their wedding day; the form produces a formatted text summary plus a
JSON payload that is POSTed to a Google Apps Script web app (and/or downloaded
and emailed back manually).

The entire application is **one self-contained HTML file**. There is no build
step, no package manager, no framework, no test suite, and no CI.

## Repository layout

```
.
├── README.md      # one line, just the repo name
└── index.html     # the whole app: markup + CSS + JS (~620 lines)
```

`index.html` is the only source file. Do not introduce a bundler, a
`package.json`, or a component framework unless the user explicitly asks —
"a single file anyone can open in a browser or drop on a static host" is the
point of this project.

## Anatomy of `index.html`

| Lines | Region | Notes |
|---|---|---|
| 1–9 | `<head>` | Two Google Fonts (`Fraunces` serif, `Inter` sans). The only external dependency. |
| 10–136 | `<style>` | All CSS. Design tokens in `:root` (11–18). |
| 139–145 | Top bar | Sticky brand bar + progress meter (`#progBar`, `#progPct`). |
| 147–152 | Hero | Headline and intro copy. |
| 154–376 | `<main id="form">` | 13 numbered `<section class="card">` blocks — the questionnaire itself. |
| 378–386 | Footer bar | Fixed bar with "Save a copy" (`#draftBtn`) and "Send to Savvy Sounds" (`#genBtn`). |
| 388–406 | Modal + toast | Export dialog (`#overlay`, `#exportBox`) and transient toast (`#toast`). |
| 408–618 | `<script>` | Single IIFE. All behavior. |

### The 13 sections

`01 The Basics` · `02 Prelude / Pre-Ceremony` · `03 The Ceremony` ·
`04 Grand Entrance` · `05 First Dance & Spotlight Dances` ·
`06 Reception Moments` · `07 Cocktail Hour` · `08 Dinner` ·
`09 The Dance Floor` · `10 Must-Play` · `11 Try-to-Play & Do-Not-Play` ·
`12 The Two of You` · `13 Tell Me Something Good`

Section numbers are hand-written in `.sec-num` spans — renumber them manually if
sections are inserted or reordered.

## Data model — everything is driven by `data-*` attributes

There is no central schema object. The JS discovers the form by querying
attributes, so **adding a field is usually just adding markup**.

| Attribute | Applied to | Meaning |
|---|---|---|
| `data-key="foo"` | `input` / `textarea` | Single-value field. Collected into `d.fields.foo`. Auto-tracked for progress. |
| `data-songs="group"` | container `div` | Repeatable list of song rows. Collected into `d.lists.group`. |
| `data-add="group"` | `button.add` | "+ Add" button wired to that song group. |
| `data-single="key"` | `.chips.single` | Radio-style chip group → `state.single.key`. |
| `data-multi="key"` | `.chips` | Multi-select chip group → `state.multi.key` (a `Set`). |
| `data-toggle="key"` | `input[type=checkbox]` | Switch → `state.toggles.key`. |
| `data-reveal="key"` | container `div` | Panel shown/hidden by the matching `data-toggle`. |
| `data-val="…"` | `.chip` | The value a chip contributes. |

Runtime state lives in one object (line 418):

```js
const state = { single:{}, multi:{}, toggles:{}, songs:{} };
```

Text inputs are **not** mirrored into `state` — they are read straight from the
DOM at collect time. `state.songs` is currently vestigial; song rows also live
only in the DOM.

### Key functions

- `makeRow(group, val)` (421) — builds one song row; picks the placeholder from a
  ternary chain keyed on `group`.
- `renumber(group)` (439) — re-indexes rows; also updates the `0 / 20` counter for
  `mustPlay`.
- `makeMoment(name, song)` (453) — a custom reception-moment row (`#customMoments`).
- `updateProgress()` (498) — recomputes the completion percentage and swaps the
  encouraging footer copy.
- `collect()` (514) — walks the DOM and returns the structured payload.
- `pretty(d)` (537) — renders that payload as the human-readable text block, with
  `JSON.stringify(d)` appended under a `--- structured data below (for the DJ) ---`
  marker so the DJ's tooling can parse it back out.

### Two hardcoded group arrays — keep them in sync

The list of song-group names is duplicated in two places:

- line 445 — seeds one empty row per group on load
- line 521 — collects each group into `d.lists`

```js
['prelude','cocktail','dinner','mustPlay','tryPlay','doNotPlay',
 'cringe','guiltyPleasure','parentsArtists','highschoolArtists','lifeSongs']
```

Adding a song group means touching **both** arrays, plus the markup, plus
`pretty()` if it should appear in the text export. Forgetting the second array is
the most likely bug in this codebase — the group renders and accepts input but
silently vanishes from the submission.

Similarly, the toggle-backed moments are listed at line 524:
`['fatherDaughter','motherSon','parentsDance','cake','bouquet','garter']`. Each
expects companion fields named `<key>Song` and (optionally) `<key>Name`.

## Submission flow

```js
const ENDPOINT = "https://script.google.com/macros/s/…/exec";   // line 413
const LIVE = /^https:\/\/script\.google\.com\/.+\/exec/.test(ENDPOINT);
```

- **Save a copy** (`#draftBtn`) never posts. It always opens the modal in
  download/copy mode.
- **Send to Savvy Sounds** (`#genBtn`) requires at least one partner name, then:
  - if `LIVE`, `fetch(ENDPOINT, { method:'POST', mode:'no-cors', … })` with
    `{ text: pretty(d), data: d }`;
  - if not `LIVE` (endpoint replaced with a placeholder), it falls back to the
    manual download/copy path.
  - on a thrown error it degrades to the same manual path with reassuring copy.

Because the POST uses `mode:'no-cors'`, **the response is opaque** — the code
cannot tell a successful write from a server-side failure. Only a network-level
error is caught. Do not add response-status checks unless the Apps Script is also
changed to send CORS headers.

The Apps Script itself is not in this repository. Changing `ENDPOINT` means the
DJ must redeploy a new web app URL; it is a public form-submission endpoint, not
a secret, but treat edits to that line as a deployment change and call them out.

## Adding to the form — checklists

**A new plain field**

1. Add a `<label class="fld">` + `<input data-key="newKey">` in the right section.
2. Add a `line('Label', f.newKey)` call in `pretty()` where it belongs.

That's it — progress tracking and collection are automatic.

**A new song group**

1. Add `<div class="songs" data-songs="newGroup"></div>` and a
   `<button class="add" data-add="newGroup">`.
2. Append `'newGroup'` to the array at line 445 **and** the one at line 521.
3. Add a placeholder branch in `makeRow` if the default (`'Song — artist (or a
   link)'`) isn't right.
4. Render it in `pretty()`.

**A new toggle-revealed moment**

1. Add the `.toggle-line` + `.sw` checkbox with `data-toggle="key"`.
2. Add the `<div class="reveal" data-reveal="key">` panel containing
   `data-key="keySong"` (and `data-key="keyName"` if a person is involved).
3. Append `'key'` to the moments array at line 524.

Note `.reveal.open` caps at `max-height:400px` (line 111) — a taller reveal panel
will be clipped.

## Conventions

- **Styling**: use the CSS custom properties in `:root` (`--bone`, `--ink`,
  `--gold`, `--line`, `--radius`, `--shadow`, …). Do not hardcode hex values in
  new rules. Palette is warm bone/ink/gold; `Fraunces` is used only via the
  `.serif` class and modal headings.
- **Responsive**: breakpoints are all `@media(max-width:560px)`; `.row2` grids
  collapse to one column there. Content column is `max-width:820px`.
- **Accessibility**: chips are `<span role="button">` toggled via
  `aria-pressed`. They are not keyboard-focusable today — if you touch chip
  markup, adding `tabindex="0"` and keydown handling is a genuine improvement,
  but flag it rather than silently reworking the interaction.
- **Voice**: the copy is warm, lowercase-feeling, and confident — "Let's build
  the sound of your day," "the hard no's," "DJ's Choice." Match that register in
  any new user-facing text. Use typographic apostrophes (`'`) in prose strings,
  as the existing JS strings do.
- **Vanilla JS only**: no libraries. `$` / `$$` (416–417) are the local
  `querySelector` helpers — not jQuery.
- Everything stays inside the single IIFE; no globals except the deliberate
  `window._export` and `window._tt` scratch values.

## Verifying changes

There are no tests. Verify by opening the file in a browser:

```bash
python3 -m http.server 8000     # then visit http://localhost:8000
```

Manual smoke checklist after any JS change:

1. Progress bar moves as fields are filled.
2. "+ Add" appends a row and renumbers; the `×` button removes and renumbers.
3. Must-Play refuses a 21st entry and toasts "20 is the max".
4. Chips: single groups deselect siblings; the dance-genre group multi-selects.
5. Toggles open their reveal panel and the moment appears in the export.
6. "Save a copy" opens the modal with a fully populated text export ending in the
   JSON blob.
7. Download produces `SavvySounds-<names>-music.txt`.

Note that "Send to Savvy Sounds" will post to the **live production endpoint** if
run against the committed `ENDPOINT` — use a placeholder value while testing the
submit path so the DJ's sheet doesn't fill with junk rows.

## Deployment

Static file, no build. It is served as-is (e.g. GitHub Pages from the default
branch, or any static host) — whatever is committed to `index.html` is what
couples see. Keep it working with the file opened directly via `file://` too;
that is how it gets previewed.

## Git workflow

- Default branch: `main`.
- Work on the feature branch you were assigned, commit with a descriptive
  message, and `git push -u origin <branch>`.
- Do not open a pull request unless explicitly asked.

## Known rough edges

Worth knowing before you "fix" something that looks broken:

- `document.execCommand('copy')` (605) is deprecated; the modern
  `navigator.clipboard.writeText` needs a secure context, which `file://` is not
   — hence the old API. Change it only with a fallback.
- Nothing persists: a page refresh loses all input. There is no `localStorage`.
- Progress math (498–509) is a deliberately fuzzy heuristic — bonus "signals"
  for vibes, genres, and song lists are added to the denominator. It is
  motivational UI, not a validation state.
- `state.songs` is declared but never used.
- The only required-ish validation is "at least one partner name" on submit; the
  `•` markers are advisory.
