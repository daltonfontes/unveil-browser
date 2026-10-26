// The sidebar's side in the service worker: the only writer of the sidebar
// state (sidebarState.ts), so windows' sidebars never overwrite each other.
// They send it SidebarCommands and redraw on storage changes.
//
// It also keeps the bookkeeping up to date as tabs come and go: a new tab
// joins its window's Space, switching to a tab of another Space (Ctrl+Tab)
// switches the window's Space, and Today tabs left alone archive themselves.
// Tabs of a Space with separate cookies open in its storage partition, and
// move to another partition when they change Space (reconcile()).

import {
  addToArchive,
  entryForUrl,
  forgetTab,
  getData,
  getSession,
  newId,
  spaceOf,
  tabsToArchive,
  updateData,
  updateSession,
  type Entry,
  type SidebarData,
} from '../lib/sidebarState.ts';
import { canReopen, canSeparate, clearSpace, createTabIn, openedByShell, partitionFor, tabPartition } from '../lib/partitions.ts';

export type SidebarCommand =
  | { type: 'activate'; tabId: number }
  | { type: 'close'; tabId: number }
  | { type: 'newTab'; windowId: number; url?: string }
  | { type: 'openEntry'; windowId: number; entryId: string }
  | { type: 'unloadEntry'; entryId: string }
  | { type: 'pin'; tabId: number }
  | { type: 'favorite'; tabId: number }
  | { type: 'removeEntry'; entryId: string }
  | { type: 'moveTab'; tabId: number; toIndex: number }
  | { type: 'moveToSpace'; tabId: number; spaceId: string }
  | { type: 'switchSpace'; windowId: number; spaceId: string }
  | { type: 'addSpace'; windowId: number; name: string; hue: number; separateCookies?: boolean }
  | { type: 'editSpace'; spaceId: string; name: string; hue: number; separateCookies?: boolean }
  | { type: 'deleteSpace'; spaceId: string }
  | { type: 'clearSpaceCookies'; spaceId: string }
  | { type: 'reopenArchived'; windowId: number; index: number }
  | { type: 'clearArchive' }
  | { type: 'setArchiveHours'; hours: number }
  | { type: 'archiveNow' }
  | { type: 'toggleSidebar'; windowId: number }
  | { type: 'split'; windowId: number; tabId: number }
  | { type: 'splitNew'; windowId: number }
  | { type: 'unsplit'; tabId: number };

const ARCHIVE_ALARM = 'unveil-archive';

const isNormal = async (windowId: number) => {
  try {
    return (await chrome.windows.get(windowId)).type === 'normal';
  } catch {
    return false;
  }
};

// Windows whose sidebar is open, kept in memory so the toggle shortcut can
// decide at once: sidePanel.open() must run within the key press (on a stock
// Chromium; patch 0009 lifts that for the shell), so nothing may be awaited
// before it. chrome.storage.session keeps it across service worker restarts.
const OPEN_KEY = 'sidebarOpenWindows';
const openWindows = new Set<number>();
void chrome.storage.session.get(OPEN_KEY).then(({ [OPEN_KEY]: ids }) => {
  for (const id of (ids as number[] | undefined) ?? []) openWindows.add(id);
});
function setOpen(windowId: number, open: boolean) {
  if (open) openWindows.add(windowId);
  else openWindows.delete(windowId);
  void chrome.storage.session.set({ [OPEN_KEY]: [...openWindows] });
}

/** Shows or hides a window's sidebar (Ctrl+Shift+S). */
function toggleSidebar(windowId: number) {
  if (openWindows.has(windowId)) {
    void chrome.sidePanel.close({ windowId }).catch(() => setOpen(windowId, false));
  } else {
    void openSidebar(windowId);
  }
}

/** Opens the sidebar in a window (patch 0009 lets the shell do it unasked). */
async function openSidebar(windowId: number) {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch {
    // Without patch 0009 (a stock Chromium), this needs a click: the toolbar
    // button's menu has "Open side panel".
  }
}

// Split view is Chromium's own (chrome.tabs.createSplit): two tabs side by side,
// both on screen whenever either is active. They must be next to each other in
// the same window, and not already in another split.
const inSplit = (tab: chrome.tabs.Tab) => tab.splitViewId !== undefined && tab.splitViewId >= 0;

async function activeTab(windowId: number) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

