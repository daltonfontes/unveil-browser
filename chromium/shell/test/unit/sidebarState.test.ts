import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addToArchive,
  ARCHIVE_LIMIT,
  DEFAULT_DATA,
  EMPTY_SESSION,
  entryForUrl,
  searchArchive,
  sections,
  spaceOf,
  tabsToArchive,
  type SessionData,
  type SidebarData,
} from '../../src/lib/sidebarState.ts';

const HOUR = 60 * 60 * 1000;
const data: SidebarData = {
  ...DEFAULT_DATA,
  spaces: [{ id: 'home', name: 'Home', hue: 1 }, { id: 'work', name: 'Work', hue: 2 }],
  favorites: [{ id: 'f1', url: 'https://mail.example/', title: 'Mail' }],
  pinned: { work: [{ id: 'p1', url: 'https://github.com/', title: 'GitHub' }] },
};
const session = (s: Partial<SessionData> = {}): SessionData => structuredClone({ ...EMPTY_SESSION, ...s });
const tab = (id: number, index: number, extra = {}) => ({ id, index, url: `https://site${id}.example/`, title: `Tab ${id}`, ...extra });

test('sections: entries get their open tab, Today shows only this Space, in tab order', () => {
  const tabs = [tab(1, 3), tab(2, 0), tab(3, 1), tab(4, 2)];
  const s = session({ tabSpace: { 1: 'work', 2: 'work', 3: 'home', 4: 'work' }, tabEntry: { 4: 'p1', 3: 'f1' } });
  const work = sections(tabs, data, s, 'work');
  assert.deepEqual(work.favorites.map((f) => [f.entry.id, f.tab?.id]), [['f1', 3]]);
  assert.deepEqual(work.pinned.map((p) => [p.entry.id, p.tab?.id]), [['p1', 4]]);
  assert.deepEqual(work.today.map((t) => t.id), [2, 1]);
  assert.deepEqual(sections(tabs, data, s, 'home').today.map((t) => t.id), []);
  assert.deepEqual(sections(tabs, data, s, 'home').pinned, []);
});

test('sections: tabs with no Space, or a deleted one, show in the first Space', () => {
  const tabs = [tab(1, 0), tab(2, 1)];
  const s = session({ tabSpace: { 2: 'gone' } });
  assert.deepEqual(sections(tabs, data, s, 'home').today.map((t) => t.id), [1, 2]);
  assert.deepEqual(sections(tabs, data, s, 'work').today, []);
});

test('spaceOf: the window\'s own Space, else the first', () => {
  assert.equal(spaceOf(data, session({ windowSpace: { 7: 'work' } }), 7).id, 'work');
  assert.equal(spaceOf(data, session(), 7).id, 'home');
  assert.equal(spaceOf(data, session({ windowSpace: { 7: 'gone' } }), 7).id, 'home');
});

test('tabsToArchive: old, inactive, silent, unsaved tabs only', () => {
  const now = 100 * HOUR;
  const tabs = [
    tab(1, 0),
    tab(2, 1, { active: true }),
    tab(3, 2, { audible: true }),
    tab(4, 3),
    tab(5, 4),
    tab(6, 5),
  ];
  const s = session({
    tabEntry: { 4: 'p1' },
    lastActive: { 1: now - 13 * HOUR, 2: 0, 3: 0, 4: 0, 5: now - 11 * HOUR },
  });
  assert.deepEqual(tabsToArchive(tabs, s, 12, now).map((t) => t.id), [1]);
  assert.deepEqual(tabsToArchive(tabs, s, 0, now), []);
});

test('archive: newest first, web pages only, capped, searchable', () => {
  const item = (url: string, title = url) => ({ url, title, spaceId: 'home', closedAt: 1 });
  const old = Array.from({ length: ARCHIVE_LIMIT }, (_, i) => item(`https://old${i}.example/`));
  const next = addToArchive(old, [item('https://new.example/', 'Novo Relatório'), item('chrome://settings/')]);
  assert.equal(next.length, ARCHIVE_LIMIT);
  assert.equal(next[0].url, 'https://new.example/');
  assert.ok(!next.some((t) => t.url.startsWith('chrome:')));
  assert.deepEqual(searchArchive(next, 'novo relat').map((t) => t.url), ['https://new.example/']);
  assert.equal(searchArchive(next, '  ').length, ARCHIVE_LIMIT);
});

test('entryForUrl ignores the fragment', () => {
  assert.equal(entryForUrl(data.pinned.work, 'https://github.com/#readme')?.id, 'p1');
  assert.equal(entryForUrl(data.pinned.work, 'https://github.com/x'), undefined);
});
