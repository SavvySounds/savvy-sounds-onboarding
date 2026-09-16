/* Walk Miles's own view in a real browser and report what was measured.
 *
 *   node corporate/proof/walk-dj.mjs
 *
 * No dependency of any kind: node 24's own WebSocket talks to a headless
 * Chrome over the devtools protocol.  Nothing here opens a window, makes a
 * sound or takes the mouse — Miles is at the keyboard while it runs.
 *
 * Three habits, each of them paid for on another project:
 *
 *   * the world is ESTABLISHED and then ASSERTED before anything is recorded.
 *     The first page load of a fresh Chrome is thrown away, and every reading
 *     starts by checking innerWidth and document.visibilityState are what this
 *     walk thinks they are.  A window that has not settled answers confidently
 *     about a page it is not showing.
 *   * a check reads the page's own numbers and compares them with the doors'
 *     JSON, fetched separately.  "The screen looks right" is not a reading.
 *   * a check that cannot look REFUSES.  A busy port, a Chrome that will not
 *     start, a probe that matched nothing: all red, never skipped.
 *
 * It runs against its own seeded store and its own server, on its own port,
 * and kills what it started before it prints the last line.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(HERE);
const BENCH = dirname(CORPORATE);
const FRAMES = join(HERE, 'frames');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDE = { name: 'desk', width: 1440, height: 900 };
const PHONE = { name: 'phone', width: 390, height: 844 };

// Every capitalised word this page says in its OWN voice.  Anything else on
// screen has to have come from the doors, and what the doors carry is pinned
// by tests/test_ship_safe.py.  A real client's name landing in a label here
// goes red on the next walk.
const PAGE_WORDS = new Set([
  'AM', 'PM',
  'Savvy', 'Sounds', 'Miles', 'Your', 'Open', 'Start', 'Back', 'Show', 'Hide',
  'Press', 'Copy', 'Copied', 'Name', 'Email', 'Date', 'Time', 'Company',
  'Event', 'Who', 'The', 'Everybody', 'Leave', 'It', 'No', 'Nothing', 'None',
  'What', 'Waiting', 'Needs', 'These', 'Anything', 'Taken', 'Kept', 'Marked',
  'Answered', 'Booking', 'Not', 'Send', 'A', 'That', 'This', 'Every', 'Take',
  'Keep', 'Settling', 'Saving', 'Marking', 'Making', 'Making', 'Paste',
  'Somebody', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December', 'Yours', 'Nobody',
  'Both', 'When', 'Where', 'Read', 'Walk', 'One', 'Left', 'Mark', 'Save',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct',
  'Nov', 'Dec', 'Running', 'Day'
]);

// ------------------------------------------------------------------ scoring

const marks = [];
let failed = 0;

function mark(ok, line) {
  marks.push((ok ? 'PASS  ' : 'FAIL  ') + line);
  if (!ok) failed += 1;
  process.stdout.write((ok ? 'PASS  ' : 'FAIL  ') + line + '\n');
}

function is(got, want, line) {
  mark(String(got) === String(want), `${line} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

function atLeast(got, floor, line) {
  mark(Number(got) >= Number(floor), `${line} — ${got} (needs ${floor} or more)`);
}

function refuse(words) {
  process.stdout.write('FAIL  ' + words + '\n');
  process.exitCode = 1;
  throw new Error(words);
}

// -------------------------------------------------------------------- tools

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }

function freePort() {
  return new Promise((done, no) => {
    const probe = createServer();
    probe.on('error', no);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function portIsFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.on('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

function run(command, args, options) {
  return new Promise((done, no) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (bit) => { out += bit; });
    child.stderr.on('data', (bit) => { err += bit; });
    child.on('error', no);
    child.on('exit', (code) => (code === 0 ? done(out) : no(new Error(err || out))));
  });
}

// --------------------------------------------------------- the devtools wire

class Chrome {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    socket.addEventListener('message', (note) => {
      const said = JSON.parse(note.data);
      if (said.id && this.waiting.has(said.id)) {
        const { done, no } = this.waiting.get(said.id);
        this.waiting.delete(said.id);
        if (said.error) no(new Error(said.error.message));
        else done(said.result);
      }
    });
  }

  static async open(port) {
    for (let tries = 0; tries < 60; tries += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((target) => target.type === 'page');
        if (page) {
          const socket = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((done, no) => {
            socket.addEventListener('open', done, { once: true });
            socket.addEventListener('error', no, { once: true });
          });
          return new Chrome(socket);
        }
      } catch (not_yet) { /* chrome is still starting */ }
      await sleep(250);
    }
    refuse('chrome never offered a page to walk');
  }

  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done, no) => {
      this.waiting.set(id, { done, no });
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          no(new Error(`${method} never answered`));
        }
      }, 30000);
    });
  }

  async read(expression) {
    const answer = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (answer.exceptionDetails) {
      throw new Error(answer.exceptionDetails.exception?.description
        || answer.exceptionDetails.text);
    }
    return answer.result.value;
  }

  async waitFor(expression, what, ms = 8000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try {
        if (await this.read(`Boolean(${expression})`)) return true;
      } catch (not_yet) { /* the page is still building */ }
      await sleep(100);
    }
    mark(false, `waited for ${what} and it never came`);
    return false;
  }

  async size({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"', 'the page to finish loading');
  }

  async key(code, windowsVirtualKeyCode, key, text) {
    // The browser pane's own key events carry empty key/code and perform no
    // native activation at all, so every key here goes through the protocol
    // with both spellings set.  A key that types something (Enter included,
    // which types a carriage return) has to be a keyDown carrying that text,
    // or Chrome hands the page a press it will not act on.
    const common = {
      code, key: key || code, windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers: 0
    };
    await this.send('Input.dispatchKeyEvent', text
      ? { type: 'keyDown', text, unmodifiedText: text, ...common }
      : { type: 'rawKeyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async tab(times = 1) {
    for (let i = 0; i < times; i += 1) {
      await this.key('Tab', 9, 'Tab');
      await sleep(40);
    }
  }

  async enter() { await this.key('Enter', 13, 'Enter', '\r'); await sleep(350); }

  async type(words) {
    for (const letter of words) {
      await this.send('Input.dispatchKeyEvent', { type: 'char', text: letter });
    }
  }

  async shot(name) {
    // captureBeyondViewport, and then the picture is CHECKED against the page
    // it claims to be of.  A plain capture on this Mac re-lays the document out
    // at the real window's width and crops the result to the emulated one: the
    // frame then shows a 1440-wide page cut off at 390, while every measurement
    // taken from the live page says 390 and is right.  A frame nobody checks is
    // a different page.
    const picture = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true
    });
    const raw = Buffer.from(picture.data, 'base64');
    writeFileSync(join(FRAMES, `dj-${name}.png`), raw);
    const width = raw.readUInt32BE(16);
    const asked = await this.read('window.innerWidth');
    mark(width === asked,
      `the frame dj-${name}.png is of the page it says it is — ${width}px wide, window ${asked}px`);
    return width;
  }
}

