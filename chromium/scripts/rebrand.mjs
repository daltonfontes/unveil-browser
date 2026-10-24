// Renames the browser from Chromium to Unveil in its UI strings.
//
// The product name lives in chrome/app/chromium_strings.grd and the parts it
// includes (window titles, the About page, menus, Settings, the installer).
// Its translations (.xtb) are keyed by a fingerprint of each English message,
// so changing the English text alone would lose every translation of it. This
// changes the English messages, then moves each translation to its message's
// new ID and renames it there too.
//
// "ChromiumOS", "Chromium OS" and "The Chromium Authors" stay as they are:
// they name other things. apply.ps1 runs it after the patches; it is safe to
// run again.
//
//   node chromium/scripts/rebrand.mjs <chromium src>

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'Unveil';
const GRD = 'chrome/app/chromium_strings.grd';
// No \b: translations inflect it ("Chromiumiin", "a Chromiumba") or join it to
// a word in another script ("ለChromium").
const CHROMIUM = /(?<!The )Chromium(?!\s*(?:OS|Authors|Projects?)\b)/g;
// Attributes may hold '>' (desc="Settings > AI"), so they are matched as quoted.
const MESSAGE = /(<message\b((?:[^>"]|"[^"]*")*)>)([\s\S]*?)(<\/message>)/g;
const TRANSLATION = /<translation id="(\d+)"((?:[^>"]|"[^"]*")*)>([\s\S]*?)<\/translation>/g;
const PART = /<part file="([^"]+)"/g;

export const rename = (text) => text.replace(CHROMIUM, NAME);

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e] ?? m));

/**
 * The text GRIT fingerprints for a <message>: placeholders become their
 * upper-case names, and surrounding whitespace and ''' quotes go
 * (grit/node/message.py, MessageNode.EndParsing).
 */
export function presentable(content) {
  let text = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ph\b[^>]*\bname="([^"]+)"[^>]*>[\s\S]*?<\/ph>/g, (_, name) => name.toUpperCase())
    .replace(/<ph\b[^>]*\bname="([^"]+)"[^>]*\/>/g, (_, name) => name.toUpperCase());
  text = decode(text).trim();
  if (text.startsWith("'''")) text = text.slice(3);
  if (text.endsWith("'''")) text = text.slice(0, -3);
  return text.trim();
}

// FP.FingerPrint: the first 64 bits of the MD5, as a signed integer.
function fingerprint(text) {
  const unsigned = BigInt.asUintN(64, BigInt(`0x${createHash('md5').update(text, 'utf8').digest('hex').slice(0, 16)}`));
  return BigInt.asIntN(64, unsigned);
}

/** grit/extern/tclib.py GenerateMessageId. */
export function messageId(text, meaning = '') {
  let fp = fingerprint(text);
  if (meaning) {
    const fp2 = fingerprint(meaning);
    // Python integers don't overflow: no wrapping here either.
    fp = fp < 0n ? fp2 + (fp << 1n) + 1n : fp2 + (fp << 1n);
  }
  return String(fp & 0x7fffffffffffffffn);
}

const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';

/**
 * Renames one grd or grdp file's messages. Returns the new text and a map of
 * old message ID -> new ID for the messages that changed.
 */
export function renameMessages(text) {
  const moved = new Map();
  const renamed = text.replace(MESSAGE, (whole, open, attrs, content, close) => {
    const next = rename(content);
    if (next === content || attr(attrs, 'use_name_for_id') === 'true') return open + next + close;
    const meaning = decode(attr(attrs, 'meaning'));
    moved.set(messageId(presentable(content), meaning), messageId(presentable(next), meaning));
    return open + next + close;
  });
  return { renamed, moved };
}

/** Moves and renames the translations of the messages in `moved`. */
export function moveTranslations(xtb, moved) {
  return xtb.replace(TRANSLATION, (whole, id, attrs, body) =>
    moved.has(id) ? `<translation id="${moved.get(id)}"${attrs}>${rename(body)}</translation>` : whole);
}

export async function rebrand(src) {
  const grdPath = path.join(src, GRD);
  const grd = await readFile(grdPath, 'utf8');
  const files = [grdPath, ...[...grd.matchAll(PART)].map((m) => path.join(path.dirname(grdPath), m[1]))];
  const moved = new Map();
  for (const file of files) {
    const { renamed, moved: fileMoved } = renameMessages(await readFile(file, 'utf8'));
    for (const [from, to] of fileMoved) moved.set(from, to);
    await writeFile(file, renamed);
  }
  if (!moved.size) {
    console.log(`${GRD}: already renamed`);
    return 0;
  }
  const resources = path.join(path.dirname(grdPath), 'resources');
  for (const name of (await readdir(resources)).filter((f) => /^chromium_strings_.*\.xtb$/.test(f))) {
    const file = path.join(resources, name);
    await writeFile(file, moveTranslations(await readFile(file, 'utf8'), moved));
  }
  console.log(`${GRD}: ${moved.size} messages renamed`);
  return moved.size;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('usage: node chromium/scripts/rebrand.mjs <chromium src>');
    process.exit(2);
  }
  await rebrand(path.resolve(process.argv[2]));
}
