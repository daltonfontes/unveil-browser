import { parseCommand, type Command } from '../lib/commands.ts';
import { localize, t } from '../lib/i18n.ts';
import { getSettings, SEARCH_ENGINES } from '../lib/settings.ts';

localize();

const form = document.querySelector<HTMLFormElement>('#command')!;
const input = document.querySelector<HTMLInputElement>('#input')!;
const result = document.querySelector<HTMLElement>('#result')!;
const protection = document.querySelector<HTMLAnchorElement>('#protection')!;

const settings = await getSettings();
const searchUrl = SEARCH_ENGINES[settings.searchEngine].url;

const on = settings.blockAds || settings.blockTrackers;
protection.textContent = t(on ? 'protectionOn' : 'protectionOff');
protection.classList.toggle('off', !on);

function section(title: string, body: string) {
  const h = document.createElement('h2');
  h.textContent = title;
  const pre = document.createElement('pre');
  pre.textContent = body;
  return [h, pre];
}

function show(command: Command) {
  result.replaceChildren();
  if (command.kind === 'jwt') {
    result.append(
      ...section(t('jwtHeader'), JSON.stringify(command.header, null, 2)),
      ...section(t('jwtPayload'), JSON.stringify(command.payload, null, 2)),
    );
    if (command.expires) {
      const expired = command.expires.getTime() < Date.now();
      result.append(...section(t(expired ? 'jwtExpired' : 'jwtExpires'), command.expires.toLocaleString()));
    }
  } else if (command.kind === 'timestamp') {
    result.append(
      ...section(t('timestampLocal'), command.date.toLocaleString()),
      ...section('UTC (ISO 8601)', command.date.toISOString()),
    );
  }
  result.hidden = result.childElementCount === 0;
}

input.addEventListener('input', () => show(parseCommand(input.value, searchUrl)));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = parseCommand(input.value, searchUrl);
  if (command.kind === 'open') location.href = command.url;
  else show(command);
});

input.focus();