// ------------------------------------------------------------- the readings

const CONTRAST_PROBE = `(() => {
  const lin = (c) => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const bits = (colour) => (colour.match(/[0-9.]+/g) || []).map(Number);
  const opaque = (node) => {
    let at = node;
    while (at) {
      const paint = bits(getComputedStyle(at).backgroundColor);
      if (paint.length >= 3 && (paint.length < 4 || paint[3] === 1)) return paint.slice(0, 3);
      at = at.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => {
    const one = lum(a), two = lum(b);
    return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
  };
  const seen = [];
  document.querySelectorAll('h1, h2, h3, p, dd, dt, li, button, code, span.value, .pill').forEach((node) => {
    const words = (node.textContent || '').trim();
    if (!words || node.querySelector('h1,h2,h3,p,dd,dt,li,button,code,span,div')) return;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.opacity === '0') return;
    const ink = bits(style.color).slice(0, 3);
    const ground = opaque(node);
    const size = parseFloat(style.fontSize);
    const heavy = parseInt(style.fontWeight, 10) >= 600;
    seen.push({
      words: words.slice(0, 40),
      tag: node.tagName.toLowerCase(),
      size,
      big: size >= 24 || (size >= 18.66 && heavy),
      action: node.tagName === 'BUTTON' || node.tagName === 'A',
      ratio: Math.round(ratio(ink, ground) * 100) / 100
    });
  });
  return seen;
})()`;

const FOCUS_PROBE = `(() => {
  const at = document.activeElement;
  if (!at || at === document.body) return null;
  const style = getComputedStyle(at);
  const box = at.getBoundingClientRect();
  return {
    tag: at.tagName.toLowerCase(),
    words: (at.textContent || at.value || at.getAttribute('aria-label') || '').trim().slice(0, 40),
    outlineWidth: parseFloat(style.outlineWidth) || 0,
    outlineStyle: style.outlineStyle,
    height: Math.round(box.height),
    width: Math.round(box.width),
    onScreen: box.width > 0 && box.height > 0
  };
})()`;

const WORDS_PROBE = `(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walk.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    out.push(node.textContent);
  }
  return out.join(' ');
})()`;

// ------------------------------------------------------------------ the walk

