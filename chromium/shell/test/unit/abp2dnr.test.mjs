import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertFilter, convertList, PRIORITY } from '../../abp2dnr.mjs';

const rule = (line) => convertFilter(line).rule;
const skip = (line) => convertFilter(line).skip;

test('a plain domain filter becomes requestDomains', () => {
  assert.deepEqual(rule('||ads.example.com^'), {
    priority: PRIORITY.block,
    action: { type: 'block' },
    condition: { requestDomains: ['ads.example.com'] },
  });
});

test('paths keep urlFilter, with anchors', () => {
  assert.equal(rule('||example.com/ads/*.js').condition.urlFilter, '||example.com/ads/*.js');
  assert.equal(rule('/banner/ad-').condition.urlFilter, '/banner/ad-');
  assert.equal(rule('*/adframe.*').condition.urlFilter, '/adframe.');
});

test('options: party, types, domains', () => {
  const r = rule('||track.example^$script,third-party,domain=a.com|~b.a.com');
  assert.equal(r.condition.domainType, 'thirdParty');
  assert.deepEqual(r.condition.resourceTypes, ['script']);
  assert.deepEqual(r.condition.initiatorDomains, ['a.com']);
  assert.deepEqual(r.condition.excludedInitiatorDomains, ['b.a.com']);
  assert.deepEqual(rule('/ad.$~image,~third-party').condition, {
    urlFilter: '/ad.', domainType: 'firstParty', excludedResourceTypes: ['image'],
  });
  assert.deepEqual(rule('||x.com^$subdocument,xhr').condition.resourceTypes, ['sub_frame', 'xmlhttprequest']);
});

test('exceptions outrank blocks, $important outranks exceptions', () => {
  const allow = rule('@@||cdn.example.com/ads.js$script');
  assert.equal(allow.action.type, 'allow');
  assert.ok(allow.priority > PRIORITY.block);
  assert.ok(rule('||x.com^$important').priority > allow.priority);
  const page = rule('@@||intranet.example^$document');
  assert.equal(page.action.type, 'allowAllRequests');
  assert.deepEqual(page.condition.resourceTypes, ['main_frame', 'sub_frame']);
});

test('what DNR cannot say is skipped, not approximated', () => {
  assert.equal(skip('! comment'), 'comment');
  assert.equal(skip('[Adblock Plus 2.0]'), 'comment');
  assert.equal(skip('example.com##.ad'), 'cosmetic');
  assert.equal(skip('example.com#@#.ad'), 'cosmetic');
  assert.equal(skip('example.com#?#div:has(.ad)'), 'cosmetic');
  assert.equal(skip('/^https?:\\/\\/ads\\./$script'), 'regex');
  assert.equal(skip('||popunder.example^$popup'), 'popup');
  assert.equal(skip('||x.com^$csp=script-src none'), 'unsupported');
  assert.equal(skip('||x.com^$redirect=noopjs'), 'unsupported');
  assert.equal(skip('@@||x.com^$generichide'), 'unsupported');
  assert.equal(skip('||x.com^$domain=example.*'), 'domain');
  assert.equal(skip('$third-party'), 'too-broad');
  assert.equal(skip('||пример.рф^'), 'non-ascii');
});

test('convertList merges domain rules and drops duplicates', () => {
  const { rules, stats } = convertList([
    '[Adblock Plus 2.0]',
    '||a.com^', '||b.com^', '||a.com^',
    '||c.com^$third-party', '||d.com^$third-party',
    '/ads.js', '/ads.js',
    'example.com##.ad',
  ].join('\n'), 10);
  assert.deepEqual(rules.map((r) => r.id), [10, 11, 12]);
  assert.deepEqual(rules[0].condition, { requestDomains: ['a.com', 'b.com'] });
  assert.deepEqual(rules[1].condition, { domainType: 'thirdParty', requestDomains: ['c.com', 'd.com'] });
  assert.deepEqual(rules[2].condition, { urlFilter: '/ads.js' });
  assert.equal(stats.filters, 7);
  assert.equal(stats.rules, 3);
  assert.deepEqual(stats.skipped, { cosmetic: 1 });
});
