import { localize, t } from '../lib/i18n.ts';
import { getSettings, setSettings, siteOf } from '../lib/settings.ts';

localize();

const siteEl = document.querySelector<HTMLElement>('#site')!;
const countEl = document.querySelector<HTMLElement>('#count')!;
const toggle = document.querySelector<HTMLInputElement>('#toggle')!;
const toggleRow = document.querySelector<HTMLElement>('#toggle-row')!;
const stats = document.querySelector<HTMLElement>('#stats')!;
const note = document.querySelector<HTMLElement>('#note')!;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteOf(tab?.url);
const settings = await getSettings();

if (!site || tab?.id === undefined) {
  siteEl.textContent = t('notAWebPage');
  toggleRow.hidden = true;
  stats.hidden = true;
} else {
  siteEl.textContent = site;
  toggle.checked = !settings.allowedSites.includes(site);
  const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
  countEl.textContent = String(rulesMatchedInfo.filter((m) => m.rule.rulesetId !== '_dynamic').length);

  toggle.addEventListener('change', async () => {
    const allowed = new Set((await getSettings()).allowedSites);
    if (toggle.checked) allowed.delete(site);
    else allowed.add(site);
    await setSettings({ allowedSites: [...allowed].sort() });
    note.textContent = t(toggle.checked ? 'reloadingOn' : 'reloadingOff');
    note.hidden = false;
    // The background applies the rule on the storage change; give it a beat.
    setTimeout(() => chrome.tabs.reload(tab.id!), 150);
  });
}