/** The window's active tab and `tabId`, side by side, `tabId` on the right. */
async function splitWithActive(windowId: number, tabId: number) {
  const current = await activeTab(windowId);
  const activeId = current?.id;
  if (activeId === undefined || activeId === tabId) return splitWithNewTab(windowId);
  for (const tab of [current, await chrome.tabs.get(tabId)]) {
    if (inSplit(tab)) await chrome.tabs.unsplit(tab.splitViewId!);
  }
  const active = await chrome.tabs.get(activeId);
  const other = await chrome.tabs.get(tabId);
  // Right after the active tab. (Moving a tab from before it shifts it left.)
  const index = other.windowId === windowId && other.index < active.index ? active.index : active.index + 1;
  // Both halves belong to the active tab's Space, and so to its partition.
  const session = await getSession();
  const spaceId = session.tabSpace[activeId] ?? (await windowSpaceId(windowId));
  await updateSession((s) => {
    s.tabSpace[tabId] = spaceId;
  });
  const half = (await reconcile([tabId])).get(tabId) ?? tabId;
  await chrome.tabs.move(half, { windowId, index });
  await chrome.tabs.createSplit([activeId, half]);
}

/** The active tab and a new tab (the new tab page) beside it. */
async function splitWithNewTab(windowId: number) {
  const active = await activeTab(windowId);
  if (!active?.id) return;
  if (inSplit(active)) await chrome.tabs.unsplit(active.splitViewId!);
  const data = await getData();
  const spaceId = (await getSession()).tabSpace[active.id] ?? (await windowSpaceId(windowId));
  const partition = partitionFor(data.spaces.find((s) => s.id === spaceId));
  if (!partition) {
    await chrome.tabs.create({ windowId, splitWithTabId: active.id, active: true });
    return;
  }
  // unveilPrivate.createTab() has no splitWithTabId: open it, then split.
  const tabId = await openInSpace(windowId, spaceId);
  await chrome.tabs.move(tabId, { windowId, index: active.index + 1 });
  await chrome.tabs.createSplit([active.id, tabId]);
}

/** Opens a tab in a Space: in its storage partition, and in its bookkeeping. */
async function openInSpace(windowId: number, spaceId: string, url?: string, entryId?: string) {
  const space = (await getData()).spaces.find((s) => s.id === spaceId);
  const tabId = await createTabIn({ windowId, url, active: true }, partitionFor(space));
  await updateSession((s) => {
    s.tabSpace[tabId] = spaceId;
    if (entryId) s.tabEntry[tabId] = entryId;
  });
  return tabId;
}

const NEW_TAB_URLS = ['chrome://newtab', chrome.runtime.getURL('newtab.html')];

// One reconcile() at a time, so a tab isn't reopened twice.
let reconciling: Promise<unknown> = Promise.resolve();

/**
 * Tabs in another partition than their Space's are closed and opened again
 * in the right one, at the same place and address (a tab can't change
 * partition). Resolves to the new tab of each one reopened, by old ID. Tabs
 * in a split stay, as do pages that can't open again (chrome:// pages).
 */
function reconcile(tabIds: number[]): Promise<Map<number, number>> {
  const run = reconciling.then(async () => {
    const reopened = new Map<number, number>();
    if (!canSeparate() || !tabIds.length) return reopened;
    const data = await getData();
    const session = await getSession();
    for (const tabId of tabIds) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!tab || inSplit(tab) || !(await isNormal(tab.windowId))) continue;
      const space = data.spaces.find((s) => s.id === session.tabSpace[tabId]) ?? data.spaces[0];
      const want = partitionFor(space);
      const have = await tabPartition(tabId);
      const url = tab.url || tab.pendingUrl;
      if (have === undefined || have === want || !canReopen(url, NEW_TAB_URLS)) continue;
      const start = !url || NEW_TAB_URLS.some((u) => url.startsWith(u));
      const id = await createTabIn({ windowId: tab.windowId, url: start ? undefined : url, active: tab.active }, want);
      await chrome.tabs.move(id, { index: tab.index }).catch(() => {});
      await updateSession((s) => {
        s.tabSpace[id] = space.id;
        if (s.tabEntry[tabId]) s.tabEntry[id] = s.tabEntry[tabId];
        s.lastActive[id] = s.lastActive[tabId] ?? Date.now();
      });
      await chrome.tabs.remove(tabId).catch(() => {});
      reopened.set(tabId, id);
    }
    return reopened;
  });
  reconciling = run.catch(() => {});
  return run;
}

