/* The walk through the client's private page, on a real screen.
 *
 *   node corporate/proof/walk-client.mjs
 *
 * It starts everything it needs on a port nobody else is using, with its own
 * practice store in a throwaway folder, walks both invented events at phone
 * width and laptop width, and prints one line per check.  Red anywhere and it
 * exits red.  It kills every process it started, by pid.
 *
 * Nothing here opens a window, makes a sound or takes the mouse.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import { launch } from './cdp.mjs';

const PROOF = dirname(fileURLToPath(import.meta.url));
const CORPORATE = resolve(PROOF, '..');
const TOP = resolve(CORPORATE, '..');
const FRAMES = join(PROOF, 'frames');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ------------------------------------------------------------------ plumbing

function freePort() {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function run(cmd, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd: TOP, env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => code === 0 ? done(out) : fail(new Error(err || out)));
  });
}

// Every server this walk starts, so not one of them can outlive it.  One did:
// a python server sat on a random port for twenty minutes after a run, holding
// a practice store nobody could see.
const started = new Set();

async function startServer(port, data) {
  const child = spawn('python3', [join(CORPORATE, 'server.py')],
    { cwd: TOP, env: { ...process.env, CORP_PORT: String(port), CORP_DATA: data },
      stdio: ['ignore', 'pipe', 'pipe'] });
  started.add(child);
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { 'X-Access-Token': 'x' } });
      if (answer.status) return child;
    } catch { await sleep(100); }
  }
  child.kill('SIGKILL');
  throw new Error(`the server never opened on ${port}`);
}

async function stopServer(child) {
  if (!child) return;
  if (child.exitCode !== null) { started.delete(child); return; }
  child.kill('SIGTERM');
  await sleep(200);
  if (child.exitCode === null) child.kill('SIGKILL');
  await sleep(150);
  started.delete(child);
}

async function stopEverything() {
  for (const child of [...started]) await stopServer(child);
  const alive = [...started].filter((c) => c.exitCode === null);
  return alive.length;
}

function readLinks(printed) {
  const events = [];
  let here = null;
  for (const line of printed.split('\n')) {
    const grant = line.match(/^ {2}(.+?) {2,}(approver|planner|production|contact) +http:\/\/[^/]+\/c\/([0-9a-f]{32})/);
    const pass = line.match(/carry: {2}([0-9a-f]{32})/);
    if (pass) { events.dj = pass[1]; continue; }
    if (grant && here) { here.people.push({ name: grant[1].trim(), role: grant[2], token: grant[3] }); continue; }
    if (/^\S.*\S$/.test(line) && !line.startsWith('Store') && !line.startsWith('Miles')
        && !line.startsWith('His pass') && !line.startsWith('Start the server')) {
      here = { name: line.trim(), people: [] };
      events.push(here);
    }
  }
  return events;
}

async function door(base, token, path, body) {
  const options = { method: body ? 'POST' : 'GET', headers: { 'X-Access-Token': token } };
  if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const answer = await fetch(base + path, options);
  return { status: answer.status, data: await answer.json().catch(() => null) };
}

// --------------------------------------------------------------- page hands

const settle = (page) =>
  page.evaluate('Promise.all(document.getAnimations().map(a => a.finished)).then(() => true)');

async function watchFetch(page) {
  // Wrap the page's own fetch so the walk can read what it really sent,
  // without the page carrying a single line for the benefit of a test.
  await page.evaluate(`(() => {
    if (window.__sent) return true;
    window.__sent = [];
    const real = window.fetch;
    window.fetch = function (url, options) {
      let body = null;
      try { body = options && options.body ? JSON.parse(options.body) : null; } catch (e) {}
      const note = {url: String(url), method: (options && options.method) || 'GET', body: body, status: 0};
      window.__sent.push(note);
      const answer = real.apply(this, arguments);
      answer.then(function (res) {
        note.status = res.status;
        res.clone().text().then(function (text) { note.said = text.slice(0, 400); }, function () {});
      }, function () { note.status = -1; });
      return answer;
    };
    return true;
  })()`);
}

const sent = (page) => page.evaluate('window.__sent || []');

async function statusLine(page) {
  return page.evaluate("(document.getElementById('status')||{}).innerText || ''");
}

async function waitStatus(page, words, seconds = 12) {
  await page.waitFor(
    `((document.getElementById('status')||{}).innerText||'').indexOf(${JSON.stringify(words)}) >= 0`,
    { seconds, what: `the status line to say ${JSON.stringify(words)}` });
}

async function screen390(page, tag, width) { return screen(page, tag, width); }

async function screen(page, tag, width) {
  await settle(page);
  const wide = await page.evaluate(
    '({scroll: document.documentElement.scrollWidth, inner: window.innerWidth})');
  check(`${tag} · no sideways scroll at ${width}`, wide.scroll <= wide.inner,
        `${wide.scroll} wide inside ${wide.inner}`);
  await page.shot(join(FRAMES, `client-${tag}.png`));
  return wide;
}

/* Press a control by the words on it. */
async function pressWords(page, words, nth = 0) {
  const hit = await page.evaluate(`(() => {
    const wanted = ${JSON.stringify(words)};
    const all = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === wanted);
    const node = all[${nth}];
    if (!node) return null;
    node.id = node.id || 'walk_' + Math.random().toString(16).slice(2);
    return node.id;
  })()`);
  if (!hit) throw new Error(`no control says "${words}"`);
  await page.click('#' + hit);
  await sleep(60);
}

