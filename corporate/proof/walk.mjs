/* One headless soundcheck for both screens and the Stage 1 handoff. */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(HERE);
const BENCH = dirname(CORPORATE);
const FRAMES = join(HERE, 'frames');
const PORT = 8794;
const scratch = mkdtempSync(join(tmpdir(), 'corp-gate-'));
const data = join(scratch, 'store');
const chromeScratch = join(scratch, 'chrome');
mkdirSync(data, { recursive: true });
mkdirSync(chromeScratch, { recursive: true });
mkdirSync(FRAMES, { recursive: true });

let server = null;
let failed = 0;
const children = new Set();
const pages = new Set();

function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}\n`);
}

function run(cmd, args, env = {}, inherit = false) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, {
      cwd: BENCH, env: { ...process.env, ...env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    children.add(child);
    let out = '', err = '';
    if (!inherit) {
      child.stdout.on('data', (part) => { out += part; });
      child.stderr.on('data', (part) => { err += part; });
    }
    child.on('close', (code) => {
      children.delete(child);
      code === 0 ? done(out) : fail(new Error(err || out || `${cmd} exited ${code}`));
    });
  });
}

async function seed() {
  return run('python3', ['corporate/seed.py'], { CORP_DATA: data });
}

async function waitForServer() {
  for (let tries = 0; tries < 100; tries += 1) {
    try {
      const reply = await fetch(`http://127.0.0.1:${PORT}/api/me`);
      if (reply.status) return;
    } catch { await sleep(100); }
  }
  throw new Error(`server never answered on ${PORT}`);
}

async function childWalk(script, extra = {}) {
  try {
    await run('node', [`corporate/proof/${script}`], {
      CORP_PORT: String(PORT), CORP_DATA: data, CORP_SHARED_SERVER: '1',
      CORP_WALK_SCRATCH: chromeScratch, ...extra
    }, true);
    check(`${script} finished against the shared server`, true, `port ${PORT}`);
  } catch (problem) {
    check(`${script} finished against the shared server`, false, String(problem.message || problem));
  }
}

const nameOf = (event) => ((event.answers || {}).event_name || {}).value || '';

function seededState() {
  const access = JSON.parse(readFileSync(join(data, 'access.json'), 'utf8'));
  const grants = Object.entries(access.tokens);
  const tokenFor = (person) => (grants.find(([, grant]) => grant.person_id === person) || [])[0];
  const events = readdirSync(join(data, 'events')).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(data, 'events', name), 'utf8')));
  return {
    access, tokenFor,
    northstar: events.find((event) => nameOf(event).includes('Northstar')),
    harbor: events.find((event) => nameOf(event).includes('Harbor'))
  };
}

async function door(token, path, body, text = false) {
  const options = { method: body ? 'POST' : 'GET', headers: { 'X-Access-Token': token } };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const reply = await fetch(`http://127.0.0.1:${PORT}${path}`, options);
  return { status: reply.status, data: text ? await reply.text() : await reply.json() };
}

async function clickWords(page, words, starts = false) {
  const id = await page.evaluate(`(() => {
    const words = ${JSON.stringify(words)};
    const node = [...document.querySelectorAll('button')].find((button) =>
      ${starts ? 'button.textContent.trim().startsWith(words)' : 'button.textContent.trim() === words'});
    if (!node) return '';
    node.id = node.id || 'gate_' + Math.random().toString(16).slice(2);
    return node.id;
  })()`);
  if (!id) throw new Error(`no button says ${words}`);
  await page.click('#' + id);
}

async function newPage(width, height) {
  const page = await launch({ width, height, scratch: chromeScratch });
  pages.add(page);
  return page;
}

async function closePage(page) {
  await page.close();
  pages.delete(page);
}

