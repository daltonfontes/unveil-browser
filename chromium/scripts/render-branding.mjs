// Renders chromium/branding/logo.svg into the PNGs and the ICO that replace
// Chromium's (apply.ps1 copies them over chrome/app/theme), and the shell's
// toolbar icons. The outputs are committed, so a build doesn't need this; run
// it after changing the logo:
//
//   node chromium/scripts/render-branding.mjs      (needs Playwright's Chromium)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium as browserType } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const branding = path.resolve(here, '../branding');
const shellIcons = path.resolve(here, '../shell/static/icons');

// [file, size in px]
const PNGS = [
  ...[16, 24, 48, 64, 128, 256].map((s) => [`logo/product_logo_${s}.png`, s]),
  ['win/tiles/Logo.png', 150],
  ['win/tiles/SmallLogo.png', 70],
  ['default_100_percent/chromium/product_logo_16.png', 16],
  ['default_100_percent/chromium/product_logo_32.png', 32],
  ['default_200_percent/chromium/product_logo_16.png', 32],
  ['default_200_percent/chromium/product_logo_32.png', 64],
];
// Every size Windows asks an app icon for, each rendered at its size rather
// than scaled, so the small ones stay crisp.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

/** An ICO holding PNG images (Windows Vista and later read these). */
export function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); // no palette
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

async function main() {
  const svg = await readFile(path.join(branding, 'logo.svg'), 'utf8');
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const render = async (size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    return page.screenshot({ omitBackground: true });
  };
  const save = async (file, data) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  };

  for (const [file, size] of PNGS) await save(path.join(branding, file), await render(size));
  for (const size of [16, 32, 48, 128]) await save(path.join(shellIcons, `icon${size}.png`), await render(size));
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(size) });
  await save(path.join(branding, 'win/chromium.ico'), ico(images));

  await browser.close();
  console.log(`branding rendered into ${branding}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