/** Every open tab of a Space. */
async function tabsOfSpace(spaceId: string) {
  const data = await getData();
  const session = await getSession();
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs.filter((t) => t.id !== undefined && (session.tabSpace[t.id] ?? data.spaces[0].id) === spaceId).map((t) => t.id!);
}

async function windowSpaceId(windowId: number) {
  return spaceOf(await getData(), await getSession(), windowId).id;
}

async function openEntry(windowId: number, entryId: string) {
  const data = await getData();
  const session = await getSession();
  const entry = [...data.favorites, ...Object.values(data.pinned).flat()].find((e) => e.id === entryId);
  if (!entry) return;
  const open = Object.entries(session.tabEntry).find(([, id]) => id === entryId);
  if (open) {
    try {
      const tab = await chrome.tabs.update(Number(open[0]), { active: true });
      if (tab?.windowId !== undefined && tab.windowId !== windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      // The tab is gone: open a new one below.
    }
  }
  await openInSpace(windowId, spaceOf(data, session, windowId).id, entry.url, entryId);
}

/** An entry from a tab: its URL and title as they are now. */
async function entryFromTab(tabId: number): Promise<Entry | undefined> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || tab.pendingUrl;
  if (!url) return undefined;
  return { id: newId(), url, title: tab.title || url };
}

async function archive(force = false) {
  const data = await getData();
  const session = await getSession();
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const old = force
    ? tabs.filter((t) => !t.active && t.id !== undefined && !session.tabEntry[t.id])
    : tabsToArchive(tabs, session, data.archiveAfterHours, Date.now());
  if (!old.length) return;
  const now = Date.now();
  await updateData((d) => {
    d.archive = addToArchive(d.archive, old.map((t) => ({
      url: t.url ?? '',
      title: t.title ?? t.url ?? '',
      spaceId: session.tabSpace[t.id!] ?? d.spaces[0].id,
      closedAt: now,
    })));
  });
  await chrome.tabs.remove(old.map((t) => t.id!));
}

