// Query parameters that only exist to track you across sites. The
// tracking_params ruleset removes them from pages you open (main and sub
// frames), with a redirect that rewrites only the query.

export const TRACKING_PARAMS = [
  // Campaign tags (Google Analytics and everyone who copied them)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_name', 'utm_brand', 'utm_social', 'utm_social-type',
  'ga_source', 'ga_medium', 'ga_campaign', 'ga_term', 'ga_content',
  // Ad click IDs
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'twclid', 'ttclid', 'li_fat_id', 'rb_clickid', 'wickedid', 'igshid',
  // Email and marketing automation
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsCtaTracking',
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_conv', 'vero_id', 's_cid', '_openstat',
];

/**
 * One rule per parameter and position (?p= or &p=): plain urlFilters match
 * quickly and need none of the regex rule budget. The redirect strips every
 * listed parameter at once, so a URL with several is rewritten only once.
 */
export function trackingParamRules() {
  const action = { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: TRACKING_PARAMS } } } };
  return TRACKING_PARAMS.flatMap((param) => [`?${param}=`, `&${param}=`]).map((urlFilter, i) => ({
    id: i + 1,
    priority: 1,
    action,
    condition: { urlFilter, resourceTypes: ['main_frame', 'sub_frame'] },
  }));
}
