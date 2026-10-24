// Unveil's sidebar, in the side panel of each window: favourites, the Space's
// pinned entries, its Today tabs, the archive and the Space switcher. It only
// draws and asks: every change goes to the service worker (service.ts) as a
// command, and the page redraws when the tabs or the stored state change.

import { parseCommand } from '../lib/commands.ts';
import { localize, t } from '../lib/i18n.ts';
import { getSettings, SEARCH_ENGINES } from '../lib/settings.ts';
import {
  ARCHIVE_CHOICES,
  getData,
  getSession,
  isDataChange,
  isSessionChange,
  searchArchive,
  sections,
  spaceOf,
  type Entry,
  type SessionData,
  type SidebarData,
  type Space,
} from '../lib/sidebarState.ts';
import { canSeparate, partitionFor } from '../lib/partitions.ts';
import { send } from './client.ts';

type Tab = chrome.tabs.Tab;

localize();

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const searchInput = $<HTMLInputElement>('#search');
const favoritesList = $<HTMLUListElement>('#favorites');
const pinnedList = $<HTMLUListElement>('#pinned');
const pinnedHint = $('#pinned-hint');
const todayList = $<HTMLUListElement>('#today');
const todaySection = $('#today-section');
const archiveSection = $('#archive-section');
const archiveList = $<HTMLUListElement>('#archive');
const archiveEmpty = $('#archive-empty');
const archiveHours = $<HTMLSelectElement>('#archive-hours');
const archiveToggle = $('#archive-toggle');
const spacesBar = $('#spaces');
const menu = $('#menu');
const dialog = $<HTMLDialogElement>('#space-dialog');

// The window this sidebar belongs to. ?window= lets tests open it in a tab.
const windowParam = new URLSearchParams(location.search).get('window');
const windowId = windowParam ? Number(windowParam) : (await chrome.windows.getCurrent()).id!;

let data: SidebarData;
let session: SessionData;
let tabs: Tab[] = [];
let showArchive = false;

