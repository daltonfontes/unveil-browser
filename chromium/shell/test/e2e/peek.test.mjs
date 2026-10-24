// Peek in a real Chromium: a link from a pinned tab opens in a floating popup
// window instead of a new tab, Esc and the ✕ close it, and "Open as tab" moves
// it into its window. Needs `npm run shell:build` first.
//
// Headless Chromium gives every window the same size and sends no focus
// changes, so where the peek goes (test/unit/peek.test.ts) and "a click back
// in the window behind closes it" aren't checked here.

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
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const name = req.url.slice(1);
    res.end(`<!doctype html><title>Page ${name}</title>
      <a id="out" href="/article-${name}" target="_blank">read</a>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  profile = await mkdtemp(path.join(os.tmpdir(), 'unveil-peek-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  sidebar = await context.newPage();
  windowId = await worker.evaluate(async (url) => {
    const w = await chrome.windows.create({ url, left: 0, top: 0, width: 1000, height: 800 });
    await new Promise((r) => setTimeout(r, 600));
    return w.id;
  }, `${base}/docs`);
  await sidebar.goto(`chrome-extension://${SHELL_ID}/sidebar.html?window=${windowId}`);
  await sidebar.waitForSelector('body[data-ready]');
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
const popups = () => worker.evaluate(async () =>
  (await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })).map((w) => ({
    id: w.id, left: w.left, top: w.top, width: w.width, height: w.height, url: w.tabs[0]?.url || w.tabs[0]?.pendingUrl,
  })));
const tabsOf = (id) => worker.evaluate((id) => chrome.tabs.query({ windowId: id }).then((t) => t.map((x) => x.url)), id);
// The peeked page. A link from a pinned tab first opens a new tab, which the
// shell closes at once for the peek: that brief page has the same URL, so a
// page that closes while we look is skipped.
const peekPage = async (name) => {
  let found;
  await eventually(async () => {
    for (const page of context.pages().filter((p) => !p.isClosed() && p.url().endsWith(`/article-${name}`))) {
      if (await page.waitForSelector('unveil-peek', { timeout: 500 }).then(() => true, () => false)) {
        found = page;
        return true;
      }
    }
    return false;
  }, `the peek of ${name} shows up`);
  return found;
};

test('a link from a pinned tab opens in Peek, not a new tab; Esc closes it', async () => {
  await sidebar.locator('#today .row', { hasText: 'Page docs' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Pin to this Space' }).click();
  await eventually(async () => (await sidebar.locator('#pinned .row').count()) === 1, 'docs is pinned');

  const pinned = context.pages().find((p) => p.url() === `${base}/docs`);
  await pinned.click('#out');
  await eventually(async () => (await popups()).some((w) => w.url?.endsWith('/article-docs')), async () => `popups: ${JSON.stringify(await popups())}`);
  assert.ok(!(await tabsOf(windowId)).some((u) => u?.includes('/article-')), 'no new tab in the window');

  const page = await peekPage('docs');
  // Only the key down: the peek is gone before a key up could reach it.
  await page.keyboard.down('Escape');
  await eventually(async () => (await popups()).length === 0, 'Esc closes the peek');
});

test('"Open as tab" moves the peek into its window', async () => {
  const pinned = context.pages().find((p) => p.url() === `${base}/docs`);
  await pinned.click('#out');
  const page = await peekPage('docs');
  await page.locator('unveil-peek #promote').click();
  await eventually(async () => (await popups()).length === 0, 'the peek window goes');
  await eventually(async () => (await tabsOf(windowId)).some((u) => u?.endsWith('/article-docs')), 'it is a tab of the window now');
  await eventually(async () => (await sidebar.locator('#today .row', { hasText: 'Page article-docs' }).count()) === 1, 'in Today, in the same Space');
  await eventually(async () => (await page.locator('unveil-peek').count()) === 0, 'as a tab, the page has no peek buttons');
});

test('"Open in Peek" for any link (the link menu runs this); ✕ closes it', async () => {
  const menu = await worker.evaluate(() => chrome.contextMenus.update('unveil-peek-link', {}).then(() => true, () => false));
  assert.ok(menu, 'the "Open in Peek" link menu item exists');
  const opened = await sidebar.evaluate(({ url, windowId }) => chrome.runtime.sendMessage({ peek: { type: 'open', url, windowId } }),
    { url: `${base}/article-menu`, windowId });
  assert.ok(opened.ok);
  const page = await peekPage('menu');
  await page.locator('unveil-peek #close').click();
  await eventually(async () => (await popups()).length === 0, async () => `✕ closes it: ${JSON.stringify(await popups())}`);
});

test('the setting turns Peek from pinned tabs off', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ peekFromPinned: false }));
  const pinned = context.pages().find((p) => p.url() === `${base}/docs`);
  await pinned.click('#out');
  await eventually(async () => (await tabsOf(windowId)).filter((u) => u?.endsWith('/article-docs')).length === 2, 'a plain new tab this time');
  assert.equal((await popups()).length, 0);
});
