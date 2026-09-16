import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import vm from 'node:vm';

// The private link Miles hands out is built from where his page lives. On the
// custom domain that is the root; on github.io the page sits under the repo's
// name. Found on the first live booking, 2026-09-16: the link pointed one
// folder too high. This lifts clientLink out of dj.js and runs it for both.
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, '..', 'dj', 'dj.js'), 'utf8');
const lifted = source.match(/  function clientLink\(link\) \{[\s\S]*?\n  \}\n/);

function linkFrom(pathname, link) {
  assert.ok(lifted, 'clientLink is in dj.js');
  const context = { window: { location: { origin: 'https://example.test', pathname } } };
  vm.runInNewContext(lifted[0] + '; out = clientLink(link);', Object.assign(context, { link }));
  return context.out;
}

describe('The private link is built from where the page lives', () => {
  test('a page at the root keeps the root', () => {
    assert.equal(linkFrom('/corporate/dj/', '/corporate/client/#abc'), 'https://example.test/corporate/client/#abc');
  });
  test('a page under a repo name keeps the repo name', () => {
    assert.equal(linkFrom('/some-repo/corporate/dj/', '/corporate/client/#abc'), 'https://example.test/some-repo/corporate/client/#abc');
  });
  test('the page opened as index.html still finds its folder', () => {
    assert.equal(linkFrom('/some-repo/corporate/dj/index.html', '/corporate/client/#abc'), 'https://example.test/some-repo/corporate/client/#abc');
  });
});
