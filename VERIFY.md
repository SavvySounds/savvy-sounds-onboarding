# How to prove this repo still works

One section per feature: what it is, how to reach it, and the steps that
prove it works. Re-run the section for anything you change.

Serve the repo root and open pages from the server, never by double-clicking
the file. Two of the pages need a real web address to work at all:

    python3 -m http.server 8765 --bind 127.0.0.1 \
      --directory /Users/milesdipaola/Projects/savvy-sounds-onboarding

Then browse to `http://localhost:8765/`. Stop it with Ctrl-C when you are
done.

---

## Recipes not yet written

`index.html` (the wedding music form), `aruba/` and `quality-check/` came
before this file and do not have their steps written down yet. Anyone
touching one of them writes its section here as part of the work.

---

## The passcode page for one couple — `laura-ronnie/`

**What it is.** A private page for one couple, behind a passcode. It shows
them their running order, the song for each moment, two edits they can play
on the page, links to their playlists, their do-not-play list, and a short
form at the bottom that opens their mail app with their answers already
written out. Phone first — they open it on an iPhone.

**Where the couple's own words live.** Not in this repo. The repo is public,
so `content.html` and the two mp3s in `src-audio/` are deliberately left out
of it (see `laura-ronnie/.gitignore`). What ships is `locked/*.enc`, which is
scrambled and useless without the passcode. **Keep the plaintext on the Mac —
it is what the build reads, and it cannot be recovered from the repo.**

**The lock.** The same one the Conduit's members' door uses, byte for byte:
OpenSSL's own salted format, `-aes-256-cbc -pbkdf2 -iter 100000 -md sha256`.
The page body ships as base64 text; the two songs ship as raw binary, because
they are 3.8 MB and 4.3 MB and base64 would add a third on top for nothing.

**A locked page only opens over a real web address** — `localhost` or
`https`. The browser refuses to unscramble anything on a `file://` page, so
opening `index.html` by double-clicking it will always look broken. Use the
server above. On the live site it is served over https, so it is fine.

### Building it

    cd /Users/milesdipaola/Projects/savvy-sounds-onboarding
    PAGE_PASSCODE='<the passcode>' python3 laura-ronnie/build.py

Expect four lines: three `locked ...` lines and `wrote index.html`, then
"All three came back byte for byte with the passcode, and none of them
opened without it."

The build checks its own work before it writes anything: it unscrambles each
file again with the real `openssl` and compares it byte for byte with what
went in, then confirms a wrong passcode does *not* give the file back.

**Prove the build refuses a weak passcode** — this must print "Not built."
and write nothing:

    PAGE_PASSCODE=short python3 laura-ronnie/build.py

### Walking the page

Serve the repo root, then open `http://localhost:8765/laura-ronnie/`.

1. **A wrong passcode is refused.** Type anything wrong, press Open (or the
   Return key). Expect "That's not it — check the passcode Miles sent you.",
   the typing box still highlighted and ready, and no page behind it.
2. **A capital first letter still opens it.** Phone keyboards put a capital on
   the first letter by reflex, so type the passcode with its first letter
   capitalised: it must open normally, songs and all. Then change one letter
   in the middle to make it genuinely wrong and try that both ways, plain and
   capitalised — both must still be refused with the same message, and
   neither may be remembered.
3. **The right passcode opens it.** Expect the couple's names as a big
   heading, ten moments in the running order, and nine song cards.
4. **Both songs play.** Each one says "Loading the song…" and is then
   replaced by a player. The two lengths must read **3:56** and **4:28** on
   the player itself. If a player never appears, the song did not unscramble.
5. **Pressing Open twice fast does not double the page.** Press Open twice as
   fast as you can. There must still be exactly ONE big heading, one form and
   one "Send to Miles" button.
6. **A reload does not ask again.** Refresh the tab: the page comes straight
   back with no passcode box. Open it in a brand new tab and it asks again —
   that is correct, the passcode is only remembered for the one tab.
7. **The form writes the email.** Fill in a few answers, leave others blank,
   press "Send to Miles". The mail app opens with the subject
   "Laura & Ronnie — answers" and a message containing only the questions
   that were answered — blanks must not appear.
8. **Copy works.** Press "Copy the answers". The button must change its word
   to "Copied" **and** turn green, then go back on its own after about three
   seconds. Paste somewhere to confirm you got the same text as the email.
9. **The choices are big enough for a thumb.** Every Yes/No/After-cake row
   must be at least 44px tall and the whole row must be tappable — tap the
   words at the far right of a row, nowhere near the little circle, and it
   must still select that choice.
10. **Keyboard only.** With the Tab key alone you must reach: the passcode box
    and Open on the front door; then both players, both playlist links, all
    ten form questions, both buttons and the email link at the bottom. Every
    one of them shows a clear green ring while it is selected.
