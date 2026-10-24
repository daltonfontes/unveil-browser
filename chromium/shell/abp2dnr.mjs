// Converts Adblock Plus filter lists (EasyList, EasyPrivacy) into Chromium
// declarativeNetRequest rules, at build time.
//
// Only network filters are converted. Element hiding (##), scriptlets and the
// options DNR can't express ($csp, $redirect, $rewrite, $removeparam, regex
// filters...) are skipped, and counted, rather than approximated: a rule that
// blocks the wrong thing is worse than one that is missing.

const TYPES = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  other: 'other',
  document: 'main_frame',
  doc: 'main_frame',
};

// Options that change nothing for network blocking, so they are ignored.
const IGNORED = new Set(['match-case', 'important', 'all', 'collapse', 'genericblock']);

// Priorities: a block, then an exception (@@) over it, then $important blocks
// over exceptions. The shell's per-site switch (background.ts) sits above all.
export const PRIORITY = { block: 1, allow: 2, important: 3 };

const ASCII = /^[\x20-\x7e]*$/;

/** Parses one filter line. Returns a DNR rule (without id), or a skip reason. */
export function convertFilter(line) {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return { skip: 'comment' };
  if (/#[@?$%]?#|#\+js\(|\$\$/.test(line)) return { skip: 'cosmetic' };

  let allow = false;
  if (line.startsWith('@@')) {
    allow = true;
    line = line.slice(2);
  }

  // Regex filters (/.../) need DNR regex rules, which are limited and slow.
  if (/^\/.*\/(\$|$)/.test(line)) return { skip: 'regex' };

  let pattern = line;
  let options = [];
  const dollar = line.lastIndexOf('$');
  if (dollar !== -1) {
    pattern = line.slice(0, dollar);
    options = line.slice(dollar + 1).split(',').filter(Boolean);
  }

  const condition = {};
  const types = [];
  const excludedTypes = [];
  let important = false;
  let documentAllow = false;

  for (const raw of options) {
    const negated = raw.startsWith('~');
    const [name, value] = (negated ? raw.slice(1) : raw).split('=', 2);
    const key = name.toLowerCase();

    if (key === 'third-party' || key === '3p') {
      condition.domainType = negated ? 'firstParty' : 'thirdParty';
    } else if (key === 'first-party' || key === '1p') {
      condition.domainType = negated ? 'thirdParty' : 'firstParty';
    } else if (key === 'domain' || key === 'from') {
      if (!value) return { skip: 'bad-option' };
      const include = [];
      const exclude = [];
      for (const d of value.split('|')) {
        const domain = d.replace(/^~/, '').toLowerCase();
        // Entity matching (example.*) has no DNR equivalent.
        if (!domain || domain.endsWith('.*') || !ASCII.test(domain)) return { skip: 'domain' };
        (d.startsWith('~') ? exclude : include).push(domain);
      }
      if (include.length) condition.initiatorDomains = include;
      if (exclude.length) condition.excludedInitiatorDomains = exclude;
    } else if (key === 'match-case') {
      condition.isUrlFilterCaseSensitive = true;
    } else if (key === 'important') {
      important = true;
    } else if (key in TYPES) {
      if (key === 'document' || key === 'doc') {
        if (negated) return { skip: 'unsupported' };
        if (allow) documentAllow = true;
      }
      (negated ? excludedTypes : types).push(TYPES[key]);
    } else if (IGNORED.has(key)) {
      // Nothing to do.
    } else {
      // popup, csp, redirect, rewrite, removeparam, elemhide, generichide,
      // badfilter, sitekey, header, permissions... DNR can't say these.
      return { skip: key === 'popup' ? 'popup' : 'unsupported' };
    }
  }

  // Pattern to urlFilter.
  let urlFilter = pattern;
  if (!ASCII.test(urlFilter)) return { skip: 'non-ascii' };
  // A leading or trailing * adds nothing to a substring match.
  urlFilter = urlFilter.replace(/^\*+/, '').replace(/\*+$/, '');
  if (urlFilter.startsWith('||*')) urlFilter = urlFilter.slice(3);
  if (urlFilter === '' || urlFilter === '|' || urlFilter === '||') {
    // A filter with no pattern must be narrowed by its options, or it would
    // match every request.
    if (!condition.initiatorDomains && !condition.requestDomains) return { skip: 'too-broad' };
    urlFilter = '';
  }
  if (urlFilter) {
    // ||example.com^ with nothing more is a plain domain rule: requestDomains
    // is faster to match and is what Chromium recommends.
    const plain = /^\|\|([a-z0-9.-]+)\^?$/i.exec(urlFilter);
    if (plain && !condition.isUrlFilterCaseSensitive) {
      condition.requestDomains = [plain[1].toLowerCase()];
    } else {
      condition.urlFilter = urlFilter;
    }
  }

  if (types.length) condition.resourceTypes = [...new Set(types)];
  if (excludedTypes.length) condition.excludedResourceTypes = [...new Set(excludedTypes)];

  let action;
  let priority;
  if (allow) {
    // @@...$document lifts blocking for everything on that page.
    if (documentAllow) {
      action = { type: 'allowAllRequests' };
      condition.resourceTypes = ['main_frame', 'sub_frame'];
      delete condition.excludedResourceTypes;
    } else {
      action = { type: 'allow' };
    }
    priority = PRIORITY.allow;
  } else {
    action = { type: 'block' };
    priority = important ? PRIORITY.important : PRIORITY.block;
  }
  return { rule: { priority, action, condition } };
}

/**
 * Converts a whole list. Returns { rules, stats }; rule ids start at `firstId`.
 * Domain filters that differ only in their domain (most of EasyPrivacy's
 * ||tracker.example^) become one rule with many requestDomains, which is far
 * fewer rules for Chromium to index and match.
 */
export function convertList(text, firstId = 1) {
  const byShape = new Map();
  const stats = { filters: 0, rules: 0, skipped: {} };
  for (const line of text.split(/\r?\n/)) {
    const result = convertFilter(line);
    if (result.skip) {
      if (result.skip !== 'comment') stats.skipped[result.skip] = (stats.skipped[result.skip] ?? 0) + 1;
      continue;
    }
    stats.filters++;
    const { requestDomains, ...rest } = result.rule.condition;
    const shape = JSON.stringify({ ...result.rule, condition: rest, merge: !!requestDomains });
    const existing = byShape.get(shape);
    if (!existing) {
      byShape.set(shape, structuredClone(result.rule));
    } else if (requestDomains) {
      existing.condition.requestDomains.push(...requestDomains);
    }
    // else: a duplicate filter.
  }
  const rules = [...byShape.values()].map((rule, i) => {
    if (rule.condition.requestDomains) {
      rule.condition.requestDomains = [...new Set(rule.condition.requestDomains)].sort();
    }
    return { id: firstId + i, ...rule };
  });
  stats.rules = rules.length;
  return { rules, stats };
}
