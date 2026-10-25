// The sidebar's model: Spaces, favourites, pinned entries and the archive, kept
// in chrome.storage.local, and which tab belongs where, kept in
// chrome.storage.session (tab IDs don't survive a restart). The background and
// every window's sidebar read and write it through here.
//
// The functions on plain data (sections, tabsToArchive, entryForUrl...) are
// pure, so test/unit/sidebarState.test.ts runs them in Node.

export interface Space {
  id: string;
  name: string;
  emoji: string;
  /** A hue in degrees: the sidebar is tinted with it. */
  hue: number;
  /** Its tabs have cookies and logins of their own (lib/partitions.ts). */
  separateCookies?: boolean;
}

/** A favourite (every Space) or a pinned entry (one Space): a saved page. */
export interface Entry {
  id: string;
  url: string;
  title: string;
}

export interface ArchivedTab {
  url: string;
  title: string;
  spaceId: string;
  closedAt: number;
}

export interface SidebarData {
  spaces: Space[];
  favorites: Entry[];
  /** Space ID -> its pinned entries, in order. */
  pinned: Record<string, Entry[]>;
  archive: ArchivedTab[];
  /** Today tabs untouched this long are archived; 0 = never. */
  archiveAfterHours: number;
}

/** What tab IDs mean this session. */
export interface SessionData {
  /** Window ID -> the Space it shows. */
  windowSpace: Record<string, string>;
  /** Tab ID -> its Space. */
  tabSpace: Record<string, string>;
  /** Tab ID -> the favourite or pinned entry it is open for. */
  tabEntry: Record<string, string>;
  /** Tab ID -> when it was last the active tab (ms). */
  lastActive: Record<string, number>;
}

export const ARCHIVE_LIMIT = 500;
export const ARCHIVE_CHOICES = [12, 24, 24 * 7, 24 * 30, 0];

export const DEFAULT_DATA: SidebarData = {
  spaces: [{ id: 'personal', name: 'Pessoal', emoji: '🏠', hue: 172 }],
  favorites: [],
  pinned: {},
  archive: [],
  archiveAfterHours: 12,
};

export const EMPTY_SESSION: SessionData = { windowSpace: {}, tabSpace: {}, tabEntry: {}, lastActive: {} };

const DATA_KEY = 'sidebar';
const SESSION_KEY = 'sidebarSession';

export async function getData(): Promise<SidebarData> {
  const { [DATA_KEY]: stored } = await chrome.storage.local.get(DATA_KEY);
  return { ...DEFAULT_DATA, ...(stored as Partial<SidebarData> | undefined) };
}

export async function getSession(): Promise<SessionData> {
  const { [SESSION_KEY]: stored } = await chrome.storage.session.get(SESSION_KEY);
  return { ...EMPTY_SESSION, ...(stored as Partial<SessionData> | undefined) };
}

// Read-modify-write, serialized within this page or worker so two quick
// changes don't overwrite each other. (Pages in other windows write rarely
// and on user actions; the background owns the busy session writes.)
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function updateData(change: (data: SidebarData) => void): Promise<SidebarData> {
  return serialize(async () => {
    const data = await getData();
    change(data);
    await chrome.storage.local.set({ [DATA_KEY]: data });
    return data;
  });
}

export function updateSession(change: (session: SessionData) => void): Promise<SessionData> {
  return serialize(async () => {
    const session = await getSession();
    change(session);
    await chrome.storage.session.set({ [SESSION_KEY]: session });
    return session;
  });
}

export const isDataChange = (changes: Record<string, unknown>) => DATA_KEY in changes;
export const isSessionChange = (changes: Record<string, unknown>) => SESSION_KEY in changes;

export const newId = () => crypto.randomUUID().slice(0, 8);

/** The Space a window shows: its own, else the first. */
export function spaceOf(data: SidebarData, session: SessionData, windowId: number): Space {
  const id = session.windowSpace[windowId];
  return data.spaces.find((s) => s.id === id) ?? data.spaces[0];
}

/** Page URLs compare without the fragment: #section doesn't make a new page. */
export function samePage(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.split('#')[0] === b.split('#')[0];
}

export function entryForUrl(entries: Entry[], url: string | undefined): Entry | undefined {
  return entries.find((e) => samePage(e.url, url));
}

export interface TabLike {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  active?: boolean;
  audible?: boolean;
  index: number;
}

export interface Sections<T extends TabLike> {
  favorites: { entry: Entry; tab?: T }[];
  pinned: { entry: Entry; tab?: T }[];
  today: T[];
}

/**
 * What a window's sidebar shows for its Space: favourites and pinned entries
 * with their open tab if any, then the Space's other tabs (Today), in tab
 * order. Tabs of other Spaces are left out: they stay open, out of sight.
 */
export function sections<T extends TabLike>(
  tabs: T[],
  data: SidebarData,
  session: SessionData,
  spaceId: string,
): Sections<T> {
  const byEntry = new Map<string, T>();
  for (const tab of tabs) {
    const entryId = tab.id === undefined ? undefined : session.tabEntry[tab.id];
    if (entryId && !byEntry.has(entryId)) byEntry.set(entryId, tab);
  }
  const shown = new Set<T>(byEntry.values());
  const pinnedEntries = data.pinned[spaceId] ?? [];
  const spaces = new Set(data.spaces.map((s) => s.id));
  const firstSpace = data.spaces[0]?.id;
  return {
    favorites: data.favorites.map((entry) => ({ entry, tab: byEntry.get(entry.id) })),
    pinned: pinnedEntries.map((entry) => ({ entry, tab: byEntry.get(entry.id) })),
    today: tabs
      .filter((tab) => {
        if (shown.has(tab) || tab.id === undefined) return false;
        // A tab with no Space, or one whose Space was deleted, shows in the first.
        const own = session.tabSpace[tab.id];
        const space = own && spaces.has(own) ? own : firstSpace;
        return space === spaceId;
      })
      .sort((a, b) => a.index - b.index),
  };
}

/**
 * Today tabs to archive: not active, not playing sound, not open for a
 * favourite or pinned entry, and untouched for `hours`.
 */
export function tabsToArchive<T extends TabLike>(tabs: T[], session: SessionData, hours: number, now: number): T[] {
  if (!hours) return [];
  const limit = hours * 60 * 60 * 1000;
  return tabs.filter((tab) => {
    if (tab.id === undefined || tab.active || tab.audible || session.tabEntry[tab.id]) return false;
    const last = session.lastActive[tab.id];
    return last !== undefined && now - last >= limit;
  });
}

/** Adds archived tabs, newest first, capped. */
export function addToArchive(archive: ArchivedTab[], tabs: ArchivedTab[]): ArchivedTab[] {
  const web = tabs.filter((t) => /^https?:/.test(t.url));
  return [...web, ...archive].slice(0, ARCHIVE_LIMIT);
}

export function searchArchive(archive: ArchivedTab[], query: string): ArchivedTab[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return archive;
  return archive.filter((t) => {
    const text = `${t.title} ${t.url}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Removes a tab's session bookkeeping (it closed). */
export function forgetTab(session: SessionData, tabId: number) {
  delete session.tabSpace[tabId];
  delete session.tabEntry[tabId];
  delete session.lastActive[tabId];
}
