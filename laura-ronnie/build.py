#!/usr/bin/env python3
"""Lock one couple's page behind a passcode.

    PAGE_PASSCODE='the passcode' python3 laura-ronnie/build.py

Reads content.html and the two mp3s in src-audio/, locks each one with
OpenSSL, and writes locked/*.enc plus index.html — the door. The plaintext
never goes into the repo (see .gitignore); the repo is public and the .enc
files are useless without the passcode.

The lock is exactly the scheme the Conduit's members' door already uses
(conduit/build.py `encrypt` + conduit/site/door/unlock.mjs), byte for byte:

    openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -salt

        "Salted__"   8 bytes, ASCII
        salt         8 bytes
        ciphertext   the rest, AES-256-CBC, PKCS#7 padded

    key/IV = PBKDF2-HMAC-SHA256(passcode, salt, 100000) -> 48 bytes,
    first 32 the key, next 16 the IV.

`-pass env:` and not a command-line argument on purpose: an argument is
visible in `ps` to anybody else on this Mac.

The page HTML goes out as base64 (it is small, and text survives any
web server). The two songs go out as RAW BINARY — they are 3.8 MB and
4.3 MB, and base64 would put a third on top of that for nothing; the
browser fetches them as an ArrayBuffer.

Nothing is written until every file has been decrypted again with the real
openssl and compared byte for byte with what went in, and a wrong passcode
has been shown to fail.
"""

import base64
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCKED = HERE / "locked"

# content source -> locked file, and whether it ships as base64 text.
JOBS = [
    (HERE / "content.html", LOCKED / "page.enc", True),
    (HERE / "src-audio" / "laura-entrance-preview.mp3", LOCKED / "laura-entrance.enc", False),
    (HERE / "src-audio" / "cake-instrumental-preview.mp3", LOCKED / "cake.enc", False),
]


class Refused(Exception):
    """Something is wrong; nothing was written."""


def _openssl(args, data, passcode):
    env = dict(os.environ)
    env["PAGE_LOCK_PASS"] = passcode
    try:
        return subprocess.run(
            ["openssl", "enc", *args, "-aes-256-cbc", "-pbkdf2", "-iter", "100000",
             "-md", "sha256", "-salt", "-pass", "env:PAGE_LOCK_PASS"],
            input=data, capture_output=True, env=env,
        )
    except FileNotFoundError:
        raise Refused("openssl is not on this Mac, so nothing can be locked.")


def lock(data, passcode):
    """bytes -> OpenSSL's own salted format."""
    r = _openssl([], data, passcode)
    if r.returncode != 0:
        raise Refused("openssl refused to lock a file: %s"
                      % r.stderr.decode("utf-8", "replace").strip())
    if not r.stdout.startswith(b"Salted__"):
        raise Refused("openssl wrote something the door cannot unlock. "
                      "The door expects its salted format.")
    return r.stdout


def unlock(blob, passcode):
    """OpenSSL's salted format -> (worked?, bytes). Used only to check our work."""
    r = _openssl(["-d"], blob, passcode)
    return r.returncode == 0, r.stdout


def build(passcode):
    if len(passcode) < 8:
        raise Refused(
            "Set the passcode first, and make it at least 8 characters:\n\n"
            "    PAGE_PASSCODE='the passcode' python3 laura-ronnie/build.py\n\n"
            "Nothing is built without one — the page would go out unlocked.")

    for src, _, _ in JOBS:
        if not src.exists():
            raise Refused("Missing %s — nothing was written." % src.name)

    LOCKED.mkdir(exist_ok=True)
    wrong = passcode + "-not-it"

    for src, dest, as_text in JOBS:
        plain = src.read_bytes()
        blob = lock(plain, passcode)

        # Check our work BEFORE writing: the real passcode gives the bytes
        # back exactly, and a wrong one does not give them back at all.
        ok, back = unlock(blob, passcode)
        if not ok or back != plain:
            raise Refused("%s did not come back the same. Nothing was written."
                          % src.name)
        ok, back = unlock(blob, wrong)
        if ok and back == plain:
            raise Refused("%s unlocked with the WRONG passcode. Nothing was written."
                          % src.name)

        dest.write_bytes(base64.b64encode(blob) if as_text else blob)
        print("  locked  %-34s %9d bytes -> %s"
              % (src.name, len(plain), dest.name))

    (HERE / "index.html").write_text(DOOR, encoding="utf-8")
    print("  wrote   index.html")
    print("\nAll three came back byte for byte with the passcode, and none of "
          "them opened without it.")


