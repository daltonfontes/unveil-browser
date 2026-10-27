// Unveil's shell service worker: keeps the blocking rules in step with the
// settings, and runs the sidebar (sidebar/service.ts). The rules themselves
// are static rulesets (rules/*.json, built from EasyList and EasyPrivacy by
// build.mjs), so blocking costs no JavaScript per request: Chromium matches
// them natively.

import { firstRunThisSession } from './lib/sessionStart.ts';
import { getSettings, RULESETS, type Settings } from './lib/settings.ts';
import { startPeek } from './peek/service.ts';
import { adoptOpenWindows, startSidebar } from './sidebar/service.ts';

// Above every list rule (abp2dnr.mjs PRIORITY), so a site switched off in the
// popup loads with nothing blocked or rewritten.
const ALLOW_SITE_PRIORITY = 100;

async function applyRulesets(settings: Settings) {
  const enable: string[] = [];
  const disable: string[] = [];
  for (const [id, key] of Object.entries(RULESETS)) {
    (settings[key] ? enable : disable).push(id);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enable,
    disableRulesetIds: disable,
  });
}

async function applyAllowedSites(settings: Settings) {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  // Two rules a site: allowAllRequests lifts blocking for the pages and frames
  // of the site, and an allow for whatever the site's pages request covers
  // the moments the first doesn't reach (Chromium ties it to the frame, and a
  // request can go out before that link is made).
  const addRules = settings.allowedSites.flatMap((site, i) => [
    {
      id: 2 * i + 1,
      priority: ALLOW_SITE_PRIORITY,
      action: { type: 'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType },
      condition: {
        requestDomains: [site],
        resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
      },
    },
    {
      id: 2 * i + 2,
      priority: ALLOW_SITE_PRIORITY,
      action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
      condition: { initiatorDomains: [site] },
    },
  ]);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((r) => r.id),
    addRules,
  });
}

// One at a time: two overlapping runs (startup and a settings change, say)
// could each read the dynamic rules before the other wrote them, and the
// later write would drop the earlier one's rules.
let applying: Promise<void> = Promise.resolve();
function apply() {
  const run = async () => {
    const settings = await getSettings();
    await Promise.all([applyRulesets(settings), applyAllowedSites(settings)]);
  };
  applying = applying.then(run, run);
  return applying;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  chrome.action.setBadgeBackgroundColor({ color: '#0d4f5c' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.some((k) => k === 'allowedSites' || (Object.values(RULESETS) as string[]).includes(k))) {
    void apply();
  }
});

startSidebar();
startPeek();

// A browser start, an install or an update (lib/sessionStart.ts).
void firstRunThisSession().then((first) => {
  if (!first) return;
  void apply();
  void adoptOpenWindows();
});
