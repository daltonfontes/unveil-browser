import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand } from '../../src/lib/commands.ts';

const SEARCH = 'https://duckduckgo.com/?q=%s';
const open = (input: string) => {
  const c = parseCommand(input, SEARCH);
  assert.equal(c.kind, 'open');
  return c.kind === 'open' ? c.url : '';
};

test('developer prefixes', () => {
  assert.equal(open('gh chromium/chromium'), 'https://github.com/chromium/chromium');
  assert.equal(open('gh vertical tabs'), 'https://github.com/search?q=vertical%20tabs');
  assert.equal(open('npm esbuild'), 'https://www.npmjs.com/package/esbuild');
  assert.equal(open('mdn grid'), 'https://developer.mozilla.org/search?q=grid');
  assert.equal(open('caniuse :has'), 'https://caniuse.com/?search=%3Ahas');
  assert.equal(open('SO rust lifetimes'), 'https://stackoverflow.com/search?q=rust%20lifetimes');
});

test('addresses open, everything else searches', () => {
  assert.equal(open('example.com'), 'https://example.com');
  assert.equal(open('example.com.br/caminho?x=1'), 'https://example.com.br/caminho?x=1');
  assert.equal(open('localhost:5173'), 'http://localhost:5173');
  assert.equal(open('http://intranet/x'), 'http://intranet/x');
  assert.equal(open('melhor navegador leve'), 'https://duckduckgo.com/?q=melhor%20navegador%20leve');
  assert.equal(open('gh'), 'https://duckduckgo.com/?q=gh');
  assert.equal(open('node.js'), 'https://node.js');
  assert.deepEqual(parseCommand('   ', SEARCH), { kind: 'empty' });
});

test('JWTs are decoded locally', () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'ação', exp: 1700000000 })}.c2ln`;
  const c = parseCommand(jwt, SEARCH);
  assert.equal(c.kind, 'jwt');
  if (c.kind !== 'jwt') return;
  assert.deepEqual(c.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(c.payload, { sub: 'ação', exp: 1700000000 });
  assert.equal(c.expires?.toISOString(), '2023-11-14T22:13:20.000Z');
});

test('Unix timestamps, in seconds or milliseconds', () => {
  const s = parseCommand('1700000000', SEARCH);
  assert.equal(s.kind === 'timestamp' && s.date.toISOString(), '2023-11-14T22:13:20.000Z');
  const ms = parseCommand('1700000000123', SEARCH);
  assert.equal(ms.kind === 'timestamp' && ms.unit, 'ms');
  assert.equal(parseCommand('12345', SEARCH).kind, 'open');
});