async function run(command: SidebarCommand): Promise<unknown> {
  switch (command.type) {
    case 'activate': {
      const tab = await chrome.tabs.update(command.tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
    case 'close':
      return chrome.tabs.remove(command.tabId);
    case 'newTab':
      return openInSpace(command.windowId, await windowSpaceId(command.windowId), command.url);
    case 'openEntry':
      return openEntry(command.windowId, command.entryId);
    case 'unloadEntry': {
      // Closing a favourite or pinned entry closes its tab; the entry stays.
      const session = await getSession();
      const tabIds = Object.entries(session.tabEntry).filter(([, id]) => id === command.entryId).map(([t]) => Number(t));
      return tabIds.length ? chrome.tabs.remove(tabIds) : undefined;
    }
    case 'pin':
    case 'favorite': {
      const entry = await entryFromTab(command.tabId);
      if (!entry) return;
      const tab = await chrome.tabs.get(command.tabId);
      const spaceId = (await getSession()).tabSpace[command.tabId] ?? (await windowSpaceId(tab.windowId));
      await updateData((d) => {
        if (command.type === 'favorite') d.favorites.push(entry);
        else (d.pinned[spaceId] ??= []).push(entry);
      });
      return updateSession((s) => {
        s.tabEntry[command.tabId] = entry.id;
      });
    }
    case 'removeEntry': {
      // Unpin or unfavourite: an open tab stays, as a Today tab.
      await updateData((d) => {
        d.favorites = d.favorites.filter((e) => e.id !== command.entryId);
        for (const space of Object.keys(d.pinned)) {
          d.pinned[space] = d.pinned[space].filter((e) => e.id !== command.entryId);
        }
      });
      return updateSession((s) => {
        for (const [tabId, entryId] of Object.entries(s.tabEntry)) {
          if (entryId === command.entryId) delete s.tabEntry[tabId];
        }
      });
    }
    case 'moveTab':
      return chrome.tabs.move(command.tabId, { index: command.toIndex });
    case 'moveToSpace':
      await updateSession((s) => {
        s.tabSpace[command.tabId] = command.spaceId;
      });
      return reconcile([command.tabId]);
    case 'switchSpace': {
      await updateSession((s) => {
        s.windowSpace[command.windowId] = command.spaceId;
      });
      // Show the Space's most recent tab, or a new tab if it has none.
      const session = await getSession();
      const tabs = await chrome.tabs.query({ windowId: command.windowId });
      const firstSpace = (await getData()).spaces[0].id;
      const mine = tabs.filter((t) => (session.tabSpace[t.id!] ?? firstSpace) === command.spaceId);
      if (mine.some((t) => t.active)) return;
      mine.sort((a, b) => (session.lastActive[b.id!] ?? 0) - (session.lastActive[a.id!] ?? 0));
      return mine.length
        ? chrome.tabs.update(mine[0].id!, { active: true })
        : run({ type: 'newTab', windowId: command.windowId });
    }
    case 'addSpace': {
      const id = newId();
      await updateData((d) => {
        d.spaces.push({ id, name: command.name, hue: command.hue, separateCookies: !!command.separateCookies });
      });
      return run({ type: 'switchSpace', windowId: command.windowId, spaceId: id });
    }
    case 'editSpace': {
      const { name, hue, separateCookies } = command;
      await updateData((d) => {
        const space = d.spaces.find((s) => s.id === command.spaceId);
        if (space) Object.assign(space, { name, hue, ...(separateCookies === undefined ? {} : { separateCookies }) });
      });
      // Separate cookies on or off: its tabs open again in the other partition.
      return reconcile(await tabsOfSpace(command.spaceId));
    }
    case 'deleteSpace': {
      // Its tabs move to the first Space, and its pinned entries go.
      const data = await getData();
      if (data.spaces.length < 2) return;
      await updateData((d) => {
        d.spaces = d.spaces.filter((s) => s.id !== command.spaceId);
        delete d.pinned[command.spaceId];
      });
      const first = (await getData()).spaces[0].id;
      const moved: number[] = [];
      await updateSession((s) => {
        for (const [tabId, spaceId] of Object.entries(s.tabSpace)) {
          if (spaceId !== command.spaceId) continue;
          s.tabSpace[tabId] = first;
          moved.push(Number(tabId));
        }
        for (const [windowId, spaceId] of Object.entries(s.windowSpace)) {
          if (spaceId === command.spaceId) s.windowSpace[windowId] = first;
        }
      });
      // Its tabs open again in the first Space's partition; its own goes.
      await reconcile(moved);
      return clearSpace(command.spaceId);
    }
    case 'clearSpaceCookies': {
      // "Sign out of this Space": everything sites stored in it goes, and its
      // pages load again without it.
      await clearSpace(command.spaceId);
      for (const tabId of await tabsOfSpace(command.spaceId)) {
        if ((await tabPartition(tabId)) === command.spaceId) await chrome.tabs.reload(tabId).catch(() => {});
      }
      return;
    }
    case 'reopenArchived': {
      const data = await getData();
      const item = data.archive[command.index];
      if (!item) return;
      await updateData((d) => {
        d.archive.splice(command.index, 1);
      });
      return run({ type: 'newTab', windowId: command.windowId, url: item.url });
    }
    case 'clearArchive':
      return updateData((d) => {
        d.archive = [];
      });
    case 'setArchiveHours':
      return updateData((d) => {
        d.archiveAfterHours = command.hours;
      });
    case 'archiveNow':
      return archive(true);
    case 'toggleSidebar':
      return toggleSidebar(command.windowId);
    case 'split':
      return splitWithActive(command.windowId, command.tabId);
    case 'splitNew':
      return splitWithNewTab(command.windowId);
    case 'unsplit': {
      const tab = await chrome.tabs.get(command.tabId);
      return inSplit(tab) ? chrome.tabs.unsplit(tab.splitViewId!) : undefined;
    }
  }
}

/** Binds open tabs to entries by URL and gives every tab a Space and a time. */
async function adoptOpenTabs(data: SidebarData) {
  const tabs = await chrome.tabs.query({});
  const entries = [...data.favorites, ...Object.values(data.pinned).flat()];
  const pinnedSpace = new Map(Object.entries(data.pinned).flatMap(([space, list]) => list.map((e) => [e.id, space])));
  const now = Date.now();
  await updateSession((s) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const entry = entryForUrl(entries, tab.url);
      if (entry && !Object.values(s.tabEntry).includes(entry.id)) s.tabEntry[tab.id] = entry.id;
      s.tabSpace[tab.id] ??= (entry && pinnedSpace.get(entry.id)) ?? s.windowSpace[tab.windowId] ?? data.spaces[0].id;
      s.lastActive[tab.id] ??= now;
    }
  });
  for (const window of await chrome.windows.getAll({ windowTypes: ['normal'] })) {
    if (window.id !== undefined) await openSidebar(window.id);
  }
  // Restored tabs open in the profile's storage: those of a Space with
  // separate cookies go back to its partition.
  await reconcile(tabs.map((t) => t.id!).filter((id) => id !== undefined));
}

