import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const bench = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corporate = join(bench, 'corporate');
const port = Number(process.env.CORP_TEST_PORT || 8795);
if (port === 8790) throw new Error('CORP_TEST_PORT must not be 8790. Choose a private test port.');

function request(portNumber, path, options = {}) {
  return new Promise((resolveReply, reject) => {
    const req = http.request({host: '127.0.0.1', port: portNumber, path, method: options.method || 'GET', headers: {Host: `127.0.0.1:${portNumber}`, ...(options.headers || {})}}, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => resolveReply({status: response.statusCode, headers: response.headers, text: Buffer.concat(parts).toString('utf8')}));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('bundle output loads through the project loader and defines doPost', async () => {
  const built = spawnSync(process.execPath, ['corporate/script/bundle.mjs'], {cwd: bench, encoding: 'utf8'});
  assert.equal(built.status, 0, built.stderr);
  const marker = 'const QUESTIONS = ';
  const split = built.stdout.lastIndexOf(marker);
  assert.ok(split > 0);
  const scratch = join(corporate, 'data', 'tests', `bundle-${randomUUID()}`);
  const script = join(scratch, 'script');
  mkdirSync(script, {recursive: true});
  try {
    writeFileSync(join(script, 'bundle.gs'), built.stdout.slice(0, split), 'utf8');
    writeFileSync(join(scratch, 'questions.json'), readFileSync(join(corporate, 'questions.json')));
    writeFileSync(join(script, 'load.mjs'), readFileSync(join(corporate, 'script', 'load.mjs')));
    const {load} = await import(`${pathToFileURL(join(script, 'load.mjs')).href}?${randomUUID()}`);
    const g = load({drive: join(scratch, 'drive')});
    assert.equal(typeof g.doPost, 'function');
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
});

test('stand-in matches the two-listener Google hop', async (t) => {
  const drive = join(corporate, 'data', 'tests', `standin-${randomUUID()}`);
  const child = spawn(process.execPath, ['corporate/script/standin.mjs'], {
    cwd: bench,
    env: {...process.env, CORP_PORT: String(port), CORP_DATA: drive},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (part) => { output += part; });
  child.stderr.on('data', (part) => { errors += part; });
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('stand-in did not open both listeners')), 5000);
    child.stdout.on('data', () => {
      if (output.trim().split('\n').length >= 2) { clearTimeout(timer); resolveReady(true); }
    });
    child.on('exit', (code) => { clearTimeout(timer); resolveReady(code); });
  });
  // Only Codex's seatbelt may skip this (it cannot open a port and says so);
  // anywhere else a port that will not open is a RED check, never a skip.
  if (ready !== true && /EACCES|EPERM/.test(errors) && process.env.CODEX_SANDBOX_NETWORK_DISABLED) {
    rmSync(drive, {recursive: true, force: true});
    t.skip('HTTP checks not run here — needs a port');
    return;
  }
  assert.equal(ready, true, errors || `stand-in exited ${ready}`);
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((done) => child.once('exit', done));
    }
    rmSync(drive, {recursive: true, force: true});
  });

  assert.equal((await request(port, '/', {headers: {Host: 'foreign.example'}})).status, 421);
  assert.equal((await request(port + 3, '/', {headers: {Host: 'foreign.example'}})).status, 421);
  assert.equal((await request(port, '/corporate/client/')).status, 200);
  assert.equal((await request(port, '/corporate/../CONTRACT.md')).status, 404);
  const home = await request(port, '/corporate/home.js');
  assert.equal(home.status, 200);
  assert.match(home.text, new RegExp(`127\\.0\\.0\\.1:${port + 3}/macros/s/local/exec`));

  const post = await request(port + 3, '/macros/s/local/exec', {method: 'POST', body: JSON.stringify({door: '/api/me', token: 'x'})});
  assert.equal(post.status, 302);
  const echo = await request(port + 3, post.headers.location);
  assert.equal(echo.status, 200);
  assert.equal(echo.headers['access-control-allow-origin'], '*');
  assert.equal(JSON.parse(echo.text).status, 403);
  assert.equal((await request(port + 3, post.headers.location)).status, 404);
  const get = await request(port + 3, '/macros/s/local/exec');
  assert.equal(get.status, 200);
  assert.equal(get.text, 'This is the prep home. There is nothing to see here; your link opens the page.');
});