# --------------------------------------------------------------------- #
# The door. Written out verbatim; it needs nothing from the build but its
# own existence, so there is nothing to substitute.
# --------------------------------------------------------------------- #

DOOR = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Laura &amp; Ronnie</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root{
    --surface-base:#F3EEE4; --surface-raised:#FDFBF6; --surface-sunken:#EDE6D8; --surface-line:#DFD6C3;
    --ink-primary:#221E17; --ink-secondary:#4E4839; --ink-on-mark:#FFF9EE;
    --action-mark:#8E6210; --action-signal:#157A70;
    --lift-card:0 1px 2px rgba(60,50,30,.05),0 16px 36px -16px rgba(60,50,30,.18);
    --font-display:'Barlow Condensed','Arial Narrow',sans-serif;
    --font-text:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --font-data:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
    --radius-card:14px; --radius-well:10px; --radius-control:8px;
    --ease-out:cubic-bezier(0.16,1,0.3,1);
  }
  *{box-sizing:border-box;}
  body{
    margin:0; background:var(--surface-base); color:var(--ink-primary); color-scheme:light;
    font-family:var(--font-text); font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased;
  }
  a{color:var(--action-mark); text-decoration-thickness:1px; text-underline-offset:3px;}
  a:hover{color:var(--ink-primary);}
  button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible,audio:focus-visible{
    outline:2px solid var(--action-signal); outline-offset:2px;
  }
  .wrap{max-width:680px; margin:0 auto; padding:0 20px 72px;}

  /* ---------- the door ---------- */
  .door{max-width:680px; margin:0 auto; padding:96px 20px 72px;}
  .brand{font-family:var(--font-display); font-weight:600; font-size:19px; letter-spacing:.09em;
         text-transform:uppercase; margin:0 0 6px; color:var(--ink-primary);}
  .door-lede{margin:0 0 32px; color:var(--ink-secondary);}
  .door form{display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; max-width:420px;}
  .door label{display:block; font-family:var(--font-display); font-size:15px; font-weight:600;
              letter-spacing:.09em; text-transform:uppercase; margin-bottom:7px;}
  .door .field{flex:1 1 200px;}
  #pass{
    width:100%; font-family:var(--font-data); font-size:16px; color:var(--ink-primary);
    background:var(--surface-raised); border:1px solid var(--surface-line);
    border-radius:var(--radius-well); padding:12px 14px;
  }
  #pass:focus{border-color:var(--action-signal);}
  #door-msg{min-height:1.6em; margin:16px 0 0; color:var(--ink-primary); max-width:44ch;}
  #door-msg:empty{margin:0;}

  .btn{
    font-family:var(--font-text); font-size:15px; font-weight:600; border-radius:var(--radius-control);
    padding:12px 24px; cursor:pointer; border:1px solid transparent;
    transition:background .15s var(--ease-out), color .15s var(--ease-out), border-color .15s var(--ease-out);
  }
  .btn-primary{background:var(--action-mark); color:var(--ink-on-mark); border-color:var(--action-mark);}
  .btn-primary:hover{background:var(--ink-primary); border-color:var(--ink-primary);}
  .btn-primary[disabled]{opacity:.65; cursor:default;}
  .btn-quiet{background:transparent; color:var(--ink-primary); border-color:var(--surface-line); font-weight:500;}
  .btn-quiet:hover{border-color:var(--action-signal);}
  .btn-quiet.done{background:var(--action-signal); border-color:var(--action-signal); color:var(--ink-on-mark);}

  /* ---------- the page ---------- */
  .hero{padding:64px 0 8px;}
  .eyebrow{font-family:var(--font-display); font-weight:600; font-size:15px; letter-spacing:.09em;
           text-transform:uppercase; color:var(--action-mark); margin:0 0 14px;}
  .hero h1{font-family:var(--font-display); font-weight:600; font-size:clamp(44px,11vw,72px);
           line-height:.96; letter-spacing:.01em; text-transform:uppercase; margin:0 0 16px;}
  .hero-when{font-family:var(--font-data); font-size:13.5px; line-height:1.6;
             color:var(--ink-secondary); margin:0 0 22px;}
  .hero-lede{font-size:17px; margin:0; max-width:44ch;}

  .card{background:var(--surface-raised); border:1px solid var(--surface-line);
        border-radius:var(--radius-card); padding:28px 26px; margin:22px 0; box-shadow:var(--lift-card);}
  .card h2{font-family:var(--font-display); font-size:24px; font-weight:600; letter-spacing:.05em;
           text-transform:uppercase; margin:0 0 18px;}
  .lede{color:var(--ink-secondary); margin:16px 0 0;}
  .card > .lede:first-of-type{margin:-6px 0 18px;}

  /* timeline */
  .timeline{list-style:none; margin:0; padding:0;}
  .timeline li{display:flex; gap:16px; padding:15px 0; border-top:1px solid var(--surface-line);}
  .timeline li:first-child{border-top:none; padding-top:0;}
  .t-time{font-family:var(--font-data); font-size:12.5px; line-height:1.75; margin:0;
          flex:0 0 82px; color:var(--ink-primary); font-variant-numeric:tabular-nums;}
  .t-body{flex:1 1 auto; min-width:0;}
  .t-body p{margin:0;}
  .t-name{font-weight:600;}
  .t-body p + p{margin-top:5px; color:var(--ink-secondary);}
  .t-note{margin-top:10px !important; padding:11px 13px; background:var(--surface-sunken);
          border:1px solid var(--surface-line); border-radius:var(--radius-well); font-size:14.5px;}

  /* songs */
  .songs{display:flex; flex-direction:column;}
  .song{padding:16px 0; border-top:1px solid var(--surface-line);}
  .song:first-child{border-top:none; padding-top:0;}
  .song p{margin:0;}
  .s-moment{font-family:var(--font-display); font-size:15px; font-weight:600; letter-spacing:.09em;
            text-transform:uppercase; color:var(--action-mark); margin-bottom:5px !important;}
  .s-title{font-size:16.5px;}
  .s-tag{font-family:var(--font-data); font-size:12px; letter-spacing:.03em; color:var(--ink-secondary);
         white-space:nowrap;}
  .s-note{margin-top:5px !important; color:var(--ink-secondary); font-size:15px;}

  .player{margin-top:13px; padding:13px; background:var(--surface-sunken);
          border:1px solid var(--surface-line); border-radius:var(--radius-well);}
  .p-label{font-family:var(--font-display); font-size:14px; font-weight:600; letter-spacing:.09em;
           text-transform:uppercase; margin-bottom:9px !important;}
  .p-status{font-size:14.5px; color:var(--ink-secondary);}
  .player audio{width:100%; display:block;}
  /* `display:block` above beats the browser's own rule for [hidden], so say
     it again here — without this the players show before they have a song. */
  .player audio[hidden], [hidden]{display:none !important;}

  /* lists */
  .links{list-style:none; margin:0; padding:0;}
  .links li + li{margin-top:11px;}
  .links a{font-size:16.5px;}
  .nope{margin:0; padding:0 0 0 20px;}
  .nope li{margin-bottom:7px;}

  /* form */
  .fld{display:block; font-weight:600; font-size:15px; margin:22px 0 8px;}
  .fld.sub{font-weight:500; margin-top:14px;}
  form > .fld:first-child{margin-top:0;}
  input[type=text], input[type=url], textarea{
    width:100%; font-family:var(--font-text); font-size:16px; color:var(--ink-primary);
    background:var(--surface-sunken); border:1px solid var(--surface-line);
    border-radius:var(--radius-well); padding:12px 13px;
  }
  input:focus, textarea:focus{border-color:var(--action-signal);}
  input::placeholder, textarea::placeholder{color:var(--ink-secondary); opacity:1;}
  textarea{resize:vertical;}
  .fld-set{border:1px solid var(--surface-line); border-radius:var(--radius-well);
           padding:16px 16px 18px; margin:22px 0 0;}
  /* These questions are long, so on a phone the legend wraps to two or three
     lines — and a wrapped legend straddles the top border, which then runs
     straight through the words. Floating it drops it inside the box as an
     ordinary block and lets the border close; the rest of the set clears it.
     `clear` rather than `overflow:hidden`, which would crop the focus rings. */
  .fld-set legend{float:left; width:100%; padding:0; margin:0 0 10px;
                  font-weight:600; font-size:15px;}
  .fld-set > *:not(legend){clear:both;}
  .opt{display:flex; align-items:flex-start; gap:10px; margin-top:11px; cursor:pointer;}
  .opt input{margin:0; width:20px; height:20px; flex:none; accent-color:var(--action-mark);}
  .actions{display:flex; flex-wrap:wrap; gap:11px; margin-top:28px;}
  .say{min-height:1.6em; margin:14px 0 0; color:var(--ink-secondary);}
  .say:empty{margin:0;}

  .page-foot{padding:8px 0 0; color:var(--ink-secondary);}
  .page-foot p{margin:0;}

  @media(max-width:520px){
    .card{padding:22px 18px;}
    .timeline li{flex-direction:column; gap:5px;}
    .t-time{flex:none;}
  }

  .fade{animation:fade .5s var(--ease-out) both;}
  @keyframes fade{from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:none}}
  @media(prefers-reduced-motion:reduce){ *,*::before,*::after{animation:none!important; transition:none!important;} }