export function startSidebar() {
  void chrome.sidePanel.setOptions({ path: 'sidebar.html', enabled: true });
  void chrome.alarms.create(ARCHIVE_ALARM, { periodInMinutes: 10 });

  chrome.runtime.onStartup.addListener(async () => adoptOpenTabs(await getData()));
  chrome.runtime.onInstalled.addListener(async () => adoptOpenTabs(await getData()));

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ARCHIVE_ALARM) void archive();
  });

  chrome.windows.onCreated.addListener((window) => {
    if (window.type === 'normal' && window.id !== undefined) void openSidebar(window.id);
  });
  chrome.sidePanel.onOpened.addListener(({ windowId }) => setOpen(windowId, true));
  chrome.sidePanel.onClosed.addListener(({ windowId }) => setOpen(windowId, false));
  chrome.windows.onRemoved.addListener((windowId) => {
    setOpen(windowId, false);
    void updateSession((s) => {
      delete s.windowSpace[windowId];
    });
  });

  chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.id === undefined || !(await isNormal(tab.windowId))) return;
    const data = await getData();
    // A link opened from a tab stays in that tab's Space.
    await updateSession((s) => {
      const opener = tab.openerTabId === undefined ? undefined : s.tabSpace[tab.openerTabId];
      s.tabSpace[tab.id!] ??= opener ?? spaceOf(data, s, tab.windowId).id;
      s.lastActive[tab.id!] = Date.now();
    });
    // A tab the browser opened on its own (Ctrl+T, a restored tab) is in the
    // profile's storage: in a Space with separate cookies, it opens again in
    // the Space's. A link's tab is in its page's partition already (patch 0012).
    if (tab.openerTabId === undefined && canSeparate() && !(await openedByShell(tab.id))) void reconcile([tab.id]);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void updateSession((s) => forgetTab(s, tabId));
  });
  chrome.tabs.onAttached.addListener(async (tabId, { newWindowId }) => {
    // A tab dragged into another window joins that window's Space.
    const data = await getData();
    await updateSession((s) => {
      s.tabSpace[tabId] = spaceOf(data, s, newWindowId).id;
    });
    void reconcile([tabId]);
  });
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    const data = await getData();
    void updateSession((s) => {
      s.lastActive[tabId] = Date.now();
      // Ctrl+Tab and friends can reach a tab of another Space: follow it.
      const space = s.tabSpace[tabId];
      if (space && data.spaces.some((sp) => sp.id === space)) s.windowSpace[windowId] = space;
    });
  });

  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command === 'toggle-sidebar') {
      // No await before toggling: see openWindows.
      if (tab?.windowId !== undefined) toggleSidebar(tab.windowId);
      else void chrome.windows.getLastFocused().then((w) => w.id !== undefined && toggleSidebar(w.id));
      return;
    }
    if (command === 'split-view') {
      // Alt+Shift+S: split the current tab with a new one, or end its split.
      const windowId = tab?.windowId ?? (await chrome.windows.getLastFocused()).id;
      if (windowId === undefined) return;
      const active = await activeTab(windowId);
      if (active && inSplit(active)) await chrome.tabs.unsplit(active.splitViewId!);
      else await splitWithNewTab(windowId);
      return;
    }
    if (command !== 'next-space' && command !== 'previous-space') return;
    const windowId = tab?.windowId ?? (await chrome.windows.getLastFocused()).id;
    if (windowId === undefined) return;
    const data = await getData();
    const current = data.spaces.indexOf(spaceOf(data, await getSession(), windowId));
    const step = command === 'next-space' ? 1 : -1;
    const next = data.spaces[(current + step + data.spaces.length) % data.spaces.length];
    void run({ type: 'switchSpace', windowId, spaceId: next.id });
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // Only the shell's own pages (the sidebar) may drive the sidebar.
    if (sender.id !== chrome.runtime.id || !message?.sidebar) return;
    run(message.sidebar as SidebarCommand).then(
      () => reply({ ok: true }),
      (error) => reply({ ok: false, error: String(error) }),
    );
    return true;
  });
}