async function openPlanner(width, token, eventId, change) {
  const page = await newPage(width, width === 390 ? 844 : 900);
  try {
    await page.open(`http://127.0.0.1:${PORT}/c/${token}`);
    await page.waitFor("document.querySelector('.view')", { what: 'the planner page' });
    if (change) {
      await page.evaluate(`(() => {
        window.__gateSaves = [];
        const live = window.fetch;
        window.fetch = function (url, options) {
          const answer = live.apply(this, arguments);
          if (String(url).endsWith('/save')) answer.then((reply) => reply.clone().json()
            .then((data) => window.__gateSaves.push({status: reply.status, data})).catch(() => {}));
          return answer;
        };
        return true;
      })()`);
      await clickWords(page, 'Review answers');
      const edit = await page.evaluate(`(() => {
        const card = [...document.querySelectorAll('section.card')]
          .find((one) => (one.querySelector('h2') || {}).textContent === 'The moments');
        const button = card && card.querySelector('button');
        if (!button) return '';
        button.id = 'gate_moments_edit'; return button.id;
      })()`);
      if (!edit) throw new Error('the planner page has no running-order editor');
      await page.click('#' + edit);
      await page.waitFor("document.getElementById('m_awards_start')", { what: 'the awards start box' });
      // A time box is segmented (hours / minutes / AM-PM) and does not take typed
      // digits reliably through the debugging port, so the walk sets the value the
      // way a picker would and fires the same input + change events the page listens to.
      await page.evaluate(`(() => {
        const box = document.getElementById('m_awards_start');
        box.focus(); box.value = '20:15';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        return box.value;
      })()`);
      await page.key('Tab');
      await page.waitFor("document.getElementById('m_awards_start').value === '20:15'",
                         { what: 'the planner to set 20:15' });
      await page.waitFor("window.__gateSaves.some((one) => one.status === 200)",
                         { seconds: 12, what: 'the planner save' });
      const saved = await page.evaluate("window.__gateSaves.find((one) => one.status === 200)");
      check(`planner save at ${width}px answered 200`, saved.status === 200,
            `revision ${saved.data.revision}`);
      check(`planner save named the changed cue`,
            saved.data.effects.cues_to_recheck.includes('m_awards'),
            saved.data.effects.cues_to_recheck.join(', ') || 'none');
      check(`planner save opened the new questions`,
            saved.data.effects.open_items_added.length >= 2,
            `${saved.data.effects.open_items_added.length} open items`);
    } else {
      await clickWords(page, 'Review answers');
      const text = await page.evaluate("document.getElementById('main').innerText");
      check(`planner view at ${width}px reads the new time`, text.includes('8:15 PM') || text.includes('20:15'), '8:15 PM');
    }
    await page.shot(join(FRAMES, `gate-planner-${width}.png`));
    const revision = (await door(token, `/api/events/${eventId}`)).data.revision;
    return revision;
  } finally { await closePage(page); }
}

async function openMiles(width, pass, eventId, resolveProposal) {
  const page = await newPage(width, width === 390 ? 844 : 900);
  try {
    await page.open(`http://127.0.0.1:${PORT}/dj/`);
    await page.click('#pass');
    await page.type(pass);
    await clickWords(page, 'Open my events');
    await page.waitFor("document.querySelector('.event-open')", { what: 'Miles event list' });
    const overview = await door(pass, '/api/events');
    const row = overview.data.find((event) => event.event_id === eventId);
    check(`Miles sees the planner change as unseen at ${width}px`, row.changed_since_seen > 0,
          `${row.changed_since_seen} changes`);
    const opener = await page.evaluate(`(() => {
      const node = [...document.querySelectorAll('.event-open')]
        .find((button) => button.textContent.includes('Northstar'));
      if (!node) return ''; node.id = 'gate_northstar'; return node.id;
    })()`);
    if (!opener) throw new Error('Northstar is not on Miles’s page');
    await page.click('#' + opener);
    await page.waitFor("document.querySelectorAll('section.block').length > 3", { what: 'the event view' });
    const shown = await page.evaluate('document.body.innerText');
    check(`Miles sees both times and Jules at ${width}px`,
          shown.includes('20:00') && shown.includes('20:15') && shown.includes('Jules'),
          '20:00 / 20:15 / Jules');
    if (resolveProposal) {
      await clickWords(page, 'Take Jules', true);
      await page.waitFor("document.body.innerText.includes('Taken.')", { what: 'the proposal receipt' });
      await page.waitFor("document.body.innerText.includes('20:15–21:00')", { what: 'the settled running order' });
      const event = (await door(pass, `/api/events/${eventId}`)).data;
      const awards = event.moments.find((moment) => moment.moment_id === 'm_awards');
      check('Miles took Jules’s 20:15', awards.start === '20:15' && awards.proposal === null,
            `revision ${event.revision}, ${awards.start}`);
    }
    await page.shot(join(FRAMES, `gate-miles-${width}.png`));
    return (await door(pass, `/api/events/${eventId}`)).data.revision;
  } finally { await closePage(page); }
}

function unsafeCsvCell(csv) {
  return csv.split(/\r?\n/).some((line) => line.split(',').some((cell) => {
    const value = cell.startsWith('"') ? cell.slice(1) : cell;
    return /^[=+\-@\t\r]/.test(value);
  }));
}

