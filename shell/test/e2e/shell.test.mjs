// Loads dist/ into Chromium as an unpacked extension (the same files Unveil
// loads as a component extension) and checks it does its job in a real
// browser: blocking, the per-site switch, link cleaning and the new tab page.
// Needs Playwright with Chromium, and `npm run build` first.
//
// Requests to made-up hosts are answered by a local server
// (--host-resolver-rules), so the test needs no network.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const SHELL_ID = 'cdpknnidfjopheidjbploffefndegnlp'; // patches/unveil/0002

let server, port, context, profile, worker, tracker;
const requests = [];

before(async () => {
  // A tracker EasyPrivacy blocks outright. Not google-analytics.com: Google's
  // domains are HSTS-preloaded, so http:// to them never reaches our server
  // with or without blocking, and the test would pass for the wrong reason.
  const rules = JSON.parse(await readFile(path.join(dist, 'rules/easyprivacy.json'), 'utf8'));
  const plain = rules.find((r) => r.action.type === 'block' && Object.keys(r.condition).join() === 'requestDomains');
  tracker = plain.condition.requestDomains.find((d) => /^[a-z0-9-]+\.(com|net)$/.test(d));

  server = createServer((req, res) => {
    requests.push(`${req.headers.host.split(':')[0]}${req.url}`);
    if (req.url.startsWith('/page')) {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>page</title>
        <script src="http://${tracker}:${port}/track.js"></script>
        <script src="http://cdn.test:${port}/app.js"></script>`);
    } else {
      res.setHeader('content-type', 'text/javascript');
      res.end('// ok');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  profile = await mkdtemp(path.join(os.tmpdir(), 'unveil-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // full Chromium: headless shell has no extensions
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--host-resolver-rules=MAP * 127.0.0.1',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Let onInstalled settle the rulesets.
  await worker.evaluate(() => new Promise((r) => setTimeout(r, 500)));
});

after(async () => {
  await context?.close();
  server?.close();
  await rm(profile, { recursive: true, force: true });
});

async function visit(url) {
  requests.length = 0;
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForLoadState('load');
  const finalUrl = page.url();
  await page.close();
  return { finalUrl, hosts: requests.map((r) => r.split('/')[0]) };
}

test('the manifest key gives the ID the browser patch expects', () => {
  assert.equal(new URL(worker.url()).host, SHELL_ID);
});

test('all three rulesets are on', async () => {
  const ids = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(ids.sort(), ['easylist', 'easyprivacy', 'tracking_params']);
});

test('trackers are blocked, other scripts load', async () => {
  const { hosts } = await visit(`http://site.test:${port}/page`);
  assert.ok(hosts.includes('cdn.test'), `cdn.test should load: ${hosts}`);
  assert.ok(!hosts.includes(tracker), `tracker should be blocked: ${hosts}`);
});

test('tracking parameters are stripped from links', async () => {
  const { finalUrl } = await visit(`http://site.test:${port}/page?id=7&utm_source=news&fbclid=abc`);
  assert.equal(finalUrl, `http://site.test:${port}/page?id=7`);
});

test('turning protection off for a site lets everything through', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ allowedSites: ['site.test'] }));
  await worker.evaluate(async () => {
    for (let i = 0; i < 50 && !(await chrome.declarativeNetRequest.getDynamicRules()).length; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
  });
  const { hosts, finalUrl } = await visit(`http://site.test:${port}/page?utm_source=x`);
  assert.ok(hosts.includes(tracker), `allowed site should load trackers: ${hosts}`);
  assert.equal(finalUrl, `http://site.test:${port}/page?utm_source=x`);

  await worker.evaluate(() => chrome.storage.local.set({ allowedSites: [] }));
  await worker.evaluate(async () => {
    for (let i = 0; i < 50 && (await chrome.declarativeNetRequest.getDynamicRules()).length; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
  });
  assert.ok(!(await visit(`http://site.test:${port}/page`)).hosts.includes(tracker));
});

test('the new tab page is the shell, and its command box works', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${SHELL_ID}/newtab.html`);
  await page.fill('#input', 'gh chromium/chromium');
  assert.equal(await page.locator('#result').isHidden(), true);
  await page.fill('#input', '1700000000');
  assert.match(await page.locator('#result').innerText(), /2023-11-14T22:13:20\.000Z/);
  await page.fill('#input', `localhost:${port}/page`);
  await Promise.all([page.waitForURL(`http://localhost:${port}/page`), page.press('#input', 'Enter')]);
  await page.close();
});

test('settings switch the rulesets', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${SHELL_ID}/options.html`);
  const ads = page.locator('[data-setting="blockAds"]');
  assert.equal(await ads.isChecked(), true);
  const enabled = () => worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  const waitFor = async (want) => {
    for (let i = 0; i < 50 && (await enabled()).includes('easylist') !== want; i++) await page.waitForTimeout(20);
    return (await enabled()).includes('easylist');
  };
  await ads.click();
  assert.equal(await waitFor(false), false);
  await ads.click();
  assert.equal(await waitFor(true), true);
  await page.close();
});
