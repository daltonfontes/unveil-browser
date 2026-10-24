// Fills [data-i18n] elements (text) and [data-i18n-placeholder] (placeholder)
// from _locales/*/messages.json.
export const t = (key: string, ...subs: string[]) => chrome.i18n.getMessage(key, subs) || key;

export function localize(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  }
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
