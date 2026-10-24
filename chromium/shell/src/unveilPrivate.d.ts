// chrome.unveilPrivate: what Unveil's browser gives the shell (patch
// 0011-unveil-private-api, chrome/common/extensions/api/unveil_private.idl).
// Only in Unveil's own build: on a stock Chromium (the e2e tests, a dev
// build without the patches) it is undefined, and the shell does without.

declare namespace chrome.unveilPrivate {
  interface CreateTabOptions {
    windowId: number;
    /** Default: the new tab page. */
    url?: string;
    /** Default: true. */
    active?: boolean;
    /**
     * A Space's own storage partition (its cookies, logins and site data,
     * kept on disk): the Space's id. Default: the profile's own storage. The
     * tab stays in it across navigations, and the tabs it opens inherit it.
     */
    partition?: string;
  }
  /** tabs.create(), with a storage partition. Resolves to the tab's ID. */
  function createTab(options: CreateTabOptions): Promise<number>;
  /** The partition a tab is in: a Space's id, or "" (the profile's own). */
  function getTabPartition(tabId: number): Promise<string>;
  /** Removes everything in a Space's partition: cookies, storage, cache. */
  function clearPartition(partition: string): Promise<void>;
}