11. **Nothing red in the browser's console** at any point.
12. **On a phone.** At 375px wide the page must be one column with no
    sideways scrolling.

### The one that catches a real break

Change a single character in the middle of `laura-ronnie/locked/page.enc`,
then reload the page. The door must refuse it in plain words rather than
showing a broken page or a blank screen, and it must forget the remembered
passcode so a second reload asks again instead of looping.

Then put it back and rebuild:

    cd /Users/milesdipaola/Projects/savvy-sounds-onboarding
    PAGE_PASSCODE='<the passcode>' python3 laura-ronnie/build.py

and walk steps 2 and 3 again to confirm it is healthy.

### Colour, checked with a ruler

Measured on the real page, against the paper it sits on:

| What | Measured |
|---|---|
| Dark text on paper | 14.3 : 1 to 16.0 : 1 |
| Grey-brown text on paper, cards and note panels | 7.3 : 1 to 8.8 : 1 |
| Gold labels and links | 4.7 : 1 and 5.2 : 1 |
| Cream on the gold button | 5.1 : 1 |
| Cream on the green "Copied" button | 5.0 : 1 |

Every piece of ink is at or above 7:1 and every action colour at or above
4.5:1. If a colour is changed, measure again — the gold only clears the bar
at `#8E6210`; the lighter `#A06D12` used elsewhere in this repo does **not**
pass as text on paper (3.9:1) and is only safe behind cream.

---

## The same page inside the DJ's own site — `laura-ronnie/squarespace.html`

**What it is.** The very same page, written out a second time as a *body
fragment* to paste into ONE Code Block on a Squarespace page. It comes out of
the same build, from the same style, markup and script as `index.html`, so the
two cannot drift apart. The only differences: no `<html>`/`<head>`/`<body>`
around it, and it fetches the locked files from GitHub Pages by their full web
address instead of from the folder beside it.

**Why that works.** GitHub Pages sends `Access-Control-Allow-Origin: *`, so a
page on the DJ's own domain is allowed to read the locked files. Check that
header any time with:

    curl -sI https://savvysounds.github.io/savvy-sounds-onboarding/ | grep -i access-control

**The one thing to remember.** The fragment reads the locked files from GitHub
Pages, so **a change to the page's words only shows up on the site once it has
been built AND pushed.** Building alone changes nothing the couple can see.

### Pasting it in

1. Edit the page, add a **Code Block**.
2. Paste the **whole** of `laura-ronnie/squarespace.html` — fonts, style,
   markup and script. It is one block, not four.
3. **"Display Source" must be OFF.** With it on, Squarespace prints the code
   on the page as text instead of running it.
4. Save.

You do not need to size the block. It sits in whatever grid cell it lands in —
even a narrow one over on the left — and spreads itself across the window,
taking its height from the words.

### Proving it without touching the live site — the stub

There is a throwaway page that pretends to be a Squarespace page: a site
header and footer with their own loud rules (blue Georgia body, red 60px
headings, hotpink buttons, yellow inputs) wrapped round the real fragment,
byte for byte. It is not committed. Build it, then serve the repo root:

    PAGE_PASSCODE='<the passcode>' python3 laura-ronnie/build.py
    python3 <the make_stub script> ; # writes laura-ronnie/squarespace-stub.html

Open `http://localhost:8765/laura-ronnie/squarespace-stub.html` and check:

1. **Neither side bleeds into the other.** The door looks exactly like the
   standalone page's — paper ground, our own fonts, gold button, cream
   passcode box. The site's header, its red heading, its blue paragraph and
   its footer are all untouched.
2. **It opens.** Type the passcode: the page appears, both songs load and each
   player shows a real length.
3. **The files really do come from GitHub Pages.** In the browser console:

       performance.getEntriesByType('resource').filter(e => e.name.endsWith('.enc')).map(e => e.name)

   All three must be `https://savvysounds.github.io/...` addresses while the
   page itself is on `localhost` — that is the cross-origin fetch working.
4. **Nothing red in the console.**
5. **It fills the window from a narrow cell.** Add `?narrow=1` to the stub's
   address: the fragment is then inside a 300px-wide box pinned to the left,
   which is the awkward case. At both phone and desktop width the paper must
   still run edge to edge with the reading column centred, and the page must
   not scroll sideways.

### The one that catches a real break, for the fragment

With `?narrow=1` open, run this in the console to strip what the script
measured and leave only the stylesheet:

    var p = document.getElementById('lr-page');
    p.style.left = p.style.marginLeft = p.style.width = '';
    p.getBoundingClientRect().left        // expect a big negative number

It should jump hundreds of pixels off to the left — that is the plain CSS
trick failing, because it assumes the block sits in a centred column. Then:

    window.dispatchEvent(new Event('resize'));
    p.getBoundingClientRect().left        // expect 0 again

back to 0. If it does not come back, the part that measures the real offset
has stopped working and the page will hang off the side of any cell that is
not centred.
