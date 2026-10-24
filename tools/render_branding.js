// Renders branding/logo.svg into the PNGs and ICO that replace Chromium's
// (build.py copies branding/chromium over chrome/app/theme/chromium). The
// outputs are committed, so a build doesn't need this; run it after changing
// the logo:  node tools/render_branding.js  (needs Playwright and Python Pillow)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'branding/logo.svg'), 'utf8');
const out = path.join(root, 'branding/chromium');

// [path under chrome/app/theme, size in px]
const pngs = [
  ...[16, 24, 48, 64, 128, 256].map((s) => [`chromium/product_logo_${s}.png`, s]),
  ['chromium/win/tiles/Logo.png', 150],
  ['chromium/win/tiles/SmallLogo.png', 70],
  ['default_100_percent/chromium/product_logo_16.png', 16],
  ['default_100_percent/chromium/product_logo_32.png', 32],
  ['default_200_percent/chromium/product_logo_16.png', 32],
  ['default_200_percent/chromium/product_logo_32.png', 64],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: true });
  };
  for (const [rel, size] of pngs) {
    await render(size, path.join(root, 'branding', rel.replace(/^chromium\//, 'chromium/')));
  }
  // The shell's own icons (the extension's toolbar button).
  for (const size of [16, 32, 48, 128]) {
    await render(size, path.join(root, `shell/static/icons/icon${size}.png`));
  }
  // chromium.ico: every size Windows asks for, rendered at each size rather
  // than scaled, so the small ones stay crisp.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'unveil-ico-'));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
  for (const s of sizes) await render(s, path.join(tmp, `${s}.png`));
  await browser.close();
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
sizes = [int(s) for s in sys.argv[2].split(',')]
images = [Image.open(f'{sys.argv[1]}/{s}.png').convert('RGBA') for s in sizes]
images[-1].save(sys.argv[3], format='ICO', sizes=[(s, s) for s in sizes], append_images=images[:-1])
`, tmp, sizes.join(','), path.join(out, 'win/chromium.ico')], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true });
  console.log('branding rendered into', out);
})();