const favicon = (url: string | undefined) =>
  url && /^https?:/.test(url)
    ? chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`)
    : chrome.runtime.getURL('icons/icon16.png');

const run = (command: Parameters<typeof send>[0]) => send(command).catch((e) => console.error(e));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function icon(url: string | undefined) {
  return el('img', { className: 'icon', src: favicon(url), alt: '', width: 16, height: 16 });
}

function closeButton(onClose: () => void, label: string) {
  const button = el('button', { className: 'close', textContent: '×', title: label });
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });
  return button;
}

const matches = (query: string, ...texts: (string | undefined)[]) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = texts.join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
};

// --- Rows -------------------------------------------------------------------

function tabRow(tab: Tab) {
  const row = el('li', { className: `row${tab.active ? ' active' : ''}`, draggable: true });
  row.dataset.tabId = String(tab.id);
  row.title = `${tab.title ?? ''}\n${tab.url ?? ''}`;
  row.append(icon(tab.url || tab.pendingUrl), el('span', { className: 'title', textContent: tab.title || tab.url || t('sidebarNewTab') }));
  if (tab.audible) row.append(el('span', { className: 'audio', textContent: tab.mutedInfo?.muted ? '🔇' : '🔊' }));
  row.append(closeButton(() => run({ type: 'close', tabId: tab.id! }), t('sidebarClose')));
  row.addEventListener('click', () => run({ type: 'activate', tabId: tab.id! }));
  row.addEventListener('auxclick', (e) => e.button === 1 && run({ type: 'close', tabId: tab.id! }));
  row.addEventListener('contextmenu', (e) => openMenu(e, tabMenu(tab)));
  dragSource(row, { tabId: tab.id! });
  return row;
}

function entryRow(entry: Entry, tab: Tab | undefined, kind: 'pinned' | 'favorite') {
  const active = !!tab?.active;
  const open = () => run({ type: 'openEntry', windowId, entryId: entry.id });
  const label = tab?.title || entry.title;
  if (kind === 'favorite') {
    const item = el('li');
    const button = el('button', { className: `favorite${active ? ' active' : ''}${tab ? '' : ' unloaded'}`, title: `${label}\n${entry.url}` });
    button.append(el('img', { src: favicon(entry.url), alt: label }));
    button.addEventListener('click', open);
    button.addEventListener('contextmenu', (e) => openMenu(e, entryMenu(entry, tab)));
    item.append(button);
    return item;
  }
  const row = el('li', { className: `row${active ? ' active' : ''}${tab ? '' : ' unloaded'}` });
  row.title = `${label}\n${tab?.url ?? entry.url}`;
  row.append(icon(entry.url), el('span', { className: 'title', textContent: label }));
  if (tab) row.append(closeButton(() => run({ type: 'unloadEntry', entryId: entry.id }), t('sidebarUnload')));
  row.addEventListener('click', open);
  row.addEventListener('contextmenu', (e) => openMenu(e, entryMenu(entry, tab)));
  return row;
}

// --- Menus ------------------------------------------------------------------

type MenuItem = { label: string; action: () => void } | 'separator' | { heading: string };

const inSplit = (tab: Tab) => tab.splitViewId !== undefined && tab.splitViewId >= 0;

function splitItems(tab: Tab): MenuItem[] {
  if (inSplit(tab)) return [{ label: t('sidebarUnsplit'), action: () => run({ type: 'unsplit', tabId: tab.id! }) }];
  return [tab.active
    ? { label: t('sidebarSplitNew'), action: () => run({ type: 'splitNew', windowId }) }
    : { label: t('sidebarSplitWithCurrent'), action: () => run({ type: 'split', windowId, tabId: tab.id! }) }];
}

function tabMenu(tab: Tab): MenuItem[] {
  const others = data.spaces.filter((s) => s.id !== spaceOf(data, session, windowId).id);
  return [
    ...splitItems(tab),
    'separator',
    { label: t('sidebarPin'), action: () => run({ type: 'pin', tabId: tab.id! }) },
    { label: t('sidebarAddFavorite'), action: () => run({ type: 'favorite', tabId: tab.id! }) },
    ...(others.length
      ? ['separator' as const, { heading: t('sidebarMoveTo') }, ...others.map((s) => ({
          label: `${s.emoji} ${s.name}`,
          action: () => run({ type: 'moveToSpace', tabId: tab.id!, spaceId: s.id }),
        }))]
      : []),
    'separator',
    { label: t('sidebarDuplicate'), action: () => void chrome.tabs.duplicate(tab.id!) },
    { label: t('sidebarCopyLink'), action: () => void navigator.clipboard.writeText(tab.url ?? '') },
    { label: tab.mutedInfo?.muted ? t('sidebarUnmute') : t('sidebarMute'), action: () => void chrome.tabs.update(tab.id!, { muted: !tab.mutedInfo?.muted }) },
    'separator',
    { label: t('sidebarClose'), action: () => run({ type: 'close', tabId: tab.id! }) },
  ];
}

function entryMenu(entry: Entry, tab: Tab | undefined): MenuItem[] {
  const isFavorite = data.favorites.some((f) => f.id === entry.id);
  return [
    { label: t(isFavorite ? 'sidebarRemoveFavorite' : 'sidebarUnpin'), action: () => run({ type: 'removeEntry', entryId: entry.id }) },
    { label: t('sidebarCopyLink'), action: () => void navigator.clipboard.writeText(entry.url) },
    ...(tab ? ['separator' as const, { label: t('sidebarUnload'), action: () => run({ type: 'unloadEntry', entryId: entry.id }) }] : []),
  ];
}

function spaceMenu(space: Space): MenuItem[] {
  return [
    { label: t('sidebarEditSpace'), action: () => editSpace(space) },
    ...(partitionFor(space)
      ? [{
          label: t('sidebarClearSpaceCookies'),
          action: () => {
            if (confirm(t('sidebarClearSpaceCookiesConfirm', space.name))) run({ type: 'clearSpaceCookies', spaceId: space.id });
          },
        }]
      : []),
    ...(data.spaces.length > 1 ? [{ label: t('sidebarDeleteSpace'), action: () => run({ type: 'deleteSpace', spaceId: space.id }) }] : []),
  ];
}

function openMenu(event: MouseEvent, items: MenuItem[]) {
  event.preventDefault();
  menu.replaceChildren(...items.map((item) => {
    if (item === 'separator') return el('hr');
    if ('heading' in item) return el('div', { className: 'label', textContent: item.heading });
    const button = el('button', { textContent: item.label });
    button.addEventListener('click', () => {
      closeMenu();
      item.action();
    });
    return button;
  }));
  menu.hidden = false;
  const { innerWidth, innerHeight } = window;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, innerWidth - width - 4)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - height - 4)}px`;
  menu.querySelector('button')?.focus();
}

function closeMenu() {
  menu.hidden = true;
}

document.addEventListener('click', (e) => !menu.contains(e.target as Node) && closeMenu());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
window.addEventListener('blur', closeMenu);

