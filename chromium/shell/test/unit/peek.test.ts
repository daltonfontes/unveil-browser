import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peekBounds } from '../../src/peek/bounds.ts';

test('a peek is centred over its window, 82% of its size', () => {
  assert.deepEqual(peekBounds({ left: 100, top: 50, width: 1000, height: 800 }), { width: 820, height: 656, left: 190, top: 122 });
  // Windows on a second screen to the left have negative coordinates.
  assert.deepEqual(peekBounds({ left: -1920, top: 0, width: 1920, height: 1040 }), { width: 1574, height: 853, left: -1747, top: 94 });
});