async function approverAndExports(token, pass, eventId) {
  const page = await newPage(390, 844);
  try {
    await page.open(`http://127.0.0.1:${PORT}/c/${token}`);
    await page.waitFor("document.querySelector('.view')", { what: 'Theo’s page' });
    await clickWords(page, 'See your event brief');
    await page.waitFor("document.body.innerText.toLowerCase().includes('your event brief')", { what: 'Theo’s brief' });
    const brief = (await door(token, `/api/events/${eventId}/brief`)).data;
    const shown = await page.evaluate('document.body.innerText');
    check('Theo’s brief carries 20:15', shown.includes('8:15 PM') || shown.includes('20:15'), `8:15 PM, revision ${brief.header.revision}`);
    check('Theo’s brief names questions owned by his role',
          brief.open_items.length > 0 && brief.open_items.every((item) => item.owner === 'approver'),
          `${brief.open_items.length} approver questions`);
    await page.shot(join(FRAMES, 'gate-theo-390.png'));
  } finally { await closePage(page); }

  const event = (await door(pass, `/api/events/${eventId}`)).data;
  const sheet = await door(pass, `/api/events/${eventId}/daysheet`, null, true);
  const csv = await door(pass, `/api/events/${eventId}/daysheet.csv`, null, true);
  check('day sheet matches the event revision and time',
        sheet.status === 200 && sheet.data.includes(`revision ${event.revision}`) && sheet.data.includes('20:15'),
        `revision ${event.revision}, 20:15`);
  check('CSV has no formula-starting cell', csv.status === 200 && !unsafeCsvCell(csv.data), '0 unsafe cells');
  return event.revision;
}

async function harborReceipt(token, eventId) {
  const page = await newPage(390, 844);
  try {
    await page.open(`http://127.0.0.1:${PORT}/c/${token}`);
    await page.waitFor("document.querySelector('.view')", { what: 'Harbor form' });
    await clickWords(page, 'Continue');
    for (let guard = 0; guard < 12; guard += 1) {
      const words = await page.evaluate("document.getElementById('nextbtn').textContent.trim()");
      await page.click('#nextbtn');
      if (words === 'Review answers') break;
    }
    await page.waitFor("document.getElementById('nextbtn').textContent.trim() === 'Send'",
                       { what: 'Harbor review' });
    await page.click('#nextbtn');
    await page.waitFor("document.body.innerText.toLowerCase().includes('saved as revision')", { what: 'Harbor receipt' });
    const receipt = await page.evaluate('document.body.innerText');
    const event = (await door(token, `/api/events/${eventId}`)).data;
    check('Harbor phone form shows its matching receipt',
          receipt.toLowerCase().includes('harbor studio networking') && receipt.toLowerCase().includes(`revision ${event.revision}`),
          `revision ${event.revision}`);
    await page.shot(join(FRAMES, 'gate-harbor-receipt-390.png'));
  } finally { await closePage(page); }
}

async function stageGate() {
  await seed();
  const state = seededState();
  const planner = state.tokenFor('p_jules');
  const theo = state.tokenFor('p_theo');
  const harborApprover = state.tokenFor('p_dana');
  const pass = state.access.dj_token;
  const eventId = state.northstar.event_id;

  await openPlanner(390, planner, eventId, true);
  await openPlanner(1440, planner, eventId, false);

  const changed = (await door(pass, `/api/events/${eventId}`)).data;
  await door(pass, `/api/events/${eventId}/save`, {
    base_revision: changed.revision, submission_id: 'sub_gate_restore', submit: false,
    moments: [{ moment_id: 'm_awards', start: '20:00' }]
  });
  await openMiles(390, pass, eventId, false);
  const milesRevision = await openMiles(1440, pass, eventId, true);
  const sheetRevision = await approverAndExports(theo, pass, eventId);
  const plannerRevision = (await door(planner, `/api/events/${eventId}`)).data.revision;
  const approverRevision = (await door(theo, `/api/events/${eventId}`)).data.revision;
  check('planner, Miles, and approver agree on the revision',
        plannerRevision === milesRevision && milesRevision === approverRevision && approverRevision === sheetRevision,
        `${plannerRevision} / ${milesRevision} / ${approverRevision}`);
  await harborReceipt(harborApprover, state.harbor.event_id);
}

function stop() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  if (server && server.exitCode === null) server.kill('SIGTERM');
}

async function cleanUp() {
  for (const page of [...pages]) await closePage(page);
  stop();
  await sleep(300);
  rmSync(scratch, { recursive: true, force: true });
}

async function main() {
  process.on('exit', stop);
  process.on('SIGINT', () => { cleanUp().finally(() => process.exit(130)); });
  process.on('SIGTERM', () => { cleanUp().finally(() => process.exit(143)); });
  try {
    await seed();
    server = spawn('python3', ['corporate/server.py'], {
      cwd: BENCH, env: { ...process.env, CORP_PORT: String(PORT), CORP_DATA: data },
      stdio: 'ignore'
    });
    await waitForServer();
    if (!process.env.CORP_GATE_ONLY) {   // CORP_GATE_ONLY=1 reruns only the gate while fixing it
      await childWalk('walk-client.mjs', { CORP_WALK_ONLY: 'harbor-390' });
      await childWalk('walk-dj.mjs');
    }
    await stageGate();
  } catch (problem) {
    check('the full soundcheck finished', false, String(problem.message || problem));
  } finally {
    await cleanUp();
  }
  process.stdout.write(`\n${failed ? 'SOMETHING IS RED' : 'All soundcheck readings passed'} — ${failed} failed.\n`);
  process.exitCode = failed ? 1 : 0;
}

main();
