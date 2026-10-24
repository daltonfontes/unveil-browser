// Spaces with separate cookies in a real Chromium. The partitions themselves
// are the browser's (patches 0011 and 0012), which a stock Chromium doesn't
// have: there the option is off, and the rest of the test stands in a fake
// chrome.unveilPrivate that records which partition each tab was opened in,
// to check the shell opens each tab in its Space's and moves tabs across.
// Needs `npm run shell:build` first.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const SHELL_ID = 'cdpknnidfjopheidjbploffefndegnlp';

let server, base, context, profile, worker, sidebar, windowId;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Page ${req.url.slice(1)}</title>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  profile = await mkdtemp(path.join(os.tmpdir(), 'unveil-spaces-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  sidebar = await context.newPage();
  windowId = await worker.evaluate(async (url) => {
    const w = await chrome.windows.create({ url });
    await new Promise((r) => setTimeout(r, 600));
    return w.id;
  }, `${base}/home`);
  await sidebar.goto(`chrome-extension://${SHELL_ID}/sidebar.html?window=${windowId}`);
  await sidebar.waitForSelector('body[data-ready]');
  sidebar.on('dialog', (dialog) => dialog.accept());
});

after(async () => {
  await context?.close();
  server?.close();
  await rm(profile, { recursive: true, force: true });
});

async function eventually(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail(typeof message === 'function' ? await message() : message);
}

// What Unveil's browser does, as far as the shell can tell: a tab's
// partition is the one it was opened in.
function fakeUnveilPrivate() {
  globalThis.partitions ??= new Map();
  globalThis.cleared ??= [];
  chrome.unveilPrivate = {
    createTab: async ({ partition, ...options }) => {
      const tab = await chrome.tabs.create(options);
      partitions.set(tab.id, partition ?? '');
      return tab.id;
    },
    getTabPartition: async (tabId) => {
      await chrome.tabs.get(tabId);
      return partitions.get(tabId) ?? '';
    },
    clearPartition: async (partition) => {
      cleared.push(partition);
    },
  };
}

/** The window's tabs: URL and partition. */
const tabs = () => worker.evaluate((id) => chrome.tabs.query({ windowId: id }).then((list) =>
  list.map((t) => ({ id: t.id, url: t.url || t.pendingUrl, partition: partitions.get(t.id) ?? '' }))), windowId);
const workSpace = () => worker.evaluate(() => chrome.storage.local.get('sidebar').then(({ sidebar }) => sidebar?.spaces.find((s) => s.name === 'Work')));
const todayTitles = () => sidebar.locator('#today .row .title').allInnerTexts();

test('on a stock Chromium the option is there but off: only Unveil\'s browser has the partitions', async () => {
  await sidebar.locator('#add-space').click();
  assert.ok(await sidebar.locator('#space-separate').isDisabled());
  assert.equal(await sidebar.locator('#space-separate-hint').innerText(), 'Only in the Unveil browser.');
  await sidebar.locator('#space-dialog button[value=cancel]').click();
});

test('a Space with separate cookies opens its tabs in its own partition', async () => {
  await worker.evaluate(fakeUnveilPrivate);
  await sidebar.evaluate(fakeUnveilPrivate);
  await sidebar.locator('#add-space').click();
  assert.ok(!(await sidebar.locator('#space-separate').isDisabled()));
  await sidebar.fill('#space-name', 'Work');
  await sidebar.fill('#space-emoji', '💼');
  await sidebar.locator('#space-separate').check();
  await sidebar.locator('#space-dialog button[value=save]').click();
  await eventually(async () => (await workSpace())?.separateCookies === true, 'Work has separate cookies');
  const work = (await workSpace()).id;
  await eventually(async () => (await sidebar.locator('.space.current.separate').count()) === 1, 'Work is current, marked');

  // Its first tab (the new tab page), and one from the sidebar's new tab.
  await eventually(async () => (await tabs()).filter((t) => t.partition === work).length === 1, async () => `tabs: ${JSON.stringify(await tabs())}`);
  await sidebar.evaluate((url) => chrome.runtime.sendMessage({ sidebar: { type: 'newTab', windowId: Number(new URL(location.href).searchParams.get('window')), url } }), `${base}/mail`);
  await eventually(async () => (await tabs()).some((t) => t.url === `${base}/mail` && t.partition === work), async () => `tabs: ${JSON.stringify(await tabs())}`);
  // The first Space's tab stays in the profile's storage.
  assert.equal((await tabs()).find((t) => t.url === `${base}/home`).partition, '');
});

test('a tab the browser opens on its own (Ctrl+T) opens again in the Space\'s partition', async () => {
  const work = (await workSpace()).id;
  await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url }), { windowId, url: `${base}/typed` });
  await eventually(async () => (await tabs()).some((t) => t.url === `${base}/typed` && t.partition === work), async () => `tabs: ${JSON.stringify(await tabs())}`);
  await eventually(async () => (await tabs()).filter((t) => t.url === `${base}/typed`).length === 1, 'the first one closes');
  await eventually(async () => (await todayTitles()).includes('Page typed'), 'it is in Today');
});

test('moving a tab to the Space reopens it there, at the same address', async () => {
  const work = (await workSpace()).id;
  await sidebar.locator('.space').first().click();
  await eventually(async () => (await todayTitles()).includes('Page home'), 'back in the first Space');
  await sidebar.locator('#today .row', { hasText: 'Page home' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Work' }).click();
  await eventually(async () => (await tabs()).some((t) => t.url === `${base}/home` && t.partition === work), async () => `tabs: ${JSON.stringify(await tabs())}`);
  await eventually(async () => (await tabs()).filter((t) => t.url === `${base}/home`).length === 1, 'the first one closes');
});

test('Peek in such a Space opens a tab in its partition: a popup window can\'t be put in one', async () => {
  const work = (await workSpace()).id;
  await sidebar.evaluate(({ url, windowId, spaceId }) => chrome.runtime.sendMessage({ peek: { type: 'open', url, windowId, spaceId } }),
    { url: `${base}/peeked`, windowId, spaceId: work });
  await eventually(async () => (await tabs()).some((t) => t.url === `${base}/peeked` && t.partition === work), async () => `tabs: ${JSON.stringify(await tabs())}`);
  assert.equal((await worker.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }))).length, 0);
});

test('"Sign out of everything in this Space" clears its partition', async () => {
  const work = (await workSpace()).id;
  await sidebar.locator('.space', { hasText: '💼' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Sign out of everything in this Space' }).click();
  await eventually(async () => (await worker.evaluate(() => cleared)).includes(work), 'cleared');
});

test('turning separate cookies off moves its tabs back to the profile\'s storage; deleting it clears it', async () => {
  const work = (await workSpace()).id;
  await sidebar.locator('.space', { hasText: '💼' }).dblclick();
  await sidebar.locator('#space-separate').uncheck();
  await sidebar.locator('#space-dialog button[value=save]').click();
  await eventually(async () => (await tabs()).every((t) => t.partition === ''), async () => `tabs: ${JSON.stringify(await tabs())}`);
  await eventually(async () => (await tabs()).filter((t) => t.url === `${base}/mail`).length === 1, 'one of it');

  await worker.evaluate(() => cleared.splice(0));
  await sidebar.evaluate((spaceId) => chrome.runtime.sendMessage({ sidebar: { type: 'deleteSpace', spaceId } }), work);
  await eventually(async () => (await worker.evaluate(() => cleared)).includes(work), 'its partition is cleared');
});
