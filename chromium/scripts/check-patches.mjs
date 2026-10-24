// Checks that chromium/patches apply to the Chromium version in
// chromium/build/CHROMIUM_VERSION, without a Chromium checkout.
//
// A checkout is 100+ GB, so this fetches only the files the patches touch, at
// that version's tag, from Chromium's gitiles, and applies the patches in
// order with `git apply` (no fuzz, as apply.ps1 does). It takes seconds, so CI
// catches a stale patch before a multi-hour build does.
//
//   npm run check-patches                    check
//   npm run check-patches -- --keep <dir>    also leave the patched files in
//                                            <dir>, to write a new patch from

import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const chromium = path.resolve(here, '..');
const GITILES = 'https://chromium.googlesource.com/chromium/src';

/** Paths a unified diff touches (its +++ side, or --- for a deletion). */
export function patchTargets(text) {
  const targets = new Set();
  const re = /^--- (\S+).*\n\+\+\+ (\S+)/gm;
  for (const [, from, to] of text.matchAll(re)) {
    const file = to === '/dev/null' ? from : to;
    targets.add(file.replace(/^[ab]\//, ''));
  }
  return [...targets];
}

async function fetchOk(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function commitFor(version, cache) {
  const file = path.join(cache, '.commit');
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {}
  const response = await fetchOk(`${GITILES}/+/refs/tags/${version}?format=JSON`);
  if (!response) throw new Error(`Chromium has no tag ${version}`);
  const text = await response.text();
  const { commit } = JSON.parse(text.slice(text.indexOf('{')));
  await mkdir(cache, { recursive: true });
  await writeFile(file, commit);
  return commit;
}

/** The file at that commit, or null if it doesn't exist there (a new file). */
async function source(commit, cache, file) {
  const cached = path.join(cache, file);
  try {
    return await readFile(cached);
  } catch {}
  const response = await fetchOk(`${GITILES}/+/${commit}/${file}?format=TEXT`);
  if (!response) return null;
  const data = Buffer.from(await response.text(), 'base64');
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, data);
  return data;
}

async function main() {
  const keep = process.argv.includes('--keep') ? path.resolve(process.argv[process.argv.indexOf('--keep') + 1]) : null;
  const version = (await readFile(path.join(chromium, 'build/CHROMIUM_VERSION'), 'utf8')).trim();
  const cache = path.join(os.tmpdir(), 'unveil-check-patches', version);
  const commit = await commitFor(version, cache);
  console.log(`Chromium ${version} (${commit.slice(0, 12)})`);

  const dir = path.join(chromium, 'patches');
  const patches = (await readdir(dir)).filter((f) => f.endsWith('.patch')).sort();
  const tree = await mkdtemp(path.join(os.tmpdir(), 'unveil-tree-'));
  let failed = 0;
  try {
    for (const name of patches) {
      const patch = path.join(dir, name);
      for (const file of patchTargets(await readFile(patch, 'utf8'))) {
        const target = path.join(tree, file);
        const exists = await readFile(target).then(() => true, () => false);
        if (exists) continue;
        const data = await source(commit, cache, file);
        if (data) {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, data);
        }
      }
      try {
        execFileSync('git', ['apply', '--whitespace=nowarn', patch], { cwd: tree, stdio: 'pipe' });
        console.log(`ok   ${name}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n${e.stderr}`);
      }
    }
    if (keep) {
      await cp(tree, keep, { recursive: true });
      console.log(`patched files in ${keep}`);
    }
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