async function gotoSection(page, index) {
  await page.waitFor("document.getElementById('nextbtn')");
  const now = await page.evaluate("(document.getElementById('step')||{}).innerText || ''");
  if (!now) { await pressWords(page, 'Continue'); await sleep(120); }
  for (let guard = 0; guard < 12; guard += 1) {
    const step = await page.evaluate("(document.getElementById('step')||{}).innerText || ''");
    const at = Number(String(step).split('/')[0]) - 1;
    if (at === index) return;
    await page.click(at < index ? '#nextbtn' : '#backbtn');
    await sleep(140);
  }
  throw new Error(`could not reach part ${index + 1}`);
}

async function typeInto(page, selector, text) {
  await page.click(selector);
  await page.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  })()`);
  await page.type(text);
}

/* A question already marked "Not sure yet" hides its box until that control
   is pressed again; a client typing into it has to do the same. */
async function clearState(page, qid) {
  const pressed = await page.evaluate(`(() => {
    const block = document.getElementById('q_' + ${JSON.stringify(qid)});
    if (!block) return null;
    const node = [...block.querySelectorAll('.states .chip')]
      .find(b => b.getAttribute('aria-pressed') === 'true');
    if (!node) return null;
    node.id = node.id || 'walk_' + Math.random().toString(16).slice(2);
    return node.id;
  })()`);
  if (pressed) { await page.click('#' + pressed); await sleep(150); }
}

async function writeAnswer(page, qid, text) {
  await clearState(page, qid);
  const selector = '#f_' + qid;
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)}) && document.querySelector(${JSON.stringify(selector)}).offsetParent !== null`,
                     { what: `the box for ${qid}` });
  await clearField(page, selector);
  await typeInto(page, selector, text);
}

async function clearField(page, selector) {
  await page.click(selector);
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await page.key('Backspace');
}

/* The state control of one question, by the plain words on it. */
async function pressState(page, qid, words) {
  const hit = await page.evaluate(`(() => {
    const block = document.getElementById('q_' + ${JSON.stringify(qid)});
    if (!block) return null;
    const node = [...block.querySelectorAll('.states .chip')]
      .find(b => b.textContent.trim() === ${JSON.stringify(words)});
    if (!node) return null;
    node.id = node.id || 'walk_' + Math.random().toString(16).slice(2);
    return node.id;
  })()`);
  if (!hit) throw new Error(`question ${qid} offers no "${words}"`);
  await page.click('#' + hit);
  await sleep(80);
}

