// Parameter allowlist per endpoint and per filter.type.
// WHY: the Qloo API silently ignores parameters that are not valid for a filter.type
// (hackathon developer guide). A silently ignored filter returns plausible but wrong data,
// so we refuse (strict) or flag (lenient) anything not documented.
// Sources: docs.qloo.com "available-parameters-by-entity-type", "parameters", "heatmaps-use-case",
// "demographics-use-case", "taste-analysis", "get-search", "get-tags", "get-trending", "analysis-compare".
// See TECH.md section 3 for the reasoning behind each list.

const SIGNALS = [
  'signal.interests.entities', 'signal.interests.tags', 'operator.signal.interests.tags',
  'signal.demographics.age', 'signal.demographics.gender',
  'signal.demographics.audiences', 'signal.demographics.audiences.weight',
  // signal.location.* is documented for all ten entity types (parameters reference, Signals tab)
  'signal.location', 'signal.location.query', 'signal.location.radius',
];
const ENTITY_COMMON = [
  'filter.type', ...SIGNALS, 'bias.trends',
  'filter.tags', 'operator.filter.tags',
  'filter.exclude.tags', 'operator.exclude.tags', 'operator.filter.exclude.tags',
  'filter.exclude.entities', 'filter.results.entities', 'filter.results.entities.query',
  'filter.popularity.min', 'filter.popularity.max', 'filter.parents.types',
  'filter.external.exists', 'operator.filter.external.exists',
  'feature.explainability', 'take', 'page', 'offset',
];
const GEO = [
  'filter.location', 'filter.location.query', 'filter.location.radius',
  'filter.location.geohash', 'filter.exclude.location.geohash', 'filter.exclude.location',
  'filter.geocode.name', 'filter.geocode.admin1_region', 'filter.geocode.admin2_region',
  'filter.geocode.country_code', 'diversify.by', 'diversify.take',
];

const INSIGHTS_BY_TYPE = {
  'urn:entity:artist': ENTITY_COMMON,
  'urn:entity:brand': ENTITY_COMMON,
  'urn:entity:podcast': ENTITY_COMMON,
  'urn:entity:videogame': ENTITY_COMMON,
  'urn:entity:book': [...ENTITY_COMMON, 'filter.publication_year.min', 'filter.publication_year.max'],
  'urn:entity:person': [...ENTITY_COMMON, 'filter.gender', 'filter.date_of_birth.min', 'filter.date_of_birth.max',
    'filter.date_of_death.min', 'filter.date_of_death.max'],
  'urn:entity:movie': [...ENTITY_COMMON, 'filter.content_rating', 'filter.release_year.min', 'filter.release_year.max',
    'filter.release_country', 'operator.filter.release_country', 'filter.rating.min', 'filter.rating.max'],
  'urn:entity:tv_show': [...ENTITY_COMMON, 'filter.content_rating', 'filter.release_year.min', 'filter.release_year.max',
    'filter.finale_year.min', 'filter.finale_year.max', 'filter.latest_known_year.min', 'filter.latest_known_year.max',
    'filter.release_country', 'operator.filter.release_country', 'filter.rating.min', 'filter.rating.max'],
  'urn:entity:destination': [...ENTITY_COMMON, ...GEO],
  'urn:entity:place': [...ENTITY_COMMON, ...GEO, 'bias.quality', 'filter.address', 'filter.hours',
    'filter.price_level.min', 'filter.price_level.max', 'filter.price_range.from', 'filter.price_range.to',
    'filter.hotel_class.min', 'filter.hotel_class.max',
    'filter.properties.business_rating.min', 'filter.properties.business_rating.max',
    'filter.references_brand', 'sort_by'],
  'urn:heatmap': ['filter.type', 'filter.location', 'filter.location.query', 'filter.location.radius',
    'heatmap.dimensions', 'filter.dimensions.hotel_class', 'filter.dimensions.price_level',
    'output.heatmap.boundary', 'signal.demographics.age', 'signal.demographics.audiences',
    'signal.demographics.gender', 'signal.interests.entities', 'signal.interests.tags', 'take',
    'bias.trends' /* listed as optional on heatmaps-use-case, not in the per-type table */],
  'urn:demographics': ['filter.type', 'signal.interests.entities', 'signal.interests.tags', 'take'],
  'urn:tag': ['filter.type', 'filter.tag.types', 'filter.parents.types', 'signal.interests.entities',
    'signal.interests.tags', 'signal.demographics.audiences', 'signal.location', 'signal.location.query',
    'diversify.by', 'diversify.take', 'take', 'page', 'offset'],
};

