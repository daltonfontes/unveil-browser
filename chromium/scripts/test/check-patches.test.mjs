import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchOk, patchTargets } from '../check-patches.mjs';

test('patchTargets lists every file a patch touches, new ones included', () => {
  const patch = [
    '--- a/chrome/BUILD.gn', '+++ b/chrome/BUILD.gn', '@@ -1 +1 @@', '--- removed line', '+added',
    '--- /dev/null', '+++ b/chrome/browser/unveil/new.h', '@@ -0,0 +1 @@', '+x',
  ].join('\n');
  assert.deepEqual(patchTargets(patch), ['chrome/BUILD.gn', 'chrome/browser/unveil/new.h']);
});

test('fetchOk tries again on 503, 429 and dropped connections, not on other errors', async () => {
  const replies = [new Response('', { status: 503 }), 'drop', new Response('', { status: 429 }), new Response('ok')];
  let calls = 0;
  const flaky = async () => {
    const reply = replies[calls++];
    if (reply === 'drop') throw new TypeError('fetch failed');
    return reply;
  };
  const response = await fetchOk('https://x', { fetchImpl: flaky, delays: [0, 0, 0, 0] });
  assert.equal(await response.text(), 'ok');
  assert.equal(calls, 4);

  assert.equal(await fetchOk('https://x', { fetchImpl: async () => new Response('', { status: 404 }), delays: [0] }), null);
  await assert.rejects(fetchOk('https://x', { fetchImpl: async () => new Response('', { status: 403 }), delays: [0] }), /HTTP 403/);
  await assert.rejects(fetchOk('https://x', { fetchImpl: async () => new Response('', { status: 503 }), delays: [0, 0] }), /HTTP 503/);
});
