// Peek, as in Flecha: a link opens in a floating window over the current one
// instead of a new tab. Esc or a click back in the window behind closes it;
// "Open as tab" keeps it as a tab of that window.
//
// Flecha draws Peek inside its own window frame (native code). Unveil uses a
// popup window, sized and centred over its window, with two small controls
// (overlay.ts) added to the page. What peeks:
// - links that open a new tab from a pinned tab or a favourite (the setting
//   peekFromPinned), unless opened in the background (Ctrl+click, middle
//   click);
// - any link, from its right-click menu: "Open in Peek".

import { getSettings } from '../lib/settings.ts';
import { peekBounds } from './bounds.ts';
import { getSession, updateSession } from '../lib/sidebarState.ts';

export type PeekCommand =
  | { type: 'open'; url: string; windowId: number; spaceId?: string }
  | { type: 'close' }
  | { type: 'promote' };

interface Peek {
  /** The window behind it, where "Open as tab" puts the tab. */
  parentWindowId: number;
  tabId: number;
  /** The Space the peeked link came from. */
  spaceId?: string;
  /** Whether it has had the focus: only then does focus behind close it. */
  focused?: boolean;
  /** When it opened (ms). */
  openedAt: number;
}

const MENU_ID = 'unveil-peek-link';
const STORE_KEY = 'peeks';
const FOCUS_GRACE_MS = 800;

// Open peeks, by peek window ID. chrome.storage.session keeps them across
// service worker restarts, so an old peek's buttons and Esc still work.
const peeks = new Map<number, Peek>();
const loaded = chrome.storage.session.get(STORE_KEY).then(({ [STORE_KEY]: stored }) => {
  for (const [id, peek] of Object.entries((stored as Record<string, Peek> | undefined) ?? {})) peeks.set(Number(id), peek);
});
function save() {
  void chrome.storage.session.set({ [STORE_KEY]: Object.fromEntries(peeks) });
}

const isWebUrl = (url: string | undefined) => !!url && /^https?:/.test(url);


export async function openPeek(url: string, parentWindowId: number, spaceId?: string) {
  if (!isWebUrl(url)) return;
  // One peek at a time per window: a new one replaces the old.
  for (const [windowId, peek] of peeks) {
    if (peek.parentWindowId === parentWindowId) await closePeek(windowId);
  }
  const parent = await chrome.windows.get(parentWindowId);
  const bounds = peekBounds({ left: parent.left ?? 0, top: parent.top ?? 0, width: parent.width ?? 1200, height: parent.height ?? 800 });
  const created = await chrome.windows.create({ url, type: 'popup', focused: true, ...bounds });
  const tabId = created?.tabs?.[0]?.id;
  if (created?.id === undefined || tabId === undefined) return;
  peeks.set(created.id, { parentWindowId, tabId, spaceId, openedAt: Date.now() });
  save();
  return created.id;
}

async function closePeek(windowId: number) {
  peeks.delete(windowId);
  save();
  await chrome.windows.remove(windowId).catch(() => {});
}

/** The peeked page becomes a tab of the window behind it, in its Space. */
async function promotePeek(windowId: number) {
  const peek = peeks.get(windowId);
  if (!peek) return;
  peeks.delete(windowId);
  save();
  // The page stays as it is, without the peek's buttons.
  await chrome.tabs.sendMessage(peek.tabId, { peekOverlay: 'remove' }).catch(() => {});
  await chrome.tabs.move(peek.tabId, { windowId: peek.parentWindowId, index: -1 });
  await chrome.tabs.update(peek.tabId, { active: true });
  await chrome.windows.update(peek.parentWindowId, { focused: true });
  if (peek.spaceId) {
    await updateSession((s) => {
      s.tabSpace[peek.tabId] = peek.spaceId!;
    });
  }
}

/** The peek a tab is showing, if it is one. */
function peekOfTab(tabId: number | undefined): number | undefined {
  for (const [windowId, peek] of peeks) if (peek.tabId === tabId) return windowId;
  return undefined;
}

export function startPeek() {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('peekOpenLink'),
      contexts: ['link'],
      targetUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.linkUrl || tab?.windowId === undefined) return;
    // A link inside a peek peeks in its place, over the same window.
    const parent = peeks.get(tab.windowId)?.parentWindowId ?? tab.windowId;
    const spaceId = tab.id === undefined ? undefined : (await getSession()).tabSpace[tab.id];
    await openPeek(info.linkUrl, parent, spaceId);
  });

  // A link from a pinned tab or a favourite that opens a new tab peeks instead.
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.id === undefined || tab.openerTabId === undefined || !tab.active) return;
    const [settings, session] = await Promise.all([getSettings(), getSession()]);
    if (!settings.peekFromPinned || !session.tabEntry[tab.openerTabId]) return;
    const url = tab.pendingUrl || tab.url || (await urlOnceKnown(tab.id));
    if (!isWebUrl(url)) return;
    await chrome.tabs.remove(tab.id).catch(() => {});
    await openPeek(url!, tab.windowId, session.tabSpace[tab.openerTabId]);
  });

  // Esc and the overlay's buttons (overlay.ts).
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    const command = message?.peek as PeekCommand | undefined;
    if (!command || sender.id !== chrome.runtime.id) return;
    const run = async () => {
      await loaded;
      if (command.type === 'open') return openPeek(command.url, command.windowId, command.spaceId);
      const windowId = peekOfTab(sender.tab?.id);
      if (windowId === undefined) return;
      return command.type === 'promote' ? promotePeek(windowId) : closePeek(windowId);
    };
    run().then((result) => reply({ ok: true, result }), (error) => reply({ ok: false, error: String(error) }));
    return true;
  });

  // The controls go into every page the peek shows.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete' || peekOfTab(tabId) === undefined) return;
    void chrome.scripting.executeScript({ target: { tabId }, files: ['peek-overlay.js'] }).catch(() => {});
  });

  // A click back in the window behind closes the peek. Only once the peek has
  // had the focus, and not in its first moments: the click on the link that
  // opened it can report the window behind as focused after the peek is
  // already there, later still on a busy machine.
  chrome.windows.onFocusChanged.addListener((focused) => {
    const own = peeks.get(focused);
    if (own && !own.focused) {
      own.focused = true;
      save();
    }
    for (const [windowId, peek] of peeks) {
      if (focused === peek.parentWindowId && peek.focused && Date.now() - peek.openedAt > FOCUS_GRACE_MS) {
        void closePeek(windowId);
      }
    }
  });
  chrome.windows.onRemoved.addListener((windowId) => {
    if (peeks.delete(windowId)) save();
    for (const [peekWindow, peek] of peeks) {
      if (peek.parentWindowId === windowId) void closePeek(peekWindow);
    }
  });
}

/** A new tab's URL, which a link click may only report after creating it. */
function urlOnceKnown(tabId: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(undefined), 2000);
    const listener = (id: number, info: { url?: string }) => {
      if (id === tabId && info.url) done(info.url);
    };
    function done(url: string | undefined) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(url);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