const BY_PATH = {
  '/search': ['query', 'types', 'take', 'page', 'filter.location', 'filter.radius', 'filter.exists',
    'filter.tags', 'operator.filter.tags', 'filter.rating', 'filter.popularity', 'filter.address', 'sort_by'],
  '/entities': ['entity_ids'],
  '/v2/tags': ['filter.query', 'feature.typo_tolerance', 'feature.semantic_search', 'filter.tag.types',
    'filter.parents.types', 'filter.results.tags', 'filter.popularity.min', 'filter.popularity.max', 'take', 'page'],
  '/v2/tags/types': ['take', 'page'],
  '/v2/audiences': ['filter.parents.types', 'filter.audience.types', 'filter.results.audiences', 'filter.query',
    'filter.popularity.min', 'filter.popularity.max', 'take', 'page'],
  '/v2/audiences/types': ['take', 'page'],
  '/v2/analysis/compare': ['a.signal.interests.entities', 'b.signal.interests.entities', 'filter.type',
    'filter.entities.query', 'filter.location.query', 'filter.location.radius', 'filter.exclude.location.query',
    'filter.exclude.location.radius', 'filter.subtype', 'model', 'take', 'page', 'offset'],
  '/v2/trending': ['filter.type', 'filter.start_date', 'filter.end_date', 'signal.interests.entities', 'take', 'page', 'offset'],
};

const FORBIDDEN_PATHS = ['/recs', '/recommendations', '/v2/insights/search', '/v1/recs'];

export class QlooParamError extends Error {
  constructor(message, details) { super(message); this.name = 'QlooParamError'; this.code = 'QLOO_PARAM_INVALID'; this.details = details; }
}

/** Returns { ok, problems: string[] }. `params` are already flattened (dot keys). */
export function validateRequest(path, params) {
  const problems = [];
  if (FORBIDDEN_PATHS.some((p) => path.startsWith(p))) problems.push(`Path ${path} is forbidden in the hackathon (legacy).`);
  let allowed;
  if (path === '/v2/insights') {
    const type = params['filter.type'];
    if (!type) problems.push('filter.type is required on /v2/insights.');
    allowed = INSIGHTS_BY_TYPE[type];
    if (type && !allowed) problems.push(`filter.type ${type} is not supported (hackathon list + urn:heatmap, urn:demographics, urn:tag).`);
    if (type === 'urn:heatmap') {
      const locs = ['filter.location', 'filter.location.query'].filter((k) => params[k] !== undefined);
      if (locs.length !== 1) problems.push('urn:heatmap needs exactly one of filter.location / filter.location.query.');
    }
    if (params['signal.location'] !== undefined && params['signal.location.query'] !== undefined)
      problems.push('Send only one of signal.location / signal.location.query.');
    const hasSignal = Object.keys(params).some((k) => k.startsWith('signal.') || k.startsWith('filter.location') || k === 'filter.tags' || k === 'filter.tag.types' || k === 'filter.parents.types');
    if (!hasSignal) problems.push('At least one valid signal or filter is required.');
  } else {
    allowed = BY_PATH[path];
    if (!allowed) problems.push(`Unknown endpoint ${path}.`);
  }
  if (allowed) {
    for (const key of Object.keys(params)) {
      if (!allowed.includes(key)) problems.push(`Parameter "${key}" is not documented for ${params['filter.type'] || path}; Qloo would ignore it silently.`);
    }
  }
  const take = Number(params.take);
  if (params.take !== undefined && (!Number.isInteger(take) || take < 1 || take > (path === '/search' ? 199 : 50)))
    problems.push(`take=${params.take} is out of range.`);
  return { ok: problems.length === 0, problems };
}

export const QLOO_ALLOWED = { INSIGHTS_BY_TYPE, BY_PATH };
