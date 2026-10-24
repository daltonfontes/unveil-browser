// The new tab page's command box: what a typed line means. Pure functions, so
// test/unit/commands.test.ts can run them in Node.
//
//   gh owner/repo     GitHub repo          gh <words>   GitHub search
//   npm <package>     npm package          mdn <words>  MDN search
//   caniuse <words>   Can I use            so <words>   Stack Overflow search
//   example.com, localhost:3000            open it
//   eyJ...            a JWT, decoded here (never sent anywhere)
//   1700000000        a Unix timestamp (s or ms), as a date
//   anything else     search with the chosen engine

export type Command =
  | { kind: 'open'; url: string; label: string }
  | { kind: 'jwt'; header: unknown; payload: unknown; expires: Date | null }
  | { kind: 'timestamp'; date: Date; unit: 's' | 'ms' }
  | { kind: 'empty' };

const q = encodeURIComponent;

const PREFIXES: Record<string, (rest: string) => { url: string; label: string }> = {
  gh: (rest) =>
    /^[\w.-]+\/[\w.-]+$/.test(rest)
      ? { url: `https://github.com/${rest}`, label: `GitHub: ${rest}` }
      : { url: `https://github.com/search?q=${q(rest)}`, label: `GitHub: ${rest}` },
  npm: (rest) => ({ url: `https://www.npmjs.com/package/${rest.replace(/\s+/g, '')}`, label: `npm: ${rest}` }),
  mdn: (rest) => ({ url: `https://developer.mozilla.org/search?q=${q(rest)}`, label: `MDN: ${rest}` }),
  caniuse: (rest) => ({ url: `https://caniuse.com/?search=${q(rest)}`, label: `Can I use: ${rest}` }),
  so: (rest) => ({ url: `https://stackoverflow.com/search?q=${q(rest)}`, label: `Stack Overflow: ${rest}` }),
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;
const HOST_LIKE = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
const JWT = /^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/;

function decodeBase64Url(part: string): unknown {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function parseCommand(input: string, searchUrl: string): Command {
  const text = input.trim();
  if (!text) return { kind: 'empty' };

  if (JWT.test(text)) {
    try {
      const [header, payload] = text.split('.').slice(0, 2).map(decodeBase64Url);
      const exp = (payload as { exp?: unknown })?.exp;
      return { kind: 'jwt', header, payload, expires: typeof exp === 'number' ? new Date(exp * 1000) : null };
    } catch {
      // Not a JWT after all: fall through to search.
    }
  }

  if (/^\d{10}$/.test(text)) return { kind: 'timestamp', date: new Date(Number(text) * 1000), unit: 's' };
  if (/^\d{13}$/.test(text)) return { kind: 'timestamp', date: new Date(Number(text)), unit: 'ms' };

  const space = text.indexOf(' ');
  if (space > 0) {
    const prefix = PREFIXES[text.slice(0, space).toLowerCase()];
    const rest = text.slice(space + 1).trim();
    if (prefix && rest) return { kind: 'open', ...prefix(rest) };
  }

  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'open', url: text, label: text };
  if (LOCAL_HOST.test(text)) return { kind: 'open', url: `http://${text}`, label: text };
  if (HOST_LIKE.test(text)) return { kind: 'open', url: `https://${text}`, label: text };

  return { kind: 'open', url: searchUrl.replace('%s', q(text)), label: text };
}
