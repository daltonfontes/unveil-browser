// The sidebar's side in the service worker: the only writer of the sidebar
// state (sidebarState.ts), so windows' sidebars never overwrite each other.
// They send it SidebarCommands and redraw on storage changes.
//
// It also keeps the bookkeeping up to date as tabs come and go: a new tab
// joins its window's Space, switching to a tab of another Space (Ctrl+Tab)
// switches the window's Space, and Today tabs left alone archive themselves.

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
  | { type: 'addSpace'; windowId: number; name: string; emoji: string; hue: number }
  | { type: 'editSpace'; spaceId: string; name: string; emoji: string; hue: number }
  | { type: 'deleteSpace'; spaceId: string }
  | { type: 'reopenArchived'; windowId: number; index: number }
  | { type: 'clearArchive' }
  | { type: 'setArchiveHours'; hours: number }
  | { type: 'archiveNow' }
  | { type: 'toggleSidebar'; windowId: number };

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
  const tab = await chrome.tabs.create({ windowId, url: entry.url, active: true });
  const spaceId = spaceOf(data, session, windowId).id;
  await updateSession((s) => {
    s.tabEntry[tab.id!] = entryId;
    s.tabSpace[tab.id!] = spaceId;
  });
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
    case 'newTab': {
      const tab = await chrome.tabs.create({ windowId: command.windowId, url: command.url, active: true });
      const spaceId = await windowSpaceId(command.windowId);
      return updateSession((s) => {
        s.tabSpace[tab.id!] = spaceId;
      });
    }
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
      return updateSession((s) => {
        s.tabSpace[command.tabId] = command.spaceId;
      });
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
        d.spaces.push({ id, name: command.name, emoji: command.emoji, hue: command.hue });
      });
      return run({ type: 'switchSpace', windowId: command.windowId, spaceId: id });
    }
    case 'editSpace':
      return updateData((d) => {
        const space = d.spaces.find((s) => s.id === command.spaceId);
        if (space) Object.assign(space, { name: command.name, emoji: command.emoji, hue: command.hue });
      });
    case 'deleteSpace': {
      // Its tabs move to the first Space, and its pinned entries go.
      const data = await getData();
      if (data.spaces.length < 2) return;
      await updateData((d) => {
        d.spaces = d.spaces.filter((s) => s.id !== command.spaceId);
        delete d.pinned[command.spaceId];
      });
      const first = (await getData()).spaces[0].id;
      return updateSession((s) => {
        for (const [tabId, spaceId] of Object.entries(s.tabSpace)) {
          if (spaceId === command.spaceId) s.tabSpace[tabId] = first;
        }
        for (const [windowId, spaceId] of Object.entries(s.windowSpace)) {
          if (spaceId === command.spaceId) s.windowSpace[windowId] = first;
        }
      });
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
    void updateSession((s) => {
      const opener = tab.openerTabId === undefined ? undefined : s.tabSpace[tab.openerTabId];
      s.tabSpace[tab.id!] ??= opener ?? spaceOf(data, s, tab.windowId).id;
      s.lastActive[tab.id!] = Date.now();
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void updateSession((s) => forgetTab(s, tabId));
  });
  chrome.tabs.onAttached.addListener(async (tabId, { newWindowId }) => {
    // A tab dragged into another window joins that window's Space.
    const data = await getData();
    void updateSession((s) => {
      s.tabSpace[tabId] = spaceOf(data, s, newWindowId).id;
    });
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
