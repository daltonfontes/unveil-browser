// Unveil's shell service worker: keeps the blocking rules in step with the
// settings. The rules themselves are static rulesets (rules/*.json, built from
// EasyList and EasyPrivacy by scripts/build.mjs), so blocking costs no
// JavaScript per request: Chromium matches them natively.

import { getSettings, RULESETS, type Settings } from './lib/settings.ts';

// Above every list rule (scripts/abp2dnr.mjs PRIORITY), so a site switched off
// in the popup loads with nothing blocked or rewritten.
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
  const addRules = settings.allowedSites.map((site, i) => ({
    id: i + 1,
    priority: ALLOW_SITE_PRIORITY,
    action: { type: 'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      requestDomains: [site],
      resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
    },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((r) => r.id),
    addRules,
  });
}

async function apply() {
  const settings = await getSettings();
  await Promise.all([applyRulesets(settings), applyAllowedSites(settings)]);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  chrome.action.setBadgeBackgroundColor({ color: '#0d4f5c' });
  void apply();
});

chrome.runtime.onStartup.addListener(() => void apply());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.some((k) => k === 'allowedSites' || (Object.values(RULESETS) as string[]).includes(k))) {
    void apply();
  }
});
