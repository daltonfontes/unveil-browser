import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchTargets } from '../check-patches.mjs';

test('patchTargets lists every file a patch touches, new ones included', () => {
  const patch = [
    '--- a/chrome/BUILD.gn', '+++ b/chrome/BUILD.gn', '@@ -1 +1 @@', '--- removed line', '+added',
    '--- /dev/null', '+++ b/chrome/browser/unveil/new.h', '@@ -0,0 +1 @@', '+x',
  ].join('\n');
  assert.deepEqual(patchTargets(patch), ['chrome/BUILD.gn', 'chrome/browser/unveil/new.h']);
});
