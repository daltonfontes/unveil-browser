import { localize, t } from '../lib/i18n.ts';
import { getSettings, setSettings, SEARCH_ENGINES, type SearchEngine, type Settings } from '../lib/settings.ts';

localize();

const allowed = document.querySelector<HTMLUListElement>('#allowed')!;
const engine = document.querySelector<HTMLSelectElement>('#engine')!;

for (const [id, { name }] of Object.entries(SEARCH_ENGINES)) engine.add(new Option(name, id));
engine.addEventListener('change', () => setSettings({ searchEngine: engine.value as SearchEngine }));

for (const box of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
  box.addEventListener('change', () => setSettings({ [box.dataset.setting!]: box.checked }));
}

function renderAllowed(sites: string[]) {
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('noAllowedSites');
    allowed.replaceChildren(li);
    return;
  }
  allowed.replaceChildren(
    ...sites.map((site) => {
      const li = document.createElement('li');
      const remove = document.createElement('button');
      remove.textContent = t('turnProtectionBackOn');
      remove.addEventListener('click', () => setSettings({ allowedSites: sites.filter((s) => s !== site) }));
      li.append(site, remove);
      return li;
    }),
  );
}

function render(settings: Settings) {
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
    box.checked = Boolean(settings[box.dataset.setting as keyof Settings]);
  }
  engine.value = settings.searchEngine;
  renderAllowed(settings.allowedSites);
}

render(await getSettings());
chrome.storage.onChanged.addListener(async () => render(await getSettings()));
