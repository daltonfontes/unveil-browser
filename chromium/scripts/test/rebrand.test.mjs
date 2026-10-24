// The IDs below were computed by Chromium's own GRIT (tools/grit, Chromium
// 157) from chrome/app/chromium_strings.grd, so rebrand.mjs is checked against
// the real thing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageId, moveTranslations, presentable, rename, renameMessages } from '../rebrand.mjs';

test('message IDs match GRIT', () => {
  assert.equal(messageId('Skills in Chromium'), '22571759390241347');
  assert.equal(
    messageId('Chromium uses your microphone to capture your voice and fill in text fields with cleaned up content'),
    '2783830132942533931');
});

test('presentable text: placeholders by name, whitespace and quotes trimmed, entities decoded', () => {
  assert.equal(
    presentable(`
      Welcome to <ph name="PRODUCT_NAME">$1<ex>Chromium</ex></ph> &amp; more
    `),
    'Welcome to PRODUCT_NAME & more');
  // ''' keeps the spaces in the output, but GRIT fingerprints the text without them.
  assert.equal(presentable("'''  spaced  '''"), 'spaced');
});

test('what gets renamed, and what stays', () => {
  assert.equal(rename('About Chromium'), 'About Unveil');
  assert.equal(rename("Chromium's settings"), "Unveil's settings");
  assert.equal(rename('kirjaudu Chromiumiin'), 'kirjaudu Unveiliin');
  assert.equal(rename('ለChromium'), 'ለUnveil');
  assert.equal(rename('ChromiumOS and Chromium OS'), 'ChromiumOS and Chromium OS');
  assert.equal(rename('Copyright The Chromium Authors'), 'Copyright The Chromium Authors');
});

test('translations move to the new ID', () => {
  const grd = `<message name="IDS_X" desc="Settings > AI page">
    Skills in Chromium
  </message>
  <message name="IDS_Y" desc="unchanged">Nothing here</message>`;
  const { renamed, moved } = renameMessages(grd);
  assert.match(renamed, /Skills in Unveil/);
  assert.match(renamed, /desc="Settings > AI page"/);
  assert.deepEqual([...moved], [['22571759390241347', messageId('Skills in Unveil')]]);
  const xtb = '<translation id="22571759390241347">Habilidades no Chromium</translation>\n<translation id="1">Chromium</translation>';
  assert.equal(
    moveTranslations(xtb, moved),
    `<translation id="${messageId('Skills in Unveil')}">Habilidades no Unveil</translation>\n<translation id="1">Chromium</translation>`);
});
