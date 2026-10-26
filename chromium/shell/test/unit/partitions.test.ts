import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReopen, partitionFor } from '../../src/lib/partitions.ts';

const space = { id: 'work', name: 'Work', hue: 210 };

test('a Space with separate cookies has a partition of its own, named after it', () => {
  assert.equal(partitionFor({ ...space, separateCookies: true }, true), 'work');
  assert.equal(partitionFor(space, true), '');
  assert.equal(partitionFor(undefined, true), '');
});

test('without the browser\'s partitions (a stock Chromium), every Space shares the profile\'s', () => {
  assert.equal(partitionFor({ ...space, separateCookies: true }, false), '');
});

test('web pages and the new tab page can open again in another partition; browser pages can\'t', () => {
  const newTab = ['chrome://newtab', 'chrome-extension://id/newtab.html'];
  assert.ok(canReopen('https://example.com/a', newTab));
  assert.ok(canReopen('chrome://newtab/', newTab));
  assert.ok(canReopen('chrome-extension://id/newtab.html', newTab));
  assert.ok(canReopen(undefined, newTab));
  assert.ok(!canReopen('chrome://settings/', newTab));
  assert.ok(!canReopen('file:///C:/a.txt', newTab));
});
