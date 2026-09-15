import http from 'node:http';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from './load.mjs';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const port = Number(process.env.CORP_PORT || 8790);
const homePort = port + 3;
const g = load({drive: process.env.CORP_DATA});
const echoes = new Map();
let nextEcho = 1;

const kinds = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function ownHost(request, ownPort) {
  return (request.headers.host || '').trim() === `127.0.0.1:${ownPort}`;
}

function answer(response, status, body = '', headers = {}) {
  const bytes = Buffer.from(body);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': bytes.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(bytes);
}

function pathname(request) {
  try {
    const decoded = decodeURIComponent((request.url || '/').split('?')[0]);
    if (decoded.split('/').includes('..') || decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

function staticFile(request, response) {
  if (!ownHost(request, port)) return answer(response, 421, 'bad host\n', {'Content-Type': 'text/plain; charset=utf-8'});
  if (request.method !== 'GET' && request.method !== 'HEAD') return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8'});
  const name = pathname(request);
  if (name === null) return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8'});
  if (name === '/corporate/home.js') {
    return answer(response, 200, `window.PREP_HOME = "http://127.0.0.1:${homePort}/macros/s/local/exec";\n`, {'Content-Type': kinds['.js']});
  }
  let target = resolve(root, `.${name}`);
  if (target !== root && !target.startsWith(root + sep)) return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8'});
  try {
    if (statSync(target).isDirectory()) target = join(target, 'index.html');
    target = realpathSync(target);
    if (target !== root && !target.startsWith(root + sep)) throw new Error('outside root');
    if (!statSync(target).isFile()) throw new Error('not a file');
    const body = readFileSync(target);
    return answer(response, 200, request.method === 'HEAD' ? '' : body, {'Content-Type': kinds[extname(target).toLowerCase()] || 'application/octet-stream'});
  } catch {
    return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8'});
  }
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const parts = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => resolveBody(Buffer.concat(parts).toString('utf8')));
    request.on('error', reject);
  });
}

async function scriptHome(request, response) {
  if (!ownHost(request, homePort)) return answer(response, 421, 'bad host\n', {'Content-Type': 'text/plain; charset=utf-8'});
  const url = new URL(request.url || '/', `http://127.0.0.1:${homePort}`);
  if (request.method === 'POST' && url.pathname === '/macros/s/local/exec') {
    try {
      const output = g.doPost({postData: {contents: await readBody(request), type: 'text/plain'}}).getContent();
      const id = nextEcho++;
      echoes.set(String(id), output);
      return answer(response, 302, '', {Location: `/macros/echo?id=${id}`});
    } catch {
      return answer(response, 500, 'script problem\n', {'Content-Type': 'text/plain; charset=utf-8'});
    }
  }
  if (request.method === 'GET' && url.pathname === '/macros/echo') {
    const id = url.searchParams.get('id');
    if (!echoes.has(id)) return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*'});
    const output = echoes.get(id);
    echoes.delete(id);
    return answer(response, 200, output, {'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*'});
  }
  if (request.method === 'GET' && url.pathname === '/macros/s/local/exec') {
    return answer(response, 200, g.doGet().getContent(), {'Content-Type': 'text/plain; charset=utf-8'});
  }
  return answer(response, 404, 'not found\n', {'Content-Type': 'text/plain; charset=utf-8'});
}

const pages = http.createServer(staticFile);
const home = http.createServer((request, response) => void scriptHome(request, response));
pages.listen(port, '127.0.0.1', () => console.log(`Pages open at http://127.0.0.1:${port}/corporate/client/`));
home.listen(homePort, '127.0.0.1', () => console.log(`Prep home open at http://127.0.0.1:${homePort}/macros/s/local/exec`));

function close(code) {
  Promise.all([new Promise((done) => pages.close(done)), new Promise((done) => home.close(done))]).then(() => process.exit(code));
}
process.on('SIGTERM', () => close(0));
process.on('SIGINT', () => close(0));