async function main() {
  mkdirSync(FRAMES, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'corp-dj-walk-'));
  const shared = process.env.CORP_SHARED_SERVER === '1';
  const store = shared ? process.env.CORP_DATA : join(scratch, 'store');
  const profile = join(scratch, 'chrome');
  mkdirSync(store, { recursive: true });
  mkdirSync(profile, { recursive: true });

  // 8800 and its home 8803: clear of the preview's two doors (8790 and 8793)
  // and of the shared soundcheck's (8794 and 8797), so this walk can run right
  // after either of them, or beside the preview, and never meet them.
  const port = Number(process.env.CORP_PORT || 8800);
  if (port === 8790 || port === 8793) refuse('this walk refuses the preview\'s own ports (8790 and its home 8793)');
  if (!shared && !(await portIsFree(port))) {
    refuse(`port ${port} is busy, so this walk cannot run. Stop whatever holds it, or set CORP_PORT.`);
  }

  // --- its own store, its own server -------------------------------------
  const seeded = await run('node', ['corporate/script/seed.mjs'],
    { cwd: BENCH, env: { ...process.env, CORP_DATA: store } });
  const pass = (seeded.match(/pass[^:]*:\s*([0-9a-f]{32})/i) || [])[1];
  // One block per event, so a link is never picked up under the wrong event.
  // The first approver in the whole printout belongs to the first event, and
  // using it on the second is a 403 that looks like a broken door.
  const links = {};
  let blockName = '';
  for (const line of seeded.split('\n')) {
    if (/^\S/.test(line)) blockName = line.trim();
    const found = line.match(/^\s{2}(\S.*?)\s{2,}(\w+)\s+\S+\/corporate\/client\/#([0-9a-f]{32})/);
    if (found) links[`${blockName}|${found[2]}`] = found[3];
  }
  if (!pass) refuse('the seed printed no pass for Miles, so there is nothing to walk with');
  const linkFor = (eventName, role) => {
    const key = Object.keys(links).find((one) =>
      one.startsWith(eventName) && one.endsWith('|' + role));
    if (!key) refuse(`the seed printed no ${role} link for ${eventName}`);
    return links[key];
  };
  const approver = linkFor('Northstar', 'approver');

  const server = shared ? null : spawn('node', ['corporate/script/standin.mjs'], {
      cwd: BENCH, env: { ...process.env, CORP_PORT: String(port), CORP_DATA: store },
      stdio: 'ignore'
    });
  const base = `http://127.0.0.1:${port}`;
  let alive = false;
  for (let tries = 0; tries < 60 && !alive; tries += 1) {
    try { alive = (await fetch(`${base}/corporate/client/`)).status === 200; } catch (not_yet) { await sleep(150); }
  }
  if (!alive) { if (server) server.kill(); refuse('the server never answered on its own port'); }

  const asMiles = async (path, options = {}) => (await fetch(
    `http://127.0.0.1:${port + 3}/macros/s/local/exec`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ door: path, token: pass, body: options.body })
    })).json();
  const doors = asMiles;

  const cdp = await freePort();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${cdp}`,
    '--use-mock-keychain', '--password-store=basic',
    `--user-data-dir=${profile}`, `--window-size=${WIDE.width},${WIDE.height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--disable-extensions', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  const packUp = () => {
    try { chrome.kill(); } catch (gone) { /* already */ }
    if (server) try { server.kill(); } catch (gone) { /* already */ }
  };
  // A walk killed half way (a closed pipe, a control-C) must not leave a
  // server holding the port and a Chrome holding the profile.
  process.on('exit', packUp);
  process.on('SIGINT', () => { packUp(); process.exit(130); });
  process.on('SIGTERM', () => { packUp(); process.exit(143); });

  let page;
  try {
    page = await Chrome.open(cdp);
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    // The first load of a fresh Chrome is a window that has not settled.
    await page.goto(`${base}/corporate/dj/`);
    await sleep(400);

    // ------------------------------------------------- the phone, at a venue
    await page.size(PHONE);
    await page.goto(`${base}/corporate/dj/`);
    await settled(page, PHONE);

    await gateChecks(page, base, pass);
    const rows = (await doors('/api/events')).events;
    const northstar = rows.find((row) => row.name.includes('Northstar'));
    const harbor = rows.find((row) => row.name.includes('Harbor'));
    if (!northstar || !harbor) refuse('the two pretend events are not both in the doors');

    await overviewChecks(page, rows, PHONE);
    await page.shot('phone-overview');

    await openEvent(page, northstar.event_id);
    await eventReadingChecks(page, await doors(`/api/events/${northstar.event_id}`), PHONE);
    await changeListChecks(page, northstar.event_id, doors, PHONE);
    await page.shot('phone-event');
    await noSidewaysScroll(page, PHONE);
    await focusRingWalk(page, PHONE);
    await contrastChecks(page, PHONE);
    await wordsOnScreenChecks(page, northstar.event_id, doors);
    await copyHonestyChecks(page);

    // ------------------------------------------------------- the desk, later
    await page.size(WIDE);
    await page.goto(`${base}/corporate/dj/#/e/${northstar.event_id}`);
    await settled(page, WIDE);
    await page.waitFor('document.querySelectorAll("section.block").length > 3', 'the event to paint');
    await noSidewaysScroll(page, WIDE);
    await focusRingWalk(page, WIDE);
    await contrastChecks(page, WIDE);
    await page.shot('desk-event');

    await daySheetChecks(page, cdp, northstar.event_id, asMiles);
    await proposalChecks(page, northstar.event_id, doors);
    await seenChecks(page, northstar.event_id, doors, base, approver);
    await ownItemChecks(page, northstar.event_id, doors);
    await page.shot('desk-after-settling');

    // ---------------------------------------------- back to the phone, after
    await page.size(PHONE);
    await page.goto(`${base}/corporate/dj/#/e/${northstar.event_id}`);
    await settled(page, PHONE);
    await page.waitFor('document.body.textContent.includes("8:15 PM")', 'the settled time on the phone');
    await noSidewaysScroll(page, PHONE);
    await page.shot('phone-after-settling');

    await bookingZoneChecks(page, base, doors);
    await biggerTextChecks(page, base, northstar.event_id);
    await stillWithReducedMotion(page);
    await keyboardOnlyChecks(page, base, northstar.event_id);
  } finally {
    chrome.kill();
    if (server) server.kill();
    await sleep(200);
    rmSync(scratch, { recursive: true, force: true });
  }

  // ------------------------------------------- readings that need no browser
  vocabularyPinned();
  noMarkupFromStrangers();

  process.stdout.write(`\n${marks.length - failed} of ${marks.length} readings passed.\n`);
  if (failed) {
    process.stdout.write('SOMETHING IS RED above. Every line names what was measured.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(`Frames in ${'corporate/proof/frames'}.\n`);
  }
}

// ---------------------------------------------------------------- the checks

async function settled(page, want) {
  const world = await page.read(`({
    width: window.innerWidth, height: window.innerHeight,
    seen: document.visibilityState, ratio: window.devicePixelRatio
  })`);
  is(world.width, want.width, `${want.name}: the window is the width this walk asked for`);
  is(world.seen, 'visible', `${want.name}: the page is visible, so what it reports is what it shows`);
}