// --- Drag and drop ----------------------------------------------------------
// Drag a Today tab to reorder it, onto Pinned to pin it, or onto the
// favourites to make it a favourite.

let dragged: { tabId: number } | null = null;

function dragSource(row: HTMLElement, payload: { tabId: number }) {
  row.addEventListener('dragstart', (e) => {
    dragged = payload;
    row.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    dragged = null;
    row.classList.remove('dragging');
    document.querySelectorAll('.drop-before, .drop-target').forEach((n) => n.classList.remove('drop-before', 'drop-target'));
  });
  row.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    row.classList.add('drop-before');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = tabs.find((tab) => tab.id === Number(row.dataset.tabId));
    if (dragged && target && dragged.tabId !== target.id) run({ type: 'moveTab', tabId: dragged.tabId, toIndex: target.index });
  });
}

for (const zone of document.querySelectorAll<HTMLElement>('[data-drop]')) {
  zone.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    zone.classList.add('drop-target');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget as Node)) zone.classList.remove('drop-target');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-target');
    if (!dragged) return;
    run({ type: zone.dataset.drop === 'favorite' ? 'favorite' : 'pin', tabId: dragged.tabId });
  });
}

// --- Spaces -----------------------------------------------------------------

const HUES = [172, 210, 260, 320, 0, 28, 48, 100];
let editing: Space | null = null;
let chosenHue = HUES[0];

function drawHues() {
  $('#space-hues').replaceChildren(...HUES.map((hue) => {
    const button = el('button', { type: 'button' });
    button.style.setProperty('--h', String(hue));
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(hue === chosenHue));
    button.addEventListener('click', () => {
      chosenHue = hue;
      drawHues();
    });
    return button;
  }));
}

function editSpace(space: Space | null) {
  editing = space;
  chosenHue = space?.hue ?? HUES[data.spaces.length % HUES.length];
  $('#space-dialog-title').textContent = t(space ? 'sidebarEditSpace' : 'sidebarNewSpace');
  $<HTMLInputElement>('#space-name').value = space?.name ?? '';
  $<HTMLInputElement>('#space-emoji').value = space?.emoji ?? '✨';
  $('#space-delete').hidden = !space || data.spaces.length < 2;
  const separate = $<HTMLInputElement>('#space-separate');
  separate.checked = !!space?.separateCookies;
  separate.disabled = !canSeparate();
  $('#space-separate-hint').textContent = t(canSeparate() ? 'sidebarSeparateCookiesHint' : 'sidebarSeparateCookiesUnavailable');
  drawHues();
  dialog.showModal();
}

dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'save') return;
  const name = $<HTMLInputElement>('#space-name').value.trim();
  const emoji = $<HTMLInputElement>('#space-emoji').value.trim() || '✨';
  if (!name) return;
  const separateCookies = $<HTMLInputElement>('#space-separate').checked;
  if (editing) run({ type: 'editSpace', spaceId: editing.id, name, emoji, hue: chosenHue, separateCookies });
  else run({ type: 'addSpace', windowId, name, emoji, hue: chosenHue, separateCookies });
});
$('#space-delete').addEventListener('click', () => {
  if (editing) run({ type: 'deleteSpace', spaceId: editing.id });
  dialog.close();
});
$('#add-space').addEventListener('click', () => editSpace(null));

// --- The rest ---------------------------------------------------------------

$('#new-tab').addEventListener('click', () => run({ type: 'newTab', windowId }));
// The same toggle as Ctrl+Shift+S, which brings it back.
$('#collapse').addEventListener('click', () => run({ type: 'toggleSidebar', windowId }));

archiveToggle.addEventListener('click', () => {
  showArchive = !showArchive;
  render();
});
for (const hours of ARCHIVE_CHOICES) {
  archiveHours.add(new Option(hours ? t('sidebarArchiveHours', hours >= 48 ? t('sidebarDays', String(hours / 24)) : t('sidebarHours', String(hours))) : t('sidebarArchiveNever'), String(hours)));
}
archiveHours.addEventListener('change', () => run({ type: 'setArchiveHours', hours: Number(archiveHours.value) }));
$('#clear-archive').addEventListener('click', () => run({ type: 'clearArchive' }));

