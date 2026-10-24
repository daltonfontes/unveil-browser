// Unveil's settings, kept in chrome.storage.local. Every page reads them
// through here so the defaults live in one place.

export type SearchEngine = 'duckduckgo' | 'brave' | 'startpage' | 'ecosia' | 'kagi' | 'bing' | 'google';

export interface Settings {
  /** EasyList: ads. */
  blockAds: boolean;
  /** EasyPrivacy: trackers, analytics, fingerprinting scripts. */
  blockTrackers: boolean;
  /** Strip utm_*, fbclid, gclid... from the links you open. */
  stripTrackingParams: boolean;
  /** Sites where blocking is off (hostnames, e.g. "example.com"). */
  allowedSites: string[];
  /** The search engine of the new tab page's command box. */
  searchEngine: SearchEngine;
}

export const DEFAULTS: Settings = {
  blockAds: true,
  blockTrackers: true,
  stripTrackingParams: true,
  allowedSites: [],
  searchEngine: 'duckduckgo',
};

export const SEARCH_ENGINES: Record<SearchEngine, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
};

/** The static rulesets in manifest.json, and the setting that turns each on. */
export const RULESETS = {
  easylist: 'blockAds',
  easyprivacy: 'blockTrackers',
  tracking_params: 'stripTrackingParams',
} as const satisfies Record<string, keyof Settings>;

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function setSettings(changes: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(changes);
}

/** "https://www.example.com/a" -> "example.com"; null for non-web pages. */
export function siteOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
