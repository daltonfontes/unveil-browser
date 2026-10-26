// The sidebar in a real Chromium: dist/ loads as an unpacked extension, and
// sidebar.html opens in a tab with ?window= pointing at a second window, the
// one whose tabs it shows. (In Unveil it lives in that window's side panel.)
// Needs Playwright with Chromium, and `npm run shell:build` first.

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

let server, port, context, profile, worker, sidebar, windowId;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Page ${req.url.slice(1)}</title><p>${req.url}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  profile = await mkdtemp(path.join(os.tmpdir(), 'unveil-sidebar-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => new Promise((r) => setTimeout(r, 300)));

  // The sidebar's own tab, in the first window, before the second exists
  // (a new page opens in the last focused window).
  sidebar = await context.newPage();

  // The window the sidebar shows: three pages.
  windowId = await worker.evaluate(async (base) => {
    const w = await chrome.windows.create({ url: [`${base}/a`, `${base}/b`, `${base}/c`] });
    await new Promise((r) => setTimeout(r, 800));
    return w.id;
  }, `http://127.0.0.1:${port}`);

  await sidebar.goto(`chrome-extension://${SHELL_ID}/sidebar.html?window=${windowId}`);
  await sidebar.waitForSelector('body[data-ready]');
});

after(async () => {
  await context?.close();
  server?.close();
  await rm(profile, { recursive: true, force: true });
});

const todayTitles = () => sidebar.locator('#today .row .title').allInnerTexts();
const tabsOfWindow = () => worker.evaluate((id) => chrome.tabs.query({ windowId: id }).then((t) => t.map((x) => ({ id: x.id, title: x.title, active: x.active }))), windowId);
async function eventually(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail(message);
}

test('Today lists the window\'s tabs, in order', async () => {
  await eventually(async () => (await todayTitles()).join() === 'Page a,Page b,Page c', `today: ${await todayTitles()}`);
});

test('clicking a tab activates it; × closes it', async () => {
  await sidebar.locator('#today .row', { hasText: 'Page a' }).click();
  await eventually(async () => (await tabsOfWindow()).find((t) => t.title === 'Page a')?.active, 'Page a should be active');
  await eventually(async () => (await sidebar.locator('#today .row.active .title').innerText()) === 'Page a', 'row should show active');

  await sidebar.locator('#today .row', { hasText: 'Page c' }).hover();
  await sidebar.locator('#today .row', { hasText: 'Page c' }).locator('.close').click();
  await eventually(async () => !(await tabsOfWindow()).some((t) => t.title === 'Page c'), 'Page c should close');
  await eventually(async () => (await todayTitles()).join() === 'Page a,Page b', `today: ${await todayTitles()}`);
});

