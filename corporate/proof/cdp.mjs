/* A headless Chrome on a string.
 *
 * Node 24's own WebSocket, nothing installed.  One launcher owns the flags so
 * no run of this can ever ask the Mac for a keychain password, make a sound or
 * take the screen: Miles is at the keyboard while these run.
 *
 *   import { launch } from './cdp.mjs';
 *   const page = await launch({ width: 390, height: 844, scratch });
 *   await page.open('http://127.0.0.1:8792/corporate/client/#<token>');   // first load thrown away
 *   await page.click('#nextbtn');
 *   await page.shot(framesDir + '/client-start.png');
 *   await page.close();
 *
 * Keys go through the devtools protocol with `code` and
 * `windowsVirtualKeyCode` filled in.  A key event without them activates
 * nothing in Chrome, so a walk that sends them proves the harness, not the
 * screen.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VK = {
  Tab: 9, Enter: 13, Shift: 16, Escape: 27, Space: 32, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Backspace: 8, Delete: 46
};

function keyBits(name) {
  if (name === 'Space') return { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' };
  if (/^[a-z]$/i.test(name)) {
    const upper = name.toUpperCase();
    return { key: name, code: 'Key' + upper, windowsVirtualKeyCode: upper.charCodeAt(0) };
  }
  return { key: name, code: name, windowsVirtualKeyCode: VK[name] || 0 };
}

/* A character's own key code.  Guessing one from the character code is how a
   typed full stop arrives as the Delete key (46) and eats itself: punctuation
   that is not in the table goes out with no key code at all, which still
   inserts the text and can never be mistaken for a command. */