</style>
</head>
<body>

<main id="door" class="door">
  <p class="brand">Savvy Sounds</p>
  <p class="door-lede">A page for the two of you.</p>
  <form id="door-form" novalidate>
    <div class="field">
      <label for="pass">Passcode</label>
      <input id="pass" name="pass" type="password" autocomplete="off"
             autocapitalize="off" autocorrect="off" spellcheck="false"
             aria-describedby="door-msg" />
    </div>
    <button type="submit" id="open-btn" class="btn btn-primary">Open</button>
  </form>
  <p id="door-msg" role="alert"></p>
</main>

<main id="page" class="wrap" hidden></main>

<script>
/*
  The door, browser side. Same lock as the Conduit's members' area:
  OpenSSL's salted format, PBKDF2-HMAC-SHA256 100000 rounds, AES-256-CBC.
  Browser natives only — no library, nothing loaded from anywhere else.

  WebCrypto only exists in a secure context: https, or localhost. Opened
  as a file:// this page cannot unlock anything. See VERIFY.md.
*/
(function () {
  "use strict";

  var MAGIC = "Salted__";
  var ITERATIONS = 100000;
  var MAILTO = "hello@savvysoundscollective.com";
  var SUBJECT = "Laura & Ronnie — answers";

  var doorEl = document.getElementById("door");
  var pageEl = document.getElementById("page");
  var formEl = document.getElementById("door-form");
  var passEl = document.getElementById("pass");
  var btnEl = document.getElementById("open-btn");
  var msgEl = document.getElementById("door-msg");

  // One state, three values. The Open button is guarded by this and not by
  // a timer: two fast presses, and the second one finds "working" and stops.
  var state = "idle"; // idle | working | open

  function gone(what) {
    var e = new Error(what);
    e.gone = true;
    return e;
  }

  function bytesFromBase64(b64) {
    var clean = String(b64).replace(/\s+/g, "");
    var binary = atob(clean);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /* OpenSSL's salted blob + passcode -> the bytes that went in. Throws on
     a wrong passcode (the padding fails) and on anything not that shape. */
  async function decryptBlob(blob, passcode) {
    if (blob.length < 16) throw new Error("not the right shape");
    if (new TextDecoder().decode(blob.slice(0, 8)) !== MAGIC) {
      throw new Error("not the right shape");
    }
    var salt = blob.slice(8, 16);
    var ciphertext = blob.slice(16);

    var passKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
      passKey, 48 * 8);
    var derived = new Uint8Array(bits);
    var key = await crypto.subtle.importKey(
      "raw", derived.slice(0, 32), "AES-CBC", false, ["decrypt"]);

    return crypto.subtle.decrypt(
      { name: "AES-CBC", iv: derived.slice(32, 48) }, key, ciphertext);
  }

  async function grab(url) {
    var r;
    try {
      r = await fetch(url, { cache: "no-store" });
    } catch (e) {
      throw gone("could not reach " + url);
    }
    if (!r.ok) throw gone(url + " is not there");
    return r;
  }

  /* The page body: base64 on the wire, text at the end. `fatal` on the
     decoder closes the last gap — roughly one wrong passcode in 256 has
     padding that happens to check out, and its bytes are not UTF-8. */
  async function unlockText(url, passcode) {
    var b64 = await (await grab(url)).text();
    var plain = await decryptBlob(bytesFromBase64(b64), passcode);
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  }

  /* The songs: raw binary on the wire, 3.8 MB and 4.3 MB of it. */
  async function unlockBytes(url, passcode) {
    var buf = await (await grab(url)).arrayBuffer();
    return decryptBlob(new Uint8Array(buf), passcode);
  }

  function remember(passcode) {
    try { sessionStorage.setItem("lr-pass", passcode); } catch (e) { /* private window */ }
  }
  function remembered() {
    try { return sessionStorage.getItem("lr-pass") || ""; } catch (e) { return ""; }
  }
  function forget() {
    try { sessionStorage.removeItem("lr-pass"); } catch (e) { /* nothing to do */ }
  }

  // ------------------------------------------------------------------ //
  // Opening.
  // ------------------------------------------------------------------ //

  async function open(passcode, quiet) {
    if (state !== "idle") return;
    if (!passcode) {
      msgEl.textContent = "Type the passcode Miles sent you.";
      passEl.focus();
      return;
    }
    state = "working";
    btnEl.disabled = true;
    if (!quiet) msgEl.textContent = "Opening…";

    var html;
    try {
      html = await unlockText("locked/page.enc", passcode);
    } catch (e) {
      state = "idle";
      btnEl.disabled = false;
      forget();
      msgEl.textContent = e.gone
        ? "This page won't open — tell Miles."
        : "That's not it — check the passcode Miles sent you.";
      passEl.setAttribute("aria-invalid", "true");
      passEl.select();
      passEl.focus();
      return;
    }

    pageEl.innerHTML = html;
    pageEl.hidden = false;
    pageEl.classList.add("fade");
    doorEl.remove();
    document.title = "Laura & Ronnie";
    state = "open";
    remember(passcode);

    wireForm();
    // The songs are big; the page is readable long before they land.
    player("entrance", "locked/laura-entrance.enc", passcode);
    player("cake", "locked/cake.enc", passcode);
  }

  function tryOpen(ev) {
    ev.preventDefault();
    passEl.removeAttribute("aria-invalid");
    open(passEl.value.trim(), false);
  }

  formEl.addEventListener("submit", tryOpen);

  // The Go key on a phone keyboard, said out loud. Most browsers turn it
  // into a submit on their own, but this page is opened on a phone first
  // and that is the main way in, so it does not get left to chance.
  // `state` still guards it: Go and then Open cannot open the page twice.
  passEl.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") tryOpen(ev);
  });

  // ------------------------------------------------------------------ //
  // The two players.
  // ------------------------------------------------------------------ //

  /* Ready means the browser has read the song's own header, which is what
     puts a real length on the scrubber. The timer is there so a song that
     never reports still gets its player instead of "Loading" forever. */
  function ready(audio) {
    return new Promise(function (resolve) {
      if (audio.readyState >= 1) return resolve();
      var t = setTimeout(done, 10000);
      function done() {
        clearTimeout(t);
        audio.removeEventListener("loadedmetadata", done);
        audio.removeEventListener("error", done);
        resolve();
      }
      audio.addEventListener("loadedmetadata", done);
      audio.addEventListener("error", done);
    });
  }

  async function player(name, url, passcode) {
    var audio = document.getElementById("audio-" + name);
    var status = document.getElementById("p-status-" + name);
    if (!audio || !status) return;
    try {
      var buf = await unlockBytes(url, passcode);
      audio.src = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      await ready(audio);
      audio.hidden = false;
      status.hidden = true;
    } catch (e) {
      status.textContent = "This one won't play here — tell Miles.";
    }
  }

  // ------------------------------------------------------------------ //
  // The answers.
  // ------------------------------------------------------------------ //

  /* Every question they answered, in the order they appear on the page;
     blanks are left out.

     The wording of each question is read off the page itself — the label
     over a box, the legend over a set of choices — and is never repeated
     in here. Two reasons, and the second is the important one: the
     questions can be reworded in one place, and this file is PUBLIC.
     Everything of the couple's lives inside the locked page; a copy of
     their questions sitting in the door would hand over the very thing
     the lock is for. */
  function answers() {
    var form = document.getElementById("answers");
    if (!form) return "";
    var lines = [];
    var done = {};
    var fields = form.querySelectorAll("input, textarea");

    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];

      if (el.type === "radio") {
        if (done[el.name]) continue;      // one line per set of choices
        done[el.name] = true;
        var picked = form.querySelector('input[name="' + el.name + '"]:checked');
        if (!picked) continue;
        var box = el.closest("fieldset");
        var legend = box ? box.querySelector("legend") : null;
        lines.push((legend ? legend.textContent.trim() : el.name)
                   + "\n" + picked.value);
        continue;
      }

      var value = el.value.trim();
      if (!value) continue;
      var label = el.id ? form.querySelector('label[for="' + el.id + '"]') : null;
      lines.push((label ? label.textContent.trim() : (el.name || el.id))
                 + "\n" + value);
    }
    return lines.join("\n\n");
  }

  function mailto(body) {
    return "mailto:" + MAILTO
      + "?subject=" + encodeURIComponent(SUBJECT)
      + "&body=" + encodeURIComponent(body);
  }

  function wireForm() {
    var form = document.getElementById("answers");
    var send = document.getElementById("send-btn");
    var copy = document.getElementById("copy-btn");
    var say = document.getElementById("say");
    if (!form || !send || !copy || !say) return;

    // Kept current as they type, so the button always carries exactly what
    // it would send.
    function refresh() { send.dataset.mailto = mailto(answers()); }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    refresh();

    send.addEventListener("click", function () {
      var body = answers();
      if (!body) { say.textContent = "Nothing filled in yet."; return; }
      refresh();
      say.textContent = "Opening your mail app…";
      window.location.href = send.dataset.mailto;
    });

    var back = null;
    copy.addEventListener("click", async function () {
      var body = answers();
      if (!body) { say.textContent = "Nothing filled in yet."; return; }
      try {
        await navigator.clipboard.writeText(body);
        copy.textContent = "Copied";
        copy.classList.add("done");
        say.textContent = "";
        clearTimeout(back);
        back = setTimeout(function () {
          copy.textContent = "Copy the answers";
          copy.classList.remove("done");
        }, 3000);
      } catch (e) {
        say.textContent = "Couldn't copy — use Send to Miles instead.";
      }
    });
  }

  // A reload inside the same tab should not ask again.
  var saved = remembered();
  if (saved) open(saved, true);
})();
</script>

</body>
</html>
"""


def main():
    try:
        build(os.environ.get("PAGE_PASSCODE", ""))
    except Refused as e:
        print("\n  Not built.\n\n  %s\n" % e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