async function gateChecks(page, base, pass) {
  await page.waitFor('document.getElementById("pass")', 'the pass box');
  const label = await page.read(`document.querySelector('label[for="pass"]').textContent`);
  is(label, 'Your pass', 'the gate asks for his pass in his words');
  const box = await page.read(`(() => {
    const at = document.getElementById('pass').getBoundingClientRect();
    const form = document.querySelector('form').getBoundingClientRect();
    return { height: Math.round(at.height), width: Math.round(at.width), form: Math.round(form.width) };
  })()`);
  atLeast(box.height, 44, 'the pass box is big enough to hit on a phone');
  mark(box.width >= box.form - 2,
    `and as wide as the form it is in — ${box.width}px of ${box.form}px`);

  await page.read(`document.getElementById('pass').value = 'ffffffffffffffffffffffffffffffff';
    document.querySelector('form').requestSubmit(); true`);
  await page.waitFor('document.querySelector(".problem")', 'the refusal');
  const refusal = await page.read(`document.querySelector('.problem').textContent`);
  mark(/does not open anything/.test(refusal) && /link-expired/.test(refusal),
    `a wrong pass shows the door's own words — "${refusal.trim().slice(0, 70)}"`);

  const inAddress = await page.read('location.href');
  mark(!inAddress.includes('ffffffff'), `the pass never reaches the address bar — ${inAddress.replace(base, '')}`);

  await page.read(`document.getElementById('pass').value = ${JSON.stringify(pass)};
    document.querySelector('form').requestSubmit(); true`);
  await page.waitFor('document.querySelectorAll("section.block").length > 0', 'the events');
  const kept = await page.read(`sessionStorage.getItem('savvy-dj-pass')`);
  is(kept, pass, 'the pass is kept in this window only');
  const address = await page.read('location.href');
  mark(!address.includes(pass), `and still never in the address bar — ${address.replace(base, '')}`);
}

async function overviewChecks(page, rows, want) {
  const onScreen = await page.read(`Array.from(document.querySelectorAll('section.block')).map((block) => ({
    name: block.querySelector('h3') ? block.querySelector('h3').textContent : '',
    pills: Array.from(block.querySelectorAll('.pill')).map((pill) => pill.textContent.trim()),
    next: block.querySelector('.next-action') ? block.querySelector('.next-action').textContent : ''
  }))`);
  is(onScreen.length, rows.length, `${want.name}: every event the doors list is on the overview`);

  const sorted = rows.slice().sort((a, b) => b.needs_me - a.needs_me);
  is(onScreen[0].name, sorted[0].name, `${want.name}: the one that needs him is at the top`);

  for (const row of rows) {
    const block = onScreen.find((seen) => seen.name === row.name);
    if (!block) { mark(false, `${row.name} is not on the overview at all`); continue; }
    const words = block.pills.join(' | ');
    const need = row.needs_me
      ? `${row.needs_me} ${row.needs_me === 1 ? 'needs you' : 'need you'}`
      : 'nothing needs you';
    const changed = row.changed_since_seen
      ? `${row.changed_since_seen} change${row.changed_since_seen === 1 ? '' : 's'} since you last looked`
      : 'nothing new since you last looked';
    const waiting = row.waiting_on_client
      ? `${row.waiting_on_client} waiting on the client`
      : 'nothing waiting on the client';
    mark(words.includes(need), `${row.name}: "needs you" on screen is the door's number — ${row.needs_me} · "${words}"`);
    mark(words.includes(changed), `${row.name}: "since you last looked" on screen is the door's number — ${row.changed_since_seen}`);
    mark(words.includes(waiting), `${row.name}: "waiting on the client" on screen is the door's number — ${row.waiting_on_client}`);
    is(block.next.trim(), row.next_action, `${row.name}: the one sentence matches the door`);
  }
}

async function openEvent(page, eventId) {
  await page.read(`Array.from(document.querySelectorAll('button.event-open'))
    .find((b) => b.closest('section').querySelector('h3').textContent.includes('Northstar')).click(); true`);
  await page.waitFor(`location.hash === '#/e/${eventId}'`, 'the event to open');
  await page.waitFor('document.querySelectorAll("section.block").length > 3', 'the event to paint');
}

