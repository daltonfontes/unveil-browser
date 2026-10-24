// Added to the page a peek shows (service.ts): Esc closes the peek, and two
// small buttons in the corner open it as a tab or close it. In a shadow root,
// so the page's styles and the overlay's leave each other alone (open, so
// test/e2e can press the buttons).

declare global {
  interface Window {
    unveilPeekOverlay?: boolean;
  }
}

const send = (type: 'close' | 'promote') => chrome.runtime.sendMessage({ peek: { type } });

if (!window.unveilPeekOverlay) {
  window.unveilPeekOverlay = true;

  const host = document.createElement('unveil-peek');
  const root = host.attachShadow({ mode: 'open' });
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; top: 10px; right: 10px; z-index: 2147483647; }
      div { display: flex; gap: 4px; padding: 4px; border-radius: 10px;
        background: ${dark ? 'rgb(30 33 46 / .92)' : 'rgb(255 255 255 / .92)'};
        box-shadow: 0 2px 12px rgb(0 0 0 / .18), 0 0 0 1px rgb(0 0 0 / .08);
        font: 12px "Segoe UI", system-ui, sans-serif; }
      button { border: 0; border-radius: 7px; padding: 5px 9px; cursor: pointer; font: inherit;
        background: transparent; color: ${dark ? '#e8eaf3' : '#15182b'}; }
      button:hover { background: ${dark ? 'rgb(255 255 255 / .1)' : 'rgb(0 0 0 / .07)'}; }
    </style>
    <div>
      <button id="promote"></button>
      <button id="close" aria-label=""></button>
    </div>`;
  const promote = root.getElementById('promote')!;
  const close = root.getElementById('close')!;
  promote.textContent = `⤢ ${chrome.i18n.getMessage('peekOpenAsTab')}`;
  close.textContent = '✕';
  close.title = close.ariaLabel = chrome.i18n.getMessage('peekClose');
  promote.addEventListener('click', () => void send('promote'));
  close.addEventListener('click', () => void send('close'));
  document.documentElement.append(host);

  // "Open as tab": the page stays, the peek's controls go.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) void send('close');
  };
  document.addEventListener('keydown', onKey, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.peekOverlay !== 'remove') return;
    host.remove();
    document.removeEventListener('keydown', onKey, true);
  });
}

export {};