searchInput.addEventListener('input', () => render());
searchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    render();
    return;
  }
  if (e.key !== 'Enter') return;
  // The first match, else the query itself, read like the new tab page does.
  const first = document.querySelector<HTMLElement>('#sidebar .list .row, #favorites button');
  const query = searchInput.value;
  searchInput.value = '';
  if (first && query.trim()) {
    first.click();
  } else if (query.trim()) {
    const settings = await getSettings();
    const command = parseCommand(query, SEARCH_ENGINES[settings.searchEngine].url);
    if (command.kind === 'open') run({ type: 'newTab', windowId, url: command.url });
  }
  render();
});

function render() {
  const space = spaceOf(data, session, windowId);
  document.documentElement.style.setProperty('--hue', String(space.hue));
  const query = searchInput.value.trim();
  const { favorites, pinned, today } = sections(tabs, data, session, space.id);

  const favs = favorites.filter(({ entry, tab }) => !query || matches(query, entry.title, entry.url, tab?.title));
  favoritesList.replaceChildren(...favs.map(({ entry, tab }) => entryRow(entry, tab, 'favorite')));

  const pins = pinned.filter(({ entry, tab }) => !query || matches(query, entry.title, entry.url, tab?.title));
  pinnedList.replaceChildren(...pins.map(({ entry, tab }) => entryRow(entry, tab, 'pinned')));
  pinnedHint.hidden = pinned.length > 0 || !!query;

  const todays = today.filter((tab) => !query || matches(query, tab.title, tab.url));
  todayList.replaceChildren(...splitGroups(todays).map((group) => {
    if (group.length === 1) return tabRow(group[0]);
    // A split's two tabs share one row, left and right, like the window.
    const box = el('li', { className: `split-group${group.some((tab) => tab.active) ? ' active' : ''}` });
    box.append(...group.map(tabRow));
    return box;
  }));

  // The archive shows when asked for, and while searching (to find old tabs).
  const archived = query ? searchArchive(data.archive, query).slice(0, 30) : data.archive;
  const archiveVisible = showArchive || (!!query && archived.length > 0);
  archiveSection.hidden = !archiveVisible;
  todaySection.hidden = showArchive && !query;
  archiveToggle.classList.toggle('on', showArchive);
  if (archiveVisible) {
    archiveList.replaceChildren(...archived.map((item) => {
      const row = el('li', { className: 'row', title: `${item.title}\n${item.url}` });
      const when = new Date(item.closedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      row.append(icon(item.url), el('span', { className: 'title', textContent: item.title }), el('span', { className: 'when', textContent: when }));
      row.addEventListener('click', () => run({ type: 'reopenArchived', windowId, index: data.archive.indexOf(item) }));
      return row;
    }));
    archiveEmpty.hidden = archived.length > 0;
    archiveHours.value = String(data.archiveAfterHours);
  }

  spacesBar.replaceChildren(...data.spaces.map((s) => {
    const button = el('button', {
      className: `space${s.id === space.id ? ' current' : ''}${s.separateCookies ? ' separate' : ''}`,
      textContent: s.emoji,
      title: s.separateCookies ? `${s.name} · ${t('sidebarSeparateCookiesBadge')}` : s.name,
    });
    button.addEventListener('click', () => run({ type: 'switchSpace', windowId, spaceId: s.id }));
    button.addEventListener('dblclick', () => editSpace(s));
    button.addEventListener('contextmenu', (e) => openMenu(e, spaceMenu(s)));
    return button;
  }));
}

/** Today tabs in order, the two tabs of each split together. */
function splitGroups(list: Tab[]): Tab[][] {
  const groups: Tab[][] = [];
  for (const tab of list) {
    const last = groups.at(-1);
    if (last && inSplit(tab) && last[0].splitViewId === tab.splitViewId) last.push(tab);
    else groups.push([tab]);
  }
  return groups;
}

// Redraw on any change, batched: a page load alone sends a dozen tab updates.
// (A timer, not requestAnimationFrame, which stops while the panel is hidden.)
let pending = false;
function refresh() {
  if (pending) return;
  pending = true;
  setTimeout(async () => {
    pending = false;
    [data, session, tabs] = await Promise.all([getData(), getSession(), chrome.tabs.query({ windowId })]);
    render();
  }, 16);
}

chrome.storage.onChanged.addListener((changes) => {
  if (isDataChange(changes) || isSessionChange(changes)) void refresh();
});
for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated,
  chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached] as chrome.events.Event<() => void>[]) {
  event.addListener(() => void refresh());
}

[data, session, tabs] = await Promise.all([getData(), getSession(), chrome.tabs.query({ windowId })]);
render();
document.body.dataset.ready = 'true';