async function eventReadingChecks(page, event, want) {
  const text = await page.read(WORDS_PROBE);

  // the planner's proposal, both values, and who asked
  mark(text.includes('8:00 PM') && text.includes('8:15 PM'),
    `${want.name}: the proposal shows both times — 8:00 PM as it stands, 8:15 PM asked for`);
  mark(text.includes('Jules'), `${want.name}: the person who asked is named on the screen`);
  const buttons = await page.read(`Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim())`);
  mark(buttons.some((words) => words === 'Take Jules’s 8:15 PM'),
    `${want.name}: the button says what it will do — "${buttons.find((w) => w.startsWith('Take')) || 'nothing like it'}"`);
  mark(buttons.some((words) => words.startsWith('Keep 8:00 PM')),
    `${want.name}: and the other says the opposite — "${buttons.find((w) => w.startsWith('Keep')) || 'nothing like it'}"`);
  const owner = await page.read(`document.body.textContent.includes('Jules Okafor owns this part of the night')`);
  mark(owner, `${want.name}: the person whose part of the night it is, is named`);

  // the night that crosses midnight
  mark(text.includes('9:30 PM–12:30 AM'), `${want.name}: the dancing reads 9:30 PM–12:30 AM`);
  const nextDay = await page.read(`Array.from(document.querySelectorAll('.moment')).some((m) =>
    m.textContent.includes('9:30 PM') && m.textContent.includes('finishes the next day'))`);
  mark(nextDay, `${want.name}: and says it finishes the next day`);
  const threeHours = await page.read(`Array.from(document.querySelectorAll('.moment')).some((m) =>
    m.textContent.includes('9:30 PM') && m.textContent.includes('3 hrs'))`);
  mark(threeHours, `${want.name}: counted as 3 hrs, not minus twenty-one`);

  // "12:30 AM" is not military time; "21:41" is.
  const twentyFourHour = /(?<![\d:])([01]\d|2[0-3]):[0-5]\d(?!\s?[AP]M)/;
  mark(twentyFourHour.test('20:15') && twentyFourHour.test('asked on 14 Sept, 21:41 Chicago')
       && !twentyFourHour.test('12:30 AM') && !twentyFourHour.test('9:30 PM–12:30 AM'),
       `${want.name}: the 24-hour probe can see a planted time and lets 12:30 AM through`);
  const timeBlocks = await page.read(`(() => {
    const block = (title) => Array.from(document.querySelectorAll('section.block'))
      .find((section) => (section.querySelector('h2') || {}).textContent === title);
    return { running: block('The running order').textContent,
             needs: block('Needs you').textContent };
  })()`);
  mark(!twentyFourHour.test(timeBlocks.running), `${want.name}: the running order has no 24-hour time`);
  mark(!twentyFourHour.test(timeBlocks.needs), `${want.name}: the needs-you block has no 24-hour time`);

  // the cue and the pronunciation, word for word
  const cue = (event.moments.find((m) => m.moment_id === 'm_awards') || {}).cue_text || '';
  mark(text.includes(cue.slice(0, 40)), `${want.name}: the cue is on screen word for word`);
  mark(text.includes('Siobhan - shi-VAWN'), `${want.name}: so is how to say the name`);

  // the private note, and the zone
  mark(text.includes(event.dj_notes.slice(0, 30)), `${want.name}: his own note is here`);
  mark(text.includes('Central time (Chicago)'), `${want.name}: the event's own zone is named in the form's plain words, because it is not this Mac's`);
  mark(!text.includes('America/'), `${want.name}: no zone on his page reads like a file name`);

  // the part of the night the client named themselves
  mark(text.includes('Raffle'), `${want.name}: the part the client named ("Raffle") is on his running order under that name`);
  mark(!/\bCustom\b/.test(text) && !text.includes('part of the night ·'),
    `${want.name}: and it is never shown as "Custom" or as a made-up word of this page's`);

  // who is waiting on whom
  mark(text.includes('Waiting on Theo'), `${want.name}: the client side is named, not "the approver"`);
}

async function changeListChecks(page, eventId, doors, want) {
  // The form arriving is one thing that happened, shown as one line.  The
  // arithmetic still has to add up to what the door holds, or the screen is
  // quietly hiding history rather than folding it.
  const all = (await doors(`/api/events/${eventId}/changes?since=0`)).changes;
  // Both backslashes are deliberate: this pattern is written inside a template
  // literal, and a single one is eaten on the way to the browser — the regex
  // then matches nothing and the check reads green while seeing nothing.  It
  // is why the count of grouped rows is asserted below, not assumed.
  const seen = await page.read(`(() => {
    const rows = Array.from(document.querySelectorAll('#changed .row'));
    const together = rows
      .map((row) => {
        const head = row.querySelector('h3');
        return head && (head.textContent.match(/^(\\d+) answers arrived together/) || [])[1];
      })
      .filter(Boolean).map(Number);
    const more = (document.querySelector('#changed').textContent
      .match(/Show the (\\d+) older change/) || [])[1];
    return { rows: rows.length, together: together, hidden: Number(more || 0) };
  })()`);
  atLeast(seen.together.length, 1,
    `${want.name}: the probe found the folded line it is counting`);
  const counted = seen.rows - seen.together.length
    + seen.together.reduce((sum, many) => sum + many, 0) + seen.hidden;
  is(counted, all.length,
    `${want.name}: the change list accounts for every line the door holds — ${seen.rows} rows `
    + `(one of them ${seen.together.join('+') || 'none'} answers at once) plus ${seen.hidden} older`);
  mark(seen.rows <= 12,
    `${want.name}: and it is never a wall — ${seen.rows} rows on screen at once`);
}

async function noSidewaysScroll(page, want) {
  const measured = await page.read(`({
    scroll: document.documentElement.scrollWidth, window: window.innerWidth,
    over: Array.from(document.querySelectorAll('body *'))
      .filter((n) => n.getBoundingClientRect().right > window.innerWidth + 0.5)
      .slice(0, 6)
      .map((n) => n.tagName.toLowerCase() + '.' + (n.className || '?') + '@'
        + Math.round(n.getBoundingClientRect().right)
        + ' "' + (n.textContent || '').trim().slice(0, 20) + '"')
  })`);
  mark(measured.scroll <= measured.window,
    `${want.name}: nothing runs off the side — the page is ${measured.scroll}px wide in a ${measured.window}px window`
    + (measured.scroll > measured.window ? ` · over the edge: ${measured.over.join(', ')}` : ''));
}

async function focusRingWalk(page, want) {
  const reachable = await page.read(`document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]').length`);
  await page.read('document.body.focus(); window.scrollTo(0, 0); true');
  const stops = [];
  const seen = new Set();
  for (let i = 0; i < reachable + 6; i += 1) {
    await page.tab();
    const at = await page.read(FOCUS_PROBE);
    if (!at) continue;
    const key = at.tag + '|' + at.words + '|' + at.width + '|' + at.height;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push(at);
  }
  const ringed = stops.filter((stop) => stop.outlineWidth >= 2 && stop.outlineStyle !== 'none');
  const small = stops.filter((stop) => stop.height < 44 && stop.tag !== 'a' && stop.tag !== 'code');
  atLeast(stops.length, Math.min(reachable, 8), `${want.name}: the keyboard reaches the controls`);
  is(ringed.length, stops.length,
    `${want.name}: every keyboard stop draws a real ring${ringed.length === stops.length ? '' : ' — ' + stops.filter((s) => !(s.outlineWidth >= 2)).map((s) => s.tag + ':' + s.words).join(', ')}`);
  is(small.length, 0,
    `${want.name}: every control is at least 44px tall${small.length ? ' — ' + small.map((s) => s.tag + ':' + s.words + '=' + s.height).join(', ') : ''}`);
}

