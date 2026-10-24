// Builds the shell into dist/, the folder Unveil loads as a component
// extension (patch 0002): TypeScript bundled by esbuild, static files, and the
// block lists converted to declarativeNetRequest rules.
//
//   npm run shell:build   build (node chromium/shell/build.mjs)
//   npm run shell:watch   rebuild the code on save (lists once)
//
// The lists are downloaded once a day into .cache/; UNVEIL_LISTS_DIR points at
// a folder of easylist.txt and easyprivacy.txt to build offline.

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertList } from './abp2dnr.mjs';
import { trackingParamRules } from './tracking-params.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const LISTS = {
  easylist: 'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
};
const DAY = 24 * 60 * 60 * 1000;

async function readList(name, url) {
  if (process.env.UNVEIL_LISTS_DIR) {
    return readFile(path.join(process.env.UNVEIL_LISTS_DIR, `${name}.txt`), 'utf8');
  }
  const cached = path.join(root, '.cache', `${name}.txt`);
  const age = await stat(cached).then((s) => Date.now() - s.mtimeMs, () => Infinity);
  if (age < DAY) return readFile(cached, 'utf8');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.startsWith('[Adblock Plus')) throw new Error(`${url}: not a filter list`);
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, text);
  return text;
}

async function buildRules() {
  await mkdir(path.join(dist, 'rules'), { recursive: true });
  for (const [name, url] of Object.entries(LISTS)) {
    const { rules, stats } = convertList(await readList(name, url));
    await writeFile(path.join(dist, 'rules', `${name}.json`), JSON.stringify(rules));
    console.log(`${name}: ${stats.filters} filters -> ${stats.rules} rules; skipped`, stats.skipped);
  }
  await writeFile(path.join(dist, 'rules', 'tracking_params.json'), JSON.stringify(trackingParamRules()));
}

const options = {
  entryPoints: {
    background: 'src/background.ts',
    newtab: 'src/newtab/newtab.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
  },
  absWorkingDir: root,
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
};

async function copyStatic() {
  await cp(path.join(root, 'static'), dist, { recursive: true });
  for (const file of ['manifest.json', 'src/ui.css', 'src/newtab/newtab.html', 'src/newtab/newtab.css',
    'src/popup/popup.html', 'src/options/options.html']) {
    await cp(path.join(root, file), path.join(dist, path.basename(file)));
  }
}

await rm(dist, { recursive: true, force: true });
await copyStatic();
await buildRules();
if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'static', setup: (b) => b.onEnd(() => copyStatic()) }],
  });
  await ctx.watch();
} else {
  await esbuild.build(options);
}