const PUNCT = {
  '.': ['Period', 190], ',': ['Comma', 188], '-': ['Minus', 189], '=': ['Equal', 187],
  ';': ['Semicolon', 186], "'": ['Quote', 222], '/': ['Slash', 191], '\\': ['Backslash', 220],
  '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '`': ['Backquote', 192]
};

function charBits(ch) {
  const upper = ch.toUpperCase();
  let code = 'Unidentified';
  let vk = 0;
  if (ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z') { code = 'Key' + upper; vk = upper.charCodeAt(0); }
  else if (ch >= '0' && ch <= '9') { code = 'Digit' + ch; vk = ch.charCodeAt(0); }
  else if (ch === ' ') { code = 'Space'; vk = 32; }
  else if (PUNCT[ch]) { code = PUNCT[ch][0]; vk = PUNCT[ch][1]; }
  return { key: ch, code, windowsVirtualKeyCode: vk, text: ch, unmodifiedText: ch };
}

async function freePort() {
  const net = await import('node:net');
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

async function targetUrl(port, seconds = 20) {
  const until = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < until) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (problem) { last = String(problem); }
    await sleep(120);
  }
  throw new Error(`no devtools page target on ${port} after ${seconds}s ${last}`);
}

export async function launch({ width = 1440, height = 900, scratch } = {}) {
  const home = scratch
    ? join(scratch, `chrome-${process.pid}-${Math.random().toString(16).slice(2, 8)}`)
    : await mkdtemp(join(tmpdir(), 'corp-chrome-'));
  await mkdir(home, { recursive: true });
  const port = await freePort();
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--use-mock-keychain',
    '--password-store=basic',
    `--window-size=${width},${height}`,
    `--user-data-dir=${home}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const ws = new WebSocket(await targetUrl(port));
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true });
    ws.addEventListener('error', () => fail(new Error('devtools socket refused')), { once: true });
  });

  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.addEventListener('message', (message) => {
    const note = JSON.parse(message.data);
    if (note.id && waiting.has(note.id)) {
      const { done, fail } = waiting.get(note.id);
      waiting.delete(note.id);
      if (note.error) fail(new Error(note.error.message));
      else done(note.result);
      return;
    }
    listeners.forEach((fn) => fn(note));
  });

  function send(method, params = {}) {
    const mine = ++id;
    return new Promise((done, fail) => {
      waiting.set(mine, { done, fail });
      ws.send(JSON.stringify({ id: mine, method, params }));
      setTimeout(() => {
        if (waiting.has(mine)) { waiting.delete(mine); fail(new Error(`${method} never answered`)); }
      }, 30000);
    });
  }

  function once(event, seconds = 20) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`${event} never fired`)), seconds * 1000);
      const listener = (note) => {
        if (note.method !== event) return;
        clearTimeout(timer);
        listeners.splice(listeners.indexOf(listener), 1);
        done(note.params);
      };
      listeners.push(listener);
    });
  }

  const problems = [];
  listeners.push((note) => {
    if (note.method === 'Runtime.exceptionThrown') {
      const d = note.params.exceptionDetails;
      problems.push(d.exception?.description || d.text);
    }
    if (note.method === 'Log.entryAdded' && note.params.entry.level === 'error') {
      problems.push(note.params.entry.text);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: width < 700 });

  async function evaluate(expression) {
    const answer = await send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) {
      throw new Error('the page threw: ' +
        (answer.exceptionDetails.exception?.description || answer.exceptionDetails.text));
    }
    return answer.result.value;
  }

  async function navigate(url) {
    // A link that ends in #token is a same-document hop when the page is
    // already open at that address, and Chrome fires no load for it. Leave
    // the page first so every open is a real load.
    if (url.includes('#')) {
      const left = once('Page.loadEventFired');
      await send('Page.navigate', { url: 'about:blank' });
      await left;
    }
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
  }

  const page = {
    port, home, send, evaluate, navigate, once, problems,

    /* The first load of a freshly launched Chrome is taken on a window that
       has not settled.  Throw it away, then assert the world we are about to
       measure in really is the one we asked for. */
    async open(url) {
      await navigate(url);
      await navigate(url);
      const world = await evaluate(
        '({vis: document.visibilityState, w: window.innerWidth, h: window.innerHeight})');
      if (world.vis !== 'visible') throw new Error(`window is ${world.vis}, not visible`);
      if (world.w !== width) throw new Error(`window is ${world.w} wide, asked for ${width}`);
      return world;
    },

    async waitFor(expression, { seconds = 10, what = expression } = {}) {
      const until = Date.now() + seconds * 1000;
      while (Date.now() < until) {
        if (await evaluate(`!!(${expression})`)) return true;
        await sleep(80);
      }
      throw new Error(`waited ${seconds}s for ${what}`);
    },

    async box(selector) {
      return evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return {x: r.x, y: r.y, w: r.width, h: r.height};
      })()`);
    },

    async click(selector) {
      // A mouse event lands in the WINDOW, so the thing has to be in the
      // window first — exactly as a finger would have to scroll to it.
      // (Measurements of where things rest are taken before any of this.)
      await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (node) node.scrollIntoView({block: 'center', behavior: 'instant'});
        return true;
      })()`);
      await sleep(40);
      const at = await page.box(selector);
      if (!at || at.w === 0) throw new Error(`nothing clickable at ${selector}`);
      if (at.y < 0 || at.y + at.h > (await evaluate('window.innerHeight'))) {
        throw new Error(`${selector} is not in the window to be clicked`);
      }
      const x = Math.round(at.x + at.w / 2);
      const y = Math.round(at.y + at.h / 2);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent',
          { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      }
      await sleep(30);
    },

    async focus(selector) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    },

    async type(text) {
      for (const ch of text) {
        const bits = charBits(ch);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...bits });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...bits });
      }
      await sleep(20);
    },

    async key(name, { shift = false, control = false } = {}) {
      const bits = keyBits(name);
      const modifiers = (shift ? 8 : 0) | (control ? 2 : 0);
      await send('Input.dispatchKeyEvent',
        { type: bits.text ? 'keyDown' : 'rawKeyDown', modifiers, ...bits });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...bits });
      await sleep(25);
    },

    async media(features) {
      await send('Emulation.setEmulatedMedia', { features });
    },

    /* Full viewport, always.  A CDP clip re-lays the document out before it
       paints, so a cropped capture is a different page; crop afterwards. */
    async shot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(data, 'base64'));
      return path;
    },

    async close() {
      try { ws.close(); } catch { /* already gone */ }
      child.kill('SIGTERM');
      await sleep(400);
      if (child.exitCode === null) child.kill('SIGKILL');
      await sleep(150);
      // Tidying our own folder must never be what fails a walk.
      try { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
      catch { /* the throwaway folder outlives us; the machine sweeps it */ }
    }
  };
  return page;
}
