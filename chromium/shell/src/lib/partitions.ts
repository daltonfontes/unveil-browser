// Spaces with separate cookies, as in Flecha: the tabs of such a Space live
// in a storage partition of their own, named after the Space, so you can be
// signed in to one account in one Space and another account in another. The
// other Spaces share the profile's storage. The browser does the partitions
// (patches 0011 and 0012, chrome.unveilPrivate); this decides which one each
// tab belongs in, and opens tabs there.
//
// A tab can't change partition, so a tab whose Space changes partition (it
// moved, its Space was deleted or got separate cookies) is closed and opened
// again in the right one (sidebar/service.ts reconcile()).

import type { Space } from './sidebarState.ts';

/** Whether this browser has the partitions (Unveil's build, not a stock Chromium). */
export const canSeparate = () => typeof chrome.unveilPrivate?.createTab === 'function';

/** The partition a Space's tabs belong in: its id if it has separate cookies, else "". */
export function partitionFor(space: Space | undefined, separate = canSeparate()): string {
  return separate && space?.separateCookies ? space.id : '';
}

/** Pages that can open again elsewhere: web pages and the new tab page. */
export function canReopen(url: string | undefined, newTabUrls: string[]): boolean {
  if (!url) return true;
  return /^https?:/.test(url) || newTabUrls.some((u) => url.startsWith(u));
}

// Tabs the shell opened itself. tabs.onCreated can fire before createTab()
// answers, so a listener waits for the creates in flight before asking.
const inflight = new Set<Promise<number>>();
const ours = new Set<number>();

export interface NewTab {
  windowId: number;
  url?: string;
  active?: boolean;
}

/** Opens a tab in a partition ("" = the profile's own storage). Resolves to its ID. */
export async function createTabIn(options: NewTab, partition: string): Promise<number> {
  const created = partition && canSeparate()
    ? chrome.unveilPrivate.createTab({ ...options, partition })
    : chrome.tabs.create(options).then((tab) => tab.id!);
  inflight.add(created);
  try {
    const id = await created;
    ours.add(id);
    return id;
  } finally {
    inflight.delete(created);
  }
}

/** Whether the shell opened this tab itself (then it is in the right partition). */
export async function openedByShell(tabId: number): Promise<boolean> {
  await Promise.allSettled([...inflight]);
  return ours.delete(tabId);
}

/** The partition a tab is in, or undefined if it can't tell. */
export async function tabPartition(tabId: number): Promise<string | undefined> {
  if (!canSeparate()) return undefined;
  return chrome.unveilPrivate.getTabPartition(tabId).catch(() => undefined);
}

/** Signs out of everything in a Space: its partition's cookies, storage and cache. */
export async function clearSpace(spaceId: string) {
  if (canSeparate()) await chrome.unveilPrivate.clearPartition(spaceId).catch(() => {});
}