async function contrastChecks(page, want) {
  const seen = await page.read(CONTRAST_PROBE);
  atLeast(seen.length, 12, `${want.name}: the contrast probe actually found words to measure`);
  const text = seen.filter((one) => !one.action && !one.big);
  const actions = seen.filter((one) => one.action || one.big);
  const thinText = text.filter((one) => one.ratio < 7);
  const thinAction = actions.filter((one) => one.ratio < 4.5);
  const worstText = Math.min(...text.map((one) => one.ratio));
  const worstAction = actions.length ? Math.min(...actions.map((one) => one.ratio)) : 21;
  is(thinText.length, 0,
    `${want.name}: every word he reads is 7:1 or better — worst ${worstText}${thinText.length ? ' at "' + thinText[0].words + '" ' + thinText[0].ratio : ''}`);
  is(thinAction.length, 0,
    `${want.name}: every action is 4.5:1 or better — worst ${worstAction}${thinAction.length ? ' at "' + thinAction[0].words + '" ' + thinAction[0].ratio : ''}`);
}

async function wordsOnScreenChecks(page, eventId, doors) {
  const [event, changes, questions] = await Promise.all([
    doors(`/api/events/${eventId}`),
    doors(`/api/events/${eventId}/changes?since=0`),
    doors('/api/questions')
  ]);
  const namesIn = (text) => (text.replace(/[’']/g, ' ').match(/[A-Z][A-Za-z-]+/g) || []);
  const fromTheDoors = namesIn(JSON.stringify([event, changes, questions]));
  const onScreen = await page.read(WORDS_PROBE);
  const strangers = [...new Set(namesIn(onScreen))].filter((word) =>
    !PAGE_WORDS.has(word)
    // a word this page had to shorten to fit is still the doors' word
    && !fromTheDoors.some((known) => known === word || known.startsWith(word)));
  is(strangers.length, 0,
    `every name on this screen came from the event or from this page's own pinned words${strangers.length ? ' — stranger: ' + strangers.join(', ') : ''}`);

  // prove the eyes: a name that is definitely not ours, put on the page
  const caught = await page.read(`(() => {
    const planted = document.createElement('p');
    planted.textContent = 'Zzyzx Kowalczyk';
    document.body.appendChild(planted);
    const found = (document.body.textContent.match(/[A-Z][A-Za-z']+/g) || []).includes('Zzyzx');
    planted.remove();
    return found;
  })()`);
  mark(caught, 'the sweep can see a name that is not ours before it trusts a clean answer');
}

async function copyHonestyChecks(page) {
  const allowed = await page.read(`(async () => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Copy');
    if (!button) return { words: 'no copy button' };
    let landed = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { landed = text; return Promise.resolve(); } },
      configurable: true
    });
    button.click();
    await new Promise((r) => setTimeout(r, 120));
    return { words: button.textContent.trim(), landed: landed };
  })()`);
  is(allowed.words, 'Copied', `a clipboard that opens says Copied — and carried "${allowed.landed}"`);
  mark(Boolean(allowed.landed), 'and what it carried is the thing beside the button');

  const refused = await page.read(`(async () => {
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Copy');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('no')) },
      configurable: true
    });
    button.click();
    await new Promise((r) => setTimeout(r, 120));
    return { words: button.textContent.trim(), picked: String(window.getSelection()) };
  })()`);
  is(refused.words, 'Press ⌘C', 'a clipboard that refuses never says Copied');
  mark(refused.picked.length > 0, `and it selects the words instead — "${refused.picked.slice(0, 40)}"`);
}

async function daySheetChecks(page, cdp, eventId, asMiles) {
  const before = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).length;
  await page.read(`Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.trim() === 'Open the day sheet').click(); true`);
  await sleep(1200);
  const after = await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
  const opened = after.filter((target) => target.type === 'page' && target.url.startsWith('blob:'));
  mark(opened.length > 0 && after.length > before,
    `the day sheet opens in another tab — ${after.length - before} new tab, ${opened.length} of them the sheet itself`);

  const sheet = (await asMiles(`/api/events/${eventId}/daysheet`)).text;
  const event = await asMiles(`/api/events/${eventId}`);
  mark(sheet.includes(`revision ${event.revision}`),
    `the sheet carries the same revision as the view — ${event.revision}`);
  mark(/snapshot of revision/.test(sheet), 'and says in words that it is a snapshot, not a live page');
  mark(!sheet.includes(event.dj_notes.slice(0, 20)), 'and his private note is not on it');
  mark(sheet.includes('Raffle'), 'the part the client named ("Raffle") is on the sheet under that name');
  mark(sheet.includes('Central time (Chicago)') && !sheet.includes('America/'),
    'the sheet says the zone in the form\'s plain words, never as a file name');
  for (const target of opened) {
    await fetch(`http://127.0.0.1:${cdp}/json/close/${target.id}`).catch(() => {});
  }
}

async function proposalChecks(page, eventId, doors) {
  const before = await doors(`/api/events/${eventId}`);
  await page.read(`Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.trim().startsWith('Take Jules')).click(); true`);
  await page.waitFor(`document.body.textContent.includes(
    'Taken. Awards — start time is now 8:15 PM, was 8:00 PM.')`, 'the settling to land');
  // …and then on the screen having actually been rebuilt with it.  The
  // sentence is said before the repaint; reading the page in between is how a
  // green walk and a red walk differ by milliseconds.
  await page.waitFor(`Array.from(document.querySelectorAll('.moment')).some((m) =>
    m.textContent.includes('8:15 PM\u20139:00 PM'))`, 'the running order to be rebuilt');
  const after = await doors(`/api/events/${eventId}`);

  is(after.revision, before.revision + 1, 'taking the proposal moves the revision on by one');
  const awards = after.moments.find((m) => m.moment_id === 'm_awards');
  is(awards.start, '20:15', 'the awards now start at the time the planner asked for');
  is(awards.proposal, null, 'and nothing is still being proposed on it');

  const onScreen = await page.read(`Array.from(document.querySelectorAll('.moment')).map((m) => m.textContent).join(' | ')`);
  mark(/8:15 PM–9:00 PM/.test(onScreen), `the running order shows the new time — ${(onScreen.match(/8:15 PM–9:00 PM/) || [''])[0]}`);
  const flagged = await page.read(`Array.from(document.querySelectorAll('.moment')).some((m) =>
    m.textContent.includes('8:15 PM') && m.textContent.includes('check this cue'))`);
  mark(flagged, 'the cue underneath it is flagged to be checked again');

  const born = after.open_items.filter((item) => item.origin === 'rule:time-change' && !item.resolved);
  atLeast(born.length, 2, 'the change opened the questions the brain says it should');
  const waiting = await page.read(`document.body.textContent`);
  mark(born.every((item) => waiting.includes(item.question.slice(0, 30))),
    'and every one of them is on the screen, under the person who owes it');
}

async function seenChecks(page, eventId, doors, base, approverToken) {
  await page.read(`Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.trim() === 'Mark as looked at').click(); true`);
  await page.waitFor('document.body.textContent.includes("Marked.")', 'the marking to land');
  await page.waitFor(`Array.from(document.querySelectorAll('button')).some((b) =>
    b.textContent.trim() === 'Mark as looked at' && b.disabled)`, 'the screen to be rebuilt with nothing new');

  let rows = (await doors('/api/events')).events;
  let row = rows.find((one) => one.event_id === eventId);
  is(row.changed_since_seen, 0, 'after marking it, nothing is new any more');
  const event = await doors(`/api/events/${eventId}`);
  is(event.dj_seen_revision, event.revision, 'and the bookmark is where the event is');

  // a client saves through their own door, the way they would from their page
  const saved = await (await fetch(`http://127.0.0.1:${Number(new URL(base).port) + 3}/macros/s/local/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ door: `/api/events/${eventId}/save`, token: approverToken,
      body: { base_revision: event.revision, submission_id: 'sub_walk_' + Date.now(),
        answers: { crowd_notes: { value: 'Two rooms in one, all night.', state: 'confirmed' } } } })
  })).json();
  is(saved.status, 200, 'the client can still save from their own side');

  rows = (await doors('/api/events')).events;
  row = rows.find((one) => one.event_id === eventId);
  is(row.changed_since_seen, 1, 'and their one save is the one thing that is new');

  await page.goto(`${base}/corporate/dj/#/`);
  await page.waitFor('document.querySelectorAll("section.block").length > 1', 'the overview');
  const pills = await page.read(`Array.from(document.querySelectorAll('section.block')).find((b) =>
    b.textContent.includes('Northstar')).textContent`);
  mark(pills.includes('1 change since you last looked'),
    'the overview says so in his words — "1 change since you last looked"');
}

async function ownItemChecks(page, eventId, doors) {
  const before = await doors(`/api/events/${eventId}`);
  const mine = before.open_items.find((item) => item.owner === 'dj' && !item.resolved);
  if (!mine) { mark(false, 'there was no question of his own left to answer'); return; }

  await page.read(`location.hash = '#/e/${eventId}'; true`);
  await page.waitFor(`document.getElementById('a-${mine.item_id}')`, 'the answer box for his own question');
  await page.read(`document.getElementById('a-${mine.item_id}').value = 'Something slow and warm to open, nothing anybody has to know.'; true`);
  await page.read(`Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.trim() === 'That’s answered').click(); true`);
  await page.waitFor('document.body.textContent.includes("Answered.")', 'the answer to land');
  await page.waitFor(`!document.getElementById('a-${mine.item_id}')`, 'the question to leave the screen');

  const after = await doors(`/api/events/${eventId}`);
  const item = after.open_items.find((one) => one.item_id === mine.item_id);
  mark(item.resolved === true, `his own question is ticked off — ${mine.item_id}`);
  mark(String(item.answer || '').startsWith('Something slow'), 'and what he wrote is what was kept');
  const stillThere = await page.read(`document.body.textContent.includes(${JSON.stringify(mine.question.slice(0, 30))})`);
  mark(!stillThere, 'and it is off the screen');
}

async function bookingZoneChecks(page, base, doors) {
  // The zone picker on "Start a booking" offers the form's own zones, in the
  // form's plain words; the one option that is not a zone is left out.
  const form = await doors('/api/questions');
  const tz = (form.questions || []).find((q) => q.id === 'tz') || {};
  const zones = (tz.options || []).filter((zone) => zone.includes('/'));
  await page.goto(`${base}/corporate/dj/#/new`);
  await page.waitFor('!!document.querySelector("#f-tz")', 'the booking form');
  const options = await page.read(`Array.from(document.querySelectorAll('#f-tz option'))
    .map((o) => ({ value: o.value, words: o.textContent.replace(' (yours)', '').trim() }))`);
  const listed = options.filter((o) => zones.includes(o.value));
  mark(listed.length === zones.length && zones.every((zone) => listed.some((o) => o.value === zone)),
    `his booking form offers the form's ${zones.length} zones — ${listed.length} of them on the picker`);
  mark(listed.every((o) => o.words === tz.option_labels[o.value]),
    `and each one wears the form's plain words — ${listed.map((o) => o.words).join(' | ')}`);
  mark(options.every((o) => !/[/_]/.test(o.words)), 'no zone on the picker reads like a file name');
  mark(!options.some((o) => o.value === 'Other'), 'and "Somewhere else" is not a zone a booking can be started in');
}

async function biggerTextChecks(page, base, eventId) {
  // The one accessibility setting he would actually reach for: bigger text in
  // the browser.  Sizes on this page are in rem, so the whole screen has to
  // grow with it — and still not run off the side of a phone.
  const before = await page.read('parseFloat(getComputedStyle(document.body).fontSize)');
  await page.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });
  await page.goto(`${base}/corporate/dj/#/e/${eventId}`);
  await page.waitFor('document.querySelectorAll("section.block").length > 3', 'the event at bigger text');
  const after = await page.read(`({
    body: parseFloat(getComputedStyle(document.body).fontSize),
    head: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
    button: Math.round(document.querySelector('button').getBoundingClientRect().height),
    scroll: document.documentElement.scrollWidth, window: window.innerWidth
  })`);
  mark(after.body > before,
    `bigger text in the browser makes the page bigger — body went ${before}px to ${after.body}px`);
  atLeast(after.head, after.body * 1.5, 'and the headings keep their place above the words');
  atLeast(after.button, 44, 'and a button is still at least 44px tall');
  mark(after.scroll <= after.window,
    `and nothing runs off the side at bigger text — ${after.scroll}px in a ${after.window}px window`);
  await page.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
  await page.goto(`${base}/corporate/dj/#/e/${eventId}`);
  await page.waitFor('document.querySelectorAll("section.block").length > 3', 'the event back at normal text');
}

async function stillWithReducedMotion(page) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await sleep(300);
  const first = await page.send('Page.captureScreenshot', { format: 'png' });
  await sleep(700);
  const second = await page.send('Page.captureScreenshot', { format: 'png' });
  mark(first.data === second.data,
    `with motion turned down the screen is completely still — ${first.data.length} bytes both times`);
  await page.send('Emulation.setEmulatedMedia', { features: [] });
}

async function keyboardOnlyChecks(page, base, eventId) {
  await page.goto(`${base}/corporate/dj/#/e/${eventId}`);
  await page.waitFor('document.querySelectorAll("section.block").length > 3', 'the event');
  await page.read('document.body.focus(); true');
  let landed = false;
  for (let i = 0; i < 8 && !landed; i += 1) {
    await page.tab();
    landed = await page.read(`document.activeElement && document.activeElement.textContent.trim() === 'Back to the events'`);
  }
  mark(landed, 'the way back is reachable with the keyboard alone');
  if (landed) {
    await page.enter();
    const hash = await page.read('location.hash');
    is(hash, '#/', 'and pressing return on it actually goes back');
  }
}

// ---------------------------------------------- readings that need no browser

function gsTable(source, name) {
  const block = source.split(`const ${name} = {`)[1];
  if (block === undefined) return null;
  const inside = block.split('}')[0];
  const out = {};
  for (const [, key, value] of inside.matchAll(/([a-z_]+)\s*:\s*"([a-z_]+)"/g)) out[key] = value;
  return out;
}

function jsTable(source, name) {
  const block = source.split(`var ${name} = {`)[1];
  if (block === undefined) return null;
  const inside = block.split('};')[0];
  const out = {};
  for (const [, key, value] of inside.matchAll(/([a-z_]+)\s*:\s*'([a-z_]+)'/g)) out[key] = value;
  return out;
}

function vocabularyPinned() {
  const rules = readFileSync(join(CORPORATE, 'script', 'rules.gs'), 'utf8');
  const screen = readFileSync(join(CORPORATE, 'dj', 'dj.js'), 'utf8');
  for (const name of ['OWNER_ROLE', 'OWNER_FALLBACK', 'MOMENT_FIELD_OWNER']) {
    const brain = gsTable(rules, name);
    const page = jsTable(screen, name);
    if (!brain || !page) { mark(false, `${name}: could not be read out of both files`); continue; }
    atLeast(Object.keys(brain).length, 2, `${name}: read out of rules.gs`);
    is(JSON.stringify(page), JSON.stringify(brain),
      `${name}: the screen says exactly what the brain says — ${Object.keys(brain).length} words`);
  }
}

function noMarkupFromStrangers() {
  const screen = readFileSync(join(CORPORATE, 'dj', 'dj.js'), 'utf8');
  const guilty = screen.split('\n')
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(line)
      && !/^\s*\*/.test(line) && !/There is no innerHTML/.test(line));
  is(guilty.length, 0,
    `nothing on this page turns somebody else's words into markup${guilty.length ? ' — line ' + guilty.map(([n]) => n).join(', ') : ''}`);
}

main().catch((problem) => {
  process.stdout.write(`FAIL  the walk fell over: ${problem.message}\n`);
  process.exitCode = 1;
});