test('pinning moves a tab to Pinned; closing it keeps the entry', async () => {
  await sidebar.locator('#today .row', { hasText: 'Page b' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Pin to this Space' }).click();
  await eventually(async () => (await sidebar.locator('#pinned .row').count()) === 1, 'one pinned entry');
  assert.deepEqual(await todayTitles(), ['Page a']);

  await sidebar.locator('#pinned .row').hover();
  await sidebar.locator('#pinned .row .close').click();
  await eventually(async () => (await sidebar.locator('#pinned .row.unloaded').count()) === 1, 'entry stays, unloaded');
  assert.ok(!(await tabsOfWindow()).some((t) => t.title === 'Page b'));

  await sidebar.locator('#pinned .row').click();
  await eventually(async () => (await tabsOfWindow()).some((t) => t.title === 'Page b' && t.active), 'entry reopens');
  await eventually(async () => (await sidebar.locator('#pinned .row.active').count()) === 1, 'entry shows open');
  assert.deepEqual(await todayTitles(), ['Page a']);
});

test('favourites show as icons, on every Space', async () => {
  await sidebar.locator('#today .row', { hasText: 'Page a' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Add to favorites' }).click();
  await eventually(async () => (await sidebar.locator('#favorites .favorite').count()) === 1, 'one favourite');
  assert.deepEqual(await todayTitles(), []);
});

test('Spaces: a new Space starts with a new tab; the others\' tabs are out of sight', async () => {
  await sidebar.locator('#add-space').click();
  await sidebar.fill('#space-name', 'Work');
  await sidebar.locator('#space-dialog button[value=save]').click();
  await eventually(async () => (await sidebar.locator('.space').count()) === 2, 'two Spaces');
  await eventually(async () => (await sidebar.locator('.space.current').getAttribute('title'))?.startsWith('Work'), 'Work is current');
  // Its own (new) tab, none of the first Space's; the favourite stays.
  await eventually(async () => (await sidebar.locator('#today .row').count()) === 1, `today: ${await todayTitles()}`);
  assert.equal(await sidebar.locator('#pinned .row').count(), 0);
  assert.equal(await sidebar.locator('#favorites .favorite').count(), 1);

  await sidebar.locator('.space').first().click();
  await eventually(async () => (await sidebar.locator('#pinned .row').count()) === 1, 'back to the first Space');
  assert.equal(await sidebar.locator('#today .row').count(), 0);
});

test('moving a tab to another Space', async () => {
  await worker.evaluate(({ id, url }) => chrome.tabs.create({ windowId: id, url, active: false }), { id: windowId, url: `http://127.0.0.1:${port}/d` });
  await eventually(async () => (await todayTitles()).includes('Page d'), 'Page d shows');
  await sidebar.locator('#today .row', { hasText: 'Page d' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Work' }).click();
  await eventually(async () => !(await todayTitles()).includes('Page d'), 'Page d leaves this Space');
  await sidebar.locator('.space[title^="Work"]').click();
  await eventually(async () => (await todayTitles()).includes('Page d'), 'Page d is in Work');
});

test('search filters the sidebar and finds archived tabs; archived tabs reopen', async () => {
  // Archive now: Today tabs that aren't active close into the archive.
  await worker.evaluate(({ id, url }) => chrome.tabs.create({ windowId: id, url, active: false }), { id: windowId, url: `http://127.0.0.1:${port}/old-report` });
  await eventually(async () => (await todayTitles()).includes('Page old-report'), 'old-report shows');
  await sidebar.evaluate(() => chrome.runtime.sendMessage({ sidebar: { type: 'archiveNow' } }));
  await eventually(async () => !(await todayTitles()).includes('Page old-report'), 'old-report archived');

  await sidebar.fill('#search', 'old-rep');
  await eventually(async () => (await sidebar.locator('#archive .row').count()) === 1, 'archive search finds it');
  await sidebar.locator('#archive .row').click();
  await eventually(async () => (await tabsOfWindow()).some((t) => t.title === 'Page old-report'), 'reopened');
  await sidebar.fill('#search', '');
});

test('the side panel shows the sidebar page', async () => {
  const path = await worker.evaluate(async () => (await chrome.sidePanel.getOptions({})).path);
  assert.equal(path, 'sidebar.html');
});

test('Ctrl+Shift+S toggles the sidebar; the collapse button hides it', async () => {
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.equal(commands.find((c) => c.name === 'toggle-sidebar')?.shortcut, 'Ctrl+Shift+S');

  // Open the side panel the way a person would: a click (a user gesture) in a
  // page of that window. (Playwright's key presses don't reach the browser's
  // shortcuts, so the toggle is driven by the collapse button, which runs the
  // same code as the shortcut.)
  const opener = await context.newPage();
  await opener.goto(`chrome-extension://${SHELL_ID}/options.html`);
  const openerWindow = await opener.evaluate(async () => (await chrome.windows.getCurrent()).id);
  await opener.evaluate(() => {
    const button = Object.assign(document.createElement('button'), { id: 'open-panel', textContent: 'open' });
    button.onclick = async () => chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
    document.body.prepend(button);
  });
  await opener.click('#open-panel');
  const openWindows = () => worker.evaluate(async () => (await chrome.storage.session.get('sidebarOpenWindows')).sidebarOpenWindows ?? []);
  await eventually(async () => (await openWindows()).includes(openerWindow), 'the panel opens and is tracked');

  const panelSidebar = await context.newPage();
  await panelSidebar.goto(`chrome-extension://${SHELL_ID}/sidebar.html?window=${openerWindow}`);
  await panelSidebar.waitForSelector('body[data-ready]');
  await panelSidebar.click('#collapse');
  await eventually(async () => !(await openWindows()).includes(openerWindow), 'the panel closes');
  await panelSidebar.close();
  await opener.close();
});

test('split view: a tab beside the current one shares its row; ending the split separates them', async () => {
  const split = await worker.evaluate(() => typeof chrome.tabs.createSplit === 'function');
  assert.ok(split, 'this Chromium has no split view API (chrome.tabs.createSplit): use Chromium 156 or newer');

  await sidebar.locator('.space').first().click();
  const [left, right] = await worker.evaluate(async ({ id, base }) => {
    const right = await chrome.tabs.create({ windowId: id, url: `${base}/right`, active: false });
    const left = await chrome.tabs.create({ windowId: id, url: `${base}/left`, active: true });
    await new Promise((r) => setTimeout(r, 500));
    return [left.id, right.id];
  }, { id: windowId, base: `http://127.0.0.1:${port}` });
  const splitIds = () => worker.evaluate((ids) => Promise.all(ids.map((i) => chrome.tabs.get(i).then((t) => t.splitViewId))), [left, right]);

  await eventually(async () => (await todayTitles()).includes('Page right'), 'Page right shows');
  await sidebar.locator('#today .row', { hasText: 'Page right' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Open in split view with the current tab' }).click();
  await eventually(async () => {
    const [a, b] = await splitIds();
    return a >= 0 && a === b;
  }, `both tabs in one split: ${await splitIds()}`);
  await eventually(async () => (await sidebar.locator('#today .split-group .row').allInnerTexts()).join().includes('Page left'), 'the split shares a row');
  assert.deepEqual(await sidebar.locator('#today .split-group .row .title').allInnerTexts(), ['Page left', 'Page right']);

  await sidebar.locator('#today .split-group .row', { hasText: 'Page right' }).click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'End split view' }).click();
  await eventually(async () => (await splitIds()).every((s) => s < 0), 'split ended');
  await eventually(async () => (await sidebar.locator('#today .split-group').count()) === 0, 'rows separate again');
});

test('split view with a new tab, from the current tab\'s menu', async () => {
  const before = (await tabsOfWindow()).length;
  const active = (await tabsOfWindow()).find((t) => t.active);
  await sidebar.locator('#today .row.active').click({ button: 'right' });
  await sidebar.locator('#menu button', { hasText: 'Split view with a new tab' }).click();
  await eventually(async () => (await tabsOfWindow()).length === before + 1, 'a new tab opens');
  const splitOfActive = await worker.evaluate((id) => chrome.tabs.get(id).then((t) => t.splitViewId), active.id);
  assert.ok(splitOfActive >= 0, 'the current tab is in a split');
  await eventually(async () => (await sidebar.locator('#today .split-group .row').count()) === 2, 'the pair shares a row');
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  assert.equal(commands.find((c) => c.name === 'split-view')?.shortcut, 'Alt+Shift+S');
});