// ------------------------------------------------------------------ readings

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(ink, ground) {
  const a = luminance(ink), b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* Colours off the REAL ground: walk up until something is actually painted. */
async function inkAndGround(page, selector) {
  return page.evaluate(`(() => {
    const parts = (text) => {
      const inside = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
      return inside.split(',').map(p => parseFloat(p.trim()));
    };
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const ink = parts(getComputedStyle(node).color);
    let ground = null;
    for (let at = node; at; at = at.parentElement) {
      const paint = parts(getComputedStyle(at).backgroundColor);
      if (paint.length === 3 || (paint.length === 4 && paint[3] > 0.95)) {
        ground = paint.slice(0, 3);
        break;
      }
    }
    if (!ground) ground = parts(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    return {ink: ink.slice(0, 3), ground: ground, text: (node.innerText || '').slice(0, 30)};
  })()`);
}

async function contrastChecks(page, tag) {
  const wanted = [
    ['body text', '.card .qhelp, .card p.muted, .card .ans .k', 7],
    ['a question label', '.card .qlabel', 7],
    ['the action button', '.btn.go', 4.5]
  ];
  for (const [what, selector, floor] of wanted) {
    const reading = await inkAndGround(page, selector);
    if (!reading) { check(`${tag} · contrast of ${what}`, false, 'nothing on screen to measure'); continue; }
    const measured = ratio(reading.ink, reading.ground);
    check(`${tag} · contrast of ${what}`, measured >= floor,
          `${measured.toFixed(2)}:1 needs ${floor}:1 (ink ${reading.ink.join(',')} on ${reading.ground.join(',')})`);
  }
}

/* Tab through everything on this screen and count the rings that are OURS.
   Chrome's own grey ring is not a focus style we wrote. */
async function keyboardWalk(page, tag) {
  const reachable = await page.evaluate(`
    [...document.querySelectorAll('button, input, textarea, select, a[href]')]
      .filter(n => !n.disabled && n.offsetParent !== null).length`);
  await page.evaluate('document.body.focus(); window.scrollTo(0,0)');
  await page.evaluate("document.querySelector('.topbar').setAttribute('tabindex','-1'); document.querySelector('.topbar').focus()");
  const seen = new Set();
  let rings = 0, grey = 0;
  for (let press = 0; press < reachable + 6; press += 1) {
    await page.key('Tab');
    const at = await page.evaluate(`(() => {
      const node = document.activeElement;
      if (!node || node === document.body) return null;
      node.id = node.id || 'walk_tab_' + Math.random().toString(16).slice(2);
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {tag: node.tagName, id: node.id, words: (node.innerText || node.value || '').slice(0, 24),
              width: style.outlineWidth, style: style.outlineStyle, colour: style.outlineColor,
              w: rect.width, h: rect.height};
    })()`);
    if (!at) continue;
    if (seen.has(at.id)) continue;
    seen.add(at.id);
    const ours = at.style !== 'none' && parseFloat(at.width) >= 3 &&
                 at.colour.replace(/\s/g, '') === 'rgb(21,122,112)';
    if (ours) rings += 1; else grey += 1;
  }
  check(`${tag} · every control reached by keyboard wears our focus ring`,
        grey === 0 && rings >= reachable,
        `${rings} of ${reachable} controls, ${grey} without our ring`);
}

async function targetChecks(page, tag) {
  const small = await page.evaluate(`
    [...document.querySelectorAll('button')]
      .filter(n => n.offsetParent !== null)
      .map(n => ({words: n.textContent.trim().slice(0, 20), h: Math.round(n.getBoundingClientRect().height)}))
      .filter(n => n.h < 44)`);
  check(`${tag} · every control is at least 44 tall`, small.length === 0,
        small.length ? small.map(s => `${s.words} ${s.h}px`).join(', ') : 'all of them');
}

// --------------------------------------------------------------------- walk

async function walk({ fixture, width, height, keepMine }) {
  const tag = `${fixture}-${width}`;
  const shared = process.env.CORP_SHARED_SERVER === '1';
  const data = shared ? process.env.CORP_DATA : await mkdtemp(join(tmpdir(), 'corp-walk-'));
  const port = shared ? Number(process.env.CORP_PORT) : await freePort();
  if (!data || !port) throw new Error('a shared walk needs CORP_DATA and CORP_PORT');
  const base = `http://127.0.0.1:${port}`;
  let server = null;
  let page = null;
  try {
    const printed = await run('python3', [join(CORPORATE, 'seed.py')], { CORP_DATA: data });
    const events = readLinks(printed);
    const wanted = events.find((e) => e.name.toLowerCase().includes(fixture));
    if (!wanted) throw new Error(`no practice event called ${fixture}`);
    const approver = wanted.people.find((p) => p.role === 'approver');
    const djPass = events.dj;
    if (!shared) server = await startServer(port, data);
    else {
      const ready = await fetch(`${base}/api/me`, { headers: { 'X-Access-Token': 'x' } });
      if (!ready.status) throw new Error('the shared server did not answer');
    }

    page = await launch({ width, height, scratch: process.env.CORP_WALK_SCRATCH || undefined });
    const world = await page.open(`${base}/c/${approver.token}`);
    check(`${tag} · the private link opens on a settled ${width}-wide screen`,
          world.vis === 'visible' && world.w === width, `${world.w}x${world.h}, ${world.vis}`);
    await page.waitFor("document.querySelector('.view')", { what: 'the first screen' });
    await watchFetch(page);

    const where = await page.evaluate('location.pathname');
    check(`${tag} · the address bar keeps no private link`, where === '/c', where);

    const me = await door(base, approver.token, '/api/me');
    const eventId = me.data.event_id;

    const opening = await page.evaluate("document.getElementById('main').innerText");
    check(`${tag} · the start screen says whose event it is and where they left off`,
          opening.includes(approver.name.split(' ')[0]) && /questions have an answer|Nothing filled in|You sent/.test(opening),
          opening.split('\n').filter(Boolean).slice(-4)[0]);
    await screen(page, `${tag}-start`, width);

    // ---- the form, section by section -----------------------------------
    await pressWords(page, 'Continue');
    await sleep(150);
    const asked = await page.evaluate("document.querySelectorAll('.q').length");
    check(`${tag} · the first part asks the questions the file holds`, asked > 0, `${asked} questions`);
    await screen(page, `${tag}-form-1`, width);
    await contrastChecks(page, tag);
    await targetChecks(page, tag);

    // ---- a half-typed answer survives going back and forward ------------
    await gotoSection(page, 1);                       // The purpose
    await writeAnswer(page, 'success_looks_like', 'Half a thought about the');
    await page.click('#backbtn');                      // this flushes the save
    await sleep(200);
    await page.click('#nextbtn');
    await sleep(200);
    const halfway = await page.evaluate("document.querySelector('#f_success_looks_like').value");
    check(`${tag} · a half-typed answer is still there after going back a part`,
          halfway === 'Half a thought about the', JSON.stringify(halfway));

    // ---- the four states round-trip -------------------------------------
    await gotoSection(page, 2);                        // The room
    await writeAnswer(page, 'crowd_notes', 'Two halves of one company in one room.');
    await pressState(page, 'languages_cultures', 'Not sure yet');
    await gotoSection(page, 3);                        // The sound — flushes
    await pressState(page, 'playlist_links', 'There are none');
    await waitStatus(page, 'Saved · revision');
    const afterStates = await door(base, approver.token, `/api/events/${eventId}`);
    const states = {
      confirmed: afterStates.data.answers.crowd_notes.state,
      unknown: afterStates.data.answers.languages_cultures.state,
      none: afterStates.data.answers.playlist_links.state,
      blank: (afterStates.data.answers.open_questions || { state: 'blank' }).state
    };
    const distinct = new Set(Object.values(states)).size === 4;
    check(`${tag} · the four answer states come back apart from each other`,
          distinct && states.confirmed === 'confirmed' && states.unknown === 'unknown' &&
          states.none === 'none' && states.blank === 'blank',
          Object.entries(states).map(([k, v]) => `${k}=${v}`).join(' '));
    check(`${tag} · a typed answer arrives word for word`,
          afterStates.data.answers.crowd_notes.value === 'Two halves of one company in one room.',
          JSON.stringify(afterStates.data.answers.crowd_notes.value));

    // ---- a save must not rebuild the box under somebody's hands ---------
    await gotoSection(page, 2);
    await typeInto(page, '#f_crowd_notes', ' Still typing');
    await waitStatus(page, 'Saved · revision');
    const stillThere = await page.evaluate(`({
      focused: document.activeElement.id,
      words: (document.querySelector('#f_crowd_notes') || {}).value
    })`);
    check(`${tag} · a save under way does not take the box away from them`,
          stillThere.focused === 'f_crowd_notes' &&
          stillThere.words === 'Two halves of one company in one room. Still typing',
          `cursor in ${stillThere.focused || 'nothing'}, box reads ${JSON.stringify(stillThere.words)}`);

    // ---- a refresh mid-form brings the draft back -----------------------
    await gotoSection(page, 2);
    await writeAnswer(page, 'crowd_notes', 'Typed and not yet sent.');
    await page.navigate(`${base}/c`);                  // straight back in, no save
    await page.waitFor("document.querySelector('.view')");
    await watchFetch(page);
    await gotoSection(page, 2);
    const backAgain = await page.evaluate("document.querySelector('#f_crowd_notes').value");
    check(`${tag} · a refresh in the middle of the form brings the answers back`,
          backAgain === 'Typed and not yet sent.', JSON.stringify(backAgain));
    await waitStatus(page, 'Saved · revision');

    // ---- the awards questions come and go without losing words ----------
    await gotoSection(page, 4);                        // The moments
    const awardsOn = async () => page.evaluate(`(() => {
      const node = [...document.querySelectorAll('#f_moments .chip')]
        .find(b => b.textContent.trim().toLowerCase() === 'awards');
      return node ? node.getAttribute('aria-pressed') === 'true' : null;
    })()`);
    if (!(await awardsOn())) { await pressWords(page, 'Awards'); await sleep(200); }
    await writeAnswer(page, 'awards_pronunciation', 'Siobhan - shi-VAWN');
    await pressWords(page, 'Awards');                  // off
    await sleep(200);
    const hidden = await page.evaluate("!document.querySelector('#f_awards_pronunciation')");
    await pressWords(page, 'Awards');                  // and on again
    await sleep(250);
    const kept = await page.evaluate("(document.querySelector('#f_awards_pronunciation')||{}).value");
    check(`${tag} · turning the awards off and on keeps what was typed for them`,
          hidden && kept === 'Siobhan - shi-VAWN', `hidden while off: ${hidden}, back as ${JSON.stringify(kept)}`);
    await screen(page, `${tag}-moments`, width);

    // ---- review -----------------------------------------------------------
    await gotoSection(page, 5);
    await page.click('#nextbtn');                      // Review answers
    await sleep(300);
    const review = await page.evaluate("document.getElementById('main').innerText");
    check(`${tag} · the review names the answers left open`,
          review.includes('These become questions we work out together'), '');
    await screen(page, `${tag}-review`, width);
    await keyboardWalk(page, tag);

    // ---- sending with something missing -----------------------------------
    // The door decides what is missing, and its words go beside the field.
    await pressWords(page, 'Back to the form');
    await sleep(200);
    await gotoSection(page, 5);
    await clearState(page, 'approver_name');
    await clearField(page, '#f_approver_name');
    await sleep(200);
    await page.click('#nextbtn');                      // Review answers
    await sleep(300);
    await pressWords(page, 'Send');
    await page.waitFor("!!document.querySelector('.q.bad .err')",
                       { seconds: 15, what: 'the missing answer to be named' });
    const named = await page.evaluate(`(() => {
      const bad = document.querySelector('.q.bad');
      return {words: bad.querySelector('.err').textContent,
              beside: bad.querySelector('.qlabel').textContent.trim(),
              focused: document.activeElement.id};
    })()`);
    check(`${tag} · sending without a needed answer says which one, beside it`,
          named.words.length > 0 && named.beside.indexOf('final yes') >= 0 &&
          named.focused === 'f_approver_name',
          `"${named.words}" beside "${named.beside}", the screen put the cursor in ${named.focused || 'nothing'}`);
    await screen(page, `${tag}-missing`, width);
    await writeAnswer(page, 'approver_name', 'Dana Whitfield');
    await page.click('#nextbtn');
    await sleep(300);

    // ---- send -------------------------------------------------------------
    const beforeSend = (await door(base, approver.token, `/api/events/${eventId}`)).data.revision;
    await pressWords(page, 'Send');
    await page.waitFor("document.getElementById('main').innerText.indexOf('thank you') >= 0",
                       { seconds: 15, what: 'the receipt' });
    const receipt = await page.evaluate("document.getElementById('main').innerText");
    const afterSend = (await door(base, approver.token, `/api/events/${eventId}`)).data;
    check(`${tag} · sending gives a receipt with the event's name and revision on it`,
          receipt.includes('Saved as revision ' + afterSend.revision) && receipt.includes(afterSend.answers.event_name.value),
          `revision ${beforeSend} to ${afterSend.revision}`);
    check(`${tag} · sending marks the event as sent`, !!afterSend.submitted_at, String(afterSend.submitted_at));
    await screen(page, `${tag}-receipt`, width);

    // ---- the brief --------------------------------------------------------
    await pressWords(page, 'See your event brief');
    await page.waitFor("document.getElementById('main').innerText.indexOf('order of the night') >= 0",
                       { seconds: 12, what: 'the brief' });
    const brief = await page.evaluate("document.getElementById('main').innerText");
    const briefDoor = await door(base, approver.token, `/api/events/${eventId}/brief`);
    const mineOpen = briefDoor.data.open_items.length;
    check(`${tag} · the brief shows the running order and the questions this person owns`,
          brief.includes('Your open questions') &&
          (mineOpen === 0 ? brief.includes('Nothing is waiting on you') : brief.includes(briefDoor.data.open_items[0].question)),
          `${mineOpen} open for the ${me.data.role}`);
    const place = afterSend.tz.split('/').pop().split('_').join(' ');
    check(`${tag} · the brief says which clock its times are on`,
          brief.includes('the clock in ' + place), `${afterSend.tz} reads as "${place}"`);
    check(`${tag} · nothing private reaches the page`,
          !brief.includes('do not show the client') && !JSON.stringify(briefDoor.data).includes('dj_notes'),
          'no private note, no other people\'s numbers');
    await screen(page, `${tag}-brief`, width);

    // ---- the server goes away in the middle of an answer ------------------
    await pressWords(page, 'Back to your answers');
    await sleep(200);
    await pressWords(page, 'Back to the form');
    await sleep(200);
    await gotoSection(page, 2);
    const revisionBeforeOffline = (await door(base, approver.token, `/api/events/${eventId}`)).data.revision;
    if (shared) {
      await page.evaluate(`(() => {
        const live = window.fetch;
        let cut = false;
        window.fetch = function (url, options) {
          if (!cut && String(url).endsWith('/save')) {
            cut = true;
            let body = null;
            try { body = JSON.parse(options.body); } catch (e) {}
            window.__sent.push({url: String(url), method: 'POST', body: body, status: -1});
            return Promise.reject(new Error('practice line down'));
          }
          return live.apply(this, arguments);
        };
        return true;
      })()`);
    } else {
      await stopServer(server);
      server = null;
    }
    await writeAnswer(page, 'crowd_notes', 'Typed while the line was down.');
    await waitStatus(page, 'Saved on this device only', 12);
    const offlineWords = await statusLine(page);
    check(`${tag} · with the line down the page says the answers are only on this device`,
          offlineWords.includes('Saved on this device only — not yet sent to Savvy Sounds'),
          JSON.stringify(offlineWords.trim()));

    if (!shared) server = await startServer(port, data);
    await pressWords(page, 'Retry');
    await waitStatus(page, 'Saved · revision', 15);
    const afterRetry = (await door(base, approver.token, `/api/events/${eventId}`)).data;
    check(`${tag} · one Retry, one save, one revision`,
          afterRetry.revision === revisionBeforeOffline + 1 &&
          afterRetry.answers.crowd_notes.value === 'Typed while the line was down.',
          `revision ${revisionBeforeOffline} to ${afterRetry.revision}`);

    const posted = (await sent(page)).filter((s) => s.url.endsWith('/save'));
    const failedOne = posted[posted.length - 2];
    const retryOne = posted[posted.length - 1];
    check(`${tag} · Retry sends the same attempt, so nothing can land twice`,
          failedOne && retryOne && failedOne.body.submission_id === retryOne.body.submission_id,
          retryOne ? retryOne.body.submission_id : 'nothing was sent');

    // the same attempt twice at the door: one receipt, one revision
    const again = await door(base, approver.token, `/api/events/${eventId}/save`,
      { base_revision: afterRetry.revision, submission_id: retryOne.body.submission_id,
        submit: false, answers: { crowd_notes: { value: 'a different thing', state: 'confirmed' } } });
    const afterAgain = (await door(base, approver.token, `/api/events/${eventId}`)).data;
    check(`${tag} · the same attempt sent twice gives the same receipt and no second revision`,
          again.status === 200 && again.data.duplicate === true &&
          afterAgain.revision === afterRetry.revision,
          `duplicate=${again.data && again.data.duplicate}, revision still ${afterAgain.revision}`);

    // ---- two people, one answer ------------------------------------------
    // Miles changes the same answer while this page is holding an older
    // revision.  The next save has to stop and ask, never overwrite.
    await door(base, djPass, `/api/events/${eventId}/save`,
      { base_revision: afterAgain.revision, submission_id: 'sub_walk_miles_' + Date.now(),
        submit: false, answers: { crowd_notes: { value: "Miles's own note about this room.", state: 'confirmed' } } });
    await writeAnswer(page, 'crowd_notes', 'The answer this page was typing.');
    let clash = '';
    try {
      // The heading is drawn in capitals, so read it the way it is drawn.
      await page.waitFor("document.getElementById('main').innerText.toUpperCase().indexOf('TWO ANSWERS') >= 0",
                         { seconds: 15, what: 'the two-answers screen' });
      clash = await page.evaluate("document.getElementById('main').innerText");
    } catch (never) {
      const last = (await sent(page)).filter((s) => s.url.endsWith('/save')).pop();
      clash = 'no two-answers screen. status line: ' + (await statusLine(page)).trim() +
              ' — the door answered ' + (last && last.status) + ', on screen: ' +
              (await page.evaluate("document.getElementById('main').innerText")).replace(/\n+/g, ' | ').slice(0, 160);
    }
    check(`${tag} · when two people change one answer the page shows both, side by side`,
          clash.includes('The answer this page was typing.') &&
          clash.includes("Miles's own note about this room.") && clash.includes('Miles changed it'),
          clash.replace(/\n+/g, ' | ').slice(0, 170));
    await screen(page, `${tag}-two-answers`, width);

    if (keepMine) {
      await pressWords(page, 'Keep mine');
    } else {
      await pressWords(page, "Take Miles's");
    }
    await pressWords(page, 'Send again');
    await waitStatus(page, 'Saved · revision', 15);
    const settled = (await door(base, approver.token, `/api/events/${eventId}`)).data;
    const wantedValue = keepMine ? 'The answer this page was typing.' : "Miles's own note about this room.";
    check(`${tag} · the answer they picked is the one that is written`,
          settled.answers.crowd_notes.value === wantedValue,
          `${keepMine ? 'kept their own' : "took Miles's"}: ${JSON.stringify(settled.answers.crowd_notes.value)}`);
    check(`${tag} · settling it moves the event on by one revision`,
          settled.revision > afterAgain.revision, `revision ${afterAgain.revision} to ${settled.revision}`);

    // ---- a link that does not work ---------------------------------------
    await page.navigate(`${base}/c/00000000000000000000000000000000`);
    await page.waitFor("document.getElementById('main').innerText.indexOf('link') >= 0",
                       { seconds: 10, what: 'the words about the link' });
    const refused = await page.evaluate("document.getElementById('main').innerText");
    check(`${tag} · a link that has run out says so in plain words and shows nothing else`,
          refused.includes('This link has expired — ask Miles for a fresh one.') &&
          !refused.includes('Continue') && !refused.includes('Send'),
          refused.replace(/\n+/g, ' ').trim());
    await screen(page, `${tag}-expired`, width);

    await page.close();
    page = null;

    // ---- the person who settles the running order -------------------------
    // Somebody suggests a new time for a part of the night; only the person
    // whose decision it is sees the two answers and picks one.
    const planner = wanted.people.find((p) => p.role === 'planner');
    if (planner) {
      const awards = (await door(base, approver.token, `/api/events/${eventId}`)).data
        .moments.find((m) => m.kind === 'awards');
      const suggested = {moment_id: awards.moment_id, kind: awards.kind,
                         approval: awards.approval, start: '20:30', end: '21:30'};
      const put = await door(base, approver.token, `/api/events/${eventId}/save`,
        { base_revision: (await door(base, approver.token, `/api/events/${eventId}`)).data.revision,
          submission_id: 'sub_walk_suggest_' + Date.now(), submit: false, moments: [suggested] });
      check(`${tag} · a suggestion from somebody who does not own the time waits, it does not land`,
            put.status === 200 && (put.data.proposed || []).indexOf(`moments.${awards.moment_id}.start`) >= 0,
            `waiting on the planner: ${JSON.stringify(put.data.proposed)}`);

      const theirs = await launch({ width, height, scratch: process.env.CORP_WALK_SCRATCH || undefined });
      try {
        await theirs.open(`${base}/c/${planner.token}`);
        await theirs.waitFor("document.querySelector('.view')");
        await pressWords(theirs, 'See your event brief');
        await theirs.waitFor("document.getElementById('main').innerText.indexOf('Two answers to settle') >= 0",
                             { seconds: 12, what: 'the settle block' });
        const shown = await theirs.evaluate("document.getElementById('main').innerText");
        check(`${tag} · the planner is shown both times and who asked for the change`,
              shown.includes('8:00 PM') && shown.includes('8:30 PM') &&
              shown.includes(approver.name.split(' ')[0]),
              shown.split('\n').filter(Boolean).slice(0, 8).join(' / ').slice(0, 150));
        await theirs.evaluate("document.querySelector('.conflict').scrollIntoView({block: 'center'})");
        await screen390(theirs, `${tag}-settle`, width);

        // an open question with nothing written in it must say so
        const items = (await door(base, planner.token, `/api/events/${eventId}/brief`)).data.open_items;
        check(`${tag} · the planner is asked only what is theirs`, items.length > 0,
              `${items.length} open questions owned by the planner`);
        await pressWords(theirs, 'Send this answer');
        await theirs.waitFor("!!document.querySelector('.err')", { seconds: 6, what: 'the empty-box words' });
        const nagged = await theirs.evaluate("document.querySelector('.err').textContent");
        check(`${tag} · sending an empty answer says what is missing`,
              nagged.indexOf('Write your answer first') >= 0, JSON.stringify(nagged));

        const beforeItem = (await door(base, planner.token, `/api/events/${eventId}`)).data.revision;
        await theirs.click('#oi_' + items[0].item_id);
        await theirs.type('Jules calls it from the stage left wing.');
        await pressWords(theirs, 'Send this answer');
        await theirs.waitFor(`(() => {
          const now = ${JSON.stringify(items[0].item_id)};
          return !document.getElementById('oi_' + now);
        })()`, { seconds: 12, what: 'the answered question to close' });
        const afterItem = (await door(base, planner.token, `/api/events/${eventId}`)).data;
        const closed = afterItem.open_items.find((i) => i.item_id === items[0].item_id);
        check(`${tag} · an answered question closes and the answer is kept`,
              closed.resolved === true && afterItem.revision === beforeItem + 1,
              `revision ${beforeItem} to ${afterItem.revision}, ${items[0].item_id} answered`);

        // and the time they pick is the time that is written
        await pressWords(theirs, `Take ${approver.name.split(' ')[0]}'s`);
        await theirs.waitFor(`document.getElementById('main').innerText.indexOf('Two answers to settle') < 0`,
                             { seconds: 12, what: 'the settled block to go' });
        const settledTime = (await door(base, planner.token, `/api/events/${eventId}`)).data
          .moments.find((m) => m.kind === 'awards');
        check(`${tag} · every part of the change they took is written, not just the first`,
              settledTime.start === '20:30' && settledTime.end === '21:30' && !settledTime.proposal,
              `awards now run ${settledTime.start} to ${settledTime.end}`);
      } finally {
        await theirs.close();
      }
    }

    // ---- with motion turned down, in a Chrome of its own ------------------
    // (a key sent through the devtools protocol can stop a Chrome answering
    //  media questions at all, so the keyboard walk never shares this one)
    const still = await launch({ width, height, scratch: process.env.CORP_WALK_SCRATCH || undefined });
    try {
      await still.media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await still.open(`${base}/c/${approver.token}`);
      await still.waitFor("document.querySelector('.view')");
      const asked = await still.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches");
      const straightaway = await still.evaluate(`(() => {
        const view = document.querySelector('.view');
        const style = getComputedStyle(view);
        return {opacity: style.opacity, transform: style.transform,
                running: document.getAnimations().filter(a => a.playState === 'running').length};
      })()`);
      check(`${tag} · with motion turned down the screen arrives finished, not sliding`,
            asked && straightaway.opacity === '1' &&
            (straightaway.transform === 'none' || straightaway.transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
            straightaway.running === 0,
            `asked=${asked} opacity=${straightaway.opacity} transform=${straightaway.transform} moving=${straightaway.running}`);
      await still.shot(join(FRAMES, `client-${tag}-still.png`));
    } finally {
      await still.close();
    }
  } finally {
    if (page) await page.close();
    await stopServer(server);
    if (!shared) await rm(data, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(FRAMES, { recursive: true });
  const plan = [
    { fixture: 'harbor', width: 390, height: 844, keepMine: true },
    { fixture: 'harbor', width: 1440, height: 900, keepMine: false },
    { fixture: 'northstar', width: 390, height: 844, keepMine: false },
    { fixture: 'northstar', width: 1440, height: 900, keepMine: true }
  ];
  const only = process.env.CORP_WALK_ONLY;
  for (const leg of plan.filter((l) => !only || `${l.fixture}-${l.width}` === only)) {
    console.log(`\n--- ${leg.fixture} at ${leg.width} ---`);
    try {
      await walk(leg);
    } catch (problem) {
      check(`${leg.fixture}-${leg.width} · the walk finished`, false, String(problem.message || problem));
    }
  }
  const leftBehind = await stopEverything();
  check('the walk leaves nothing of its own running', leftBehind === 0,
        leftBehind ? `${leftBehind} server(s) still up` : 'every server it started is stopped');

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length} of ${results.length} checks passed.`);
  if (bad.length) {
    console.log('Red:');
    bad.forEach((r) => console.log('  ' + r.name + (r.detail ? '  — ' + r.detail : '')));
  }
  console.log(`Frames in ${FRAMES}`);
  process.exit(bad.length ? 1 : 0);
}

main();
