// Per-city "advance dossier": venue, opener (+ audience gain), after-show spot, sponsor, crowd brief.
// Every item keeps the provenance of the Qloo call that produced it (evidence-first UI).
import { CITY_BY_ID } from '../data/cities.js';

const tagCache = new Map();

/** Resolve a tag ID by concept via /v2/tags (never pass free text as a tag: Qloo needs IDs/URNs). */
export async function resolveTag(qloo, concept) {
  if (tagCache.has(concept)) return tagCache.get(concept);
  const { body, provenance } = await qloo.tags({ 'filter.query': concept, 'feature.semantic_search': true, take: 10 });
  const tags = body?.results?.tags || [];
  const pick = tags.find((t) => (t.parents || []).some((p) => p.type === 'urn:entity:place')) || tags[0];
  const out = pick ? { id: pick.id || pick.tag_id, name: pick.name, candidates: tags.slice(0, 5).map((t) => ({ id: t.id || t.tag_id, name: t.name })), provenance } : null;
  tagCache.set(concept, out);
  return out;
}

const compact = (e) => e && ({
  id: e.entity_id || e.id, name: e.name, type: e.subtype || e.type, popularity: e.popularity,
  affinity: e?.query?.affinity, explainability: e?.query?.explainability,
  description: e?.properties?.short_description || e?.properties?.description,
  address: e?.properties?.address, price_level: e?.properties?.price_level, rating: e?.properties?.business_rating,
  location: e.location,
});
const entitiesOf = (body) => (body?.results?.entities || []).map(compact).filter(Boolean);

export async function findOpeners(qloo, { entityIds, entityType = 'urn:entity:artist', city, popularityMax = 0.85, genreTags = [], take = 5 }) {
  const params = { 'filter.type': entityType, 'signal.interests.entities': entityIds, 'filter.popularity.max': popularityMax, 'feature.explainability': true, take };
  if (genreTags.length) params['filter.tags'] = genreTags;
  if (city) params['signal.location.query'] = city.query;
  const { body, provenance } = await qloo.insights(params);
  const openers = entitiesOf(body).filter((e) => !ADULT.test(e.name || ''));
  let gain = null;
  if (openers[0]) {
    try {
      const cmp = await qloo.compare({ 'a.signal.interests.entities': entityIds, 'b.signal.interests.entities': [openers[0].id], take: 10 });
      gain = audienceGain(cmp.body);
      gain.provenance = cmp.provenance;
    } catch (e) { gain = { error: e.message }; }
  }
  return { openers, gain, provenance };
}

/**
 * PRODUCT INTERPRETATION (not a Qloo metric): "audience gain" = 1 - overlap between the two fan bases,
 * computed from the compare results. The compare item schema is undocumented (TECH.md §2.6), so this
 * parser accepts several plausible shapes and reports `basis` so the UI can show what it used.
 */
export function audienceGain(body) {
  const r = body?.results;
  // Live shape (checked 22 Oct): `tags` = taste tags both audiences share (query.score), `a` / `b` = tags
  // that characterise each side. Gain = share of the opener's tags the headliner's audience lacks.
  if (r && Array.isArray(r.tags) && Array.isArray(r.a) && Array.isArray(r.b)) {
    const scores = r.tags.slice(0, 10).map((t) => Number(t?.query?.score)).filter(Number.isFinite);
    const known = new Set([...r.a, ...r.tags].map((t) => t.tag_id || t.id));
    const fresh = r.b.filter((t) => !known.has(t.tag_id || t.id));
    if (!r.b.length) return { gain: null, overlap: null, basis: 'empty compare' };
    return {
      overlap: scores.length ? round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      gain: round(fresh.length / r.b.length),
      basis: `${r.tags.length} shared taste tags; ${fresh.length} of ${r.b.length} opener tags are new to the headliner`,
      shared: r.tags.slice(0, 5).map((t) => t.name),
      differentiators: fresh.slice(0, 5).map((t) => t.name),
    };
  }
  const items = Array.isArray(r) ? r : r?.entities || r?.tags || [];
  const pairs = items.map((it) => [Number(it?.query?.a?.affinity ?? it?.a?.affinity ?? it?.affinity_a), Number(it?.query?.b?.affinity ?? it?.b?.affinity ?? it?.affinity_b)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!pairs.length) return { gain: null, overlap: null, basis: 'unparsed', sample: items.slice(0, 2) };
  const overlap = 1 - pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length;
  return { overlap: round(overlap), gain: round(1 - overlap), basis: `${pairs.length} compared items`, differentiators: items.slice(0, 5).map((x) => x.name).filter(Boolean) };
}

// The room depends on the format: a comedian plays comedy clubs, a live podcast plays theaters.
const ROOM_CONCEPT = { 'urn:entity:person': 'comedy club', 'urn:entity:podcast': 'performing arts theater' };

export async function localPicks(qloo, { entityIds, city, kind, entityType = 'urn:entity:artist', take = 5 }) {
  if (kind === 'venue') {
    const tag = await resolveTag(qloo, ROOM_CONCEPT[entityType] || 'live music venue');
    const params = { 'filter.type': 'urn:entity:place', 'signal.interests.entities': entityIds, 'filter.location.query': city.query, 'feature.explainability': true, take };
    if (tag?.id) params['filter.tags'] = tag.id;
    const { body, provenance } = await qloo.insights(params);
    return { kind, tag, picks: entitiesOf(body), provenance };
  }
  if (kind === 'after_party') {
    const { body, provenance } = await qloo.insights({ 'filter.type': 'urn:entity:place', 'signal.interests.entities': entityIds, 'filter.location.query': city.query, 'filter.price_level.max': 2, take });
    return { kind, picks: entitiesOf(body), provenance };
  }
  if (kind === 'crowd_brief') {
    // Location must be a SIGNAL here: filter.location.* is only documented for place/destination (+ heatmap).
    const [shows, pods, tags] = await Promise.all([
      // popularity.max keeps the brief local: without it every city returns the same national hits.
      qloo.insights({ 'filter.type': 'urn:entity:tv_show', 'signal.interests.entities': entityIds, 'signal.location.query': city.query, 'filter.popularity.max': NICHE_MAX, take }),
      qloo.insights({ 'filter.type': 'urn:entity:podcast', 'signal.interests.entities': entityIds, 'signal.location.query': city.query, 'filter.popularity.max': NICHE_MAX, take: 3 }),
      qloo.tagInsights({ 'signal.interests.entities': entityIds, 'signal.location.query': city.query, take: 30 }),
    ]);
    return {
      kind,
      shows: entitiesOf(shows.body), podcasts: entitiesOf(pods.body),
      themes: (tags.body?.results?.tags || []).filter(isTellingTag).slice(0, 8)
        .map((t) => ({ id: t.tag_id || t.id, name: t.name, affinity: t?.query?.affinity })),
      provenance: [shows.provenance, pods.provenance, tags.provenance],
    };
  }
  throw new Error(`Unknown kind ${kind}`);
}

export async function sponsorFit(qloo, { entityIds, city, take = 5 }) {
  const params = { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': entityIds, 'feature.explainability': true, take };
  if (city) params['signal.location.query'] = city.query;
  const { body, provenance } = await qloo.insights(params);
  return { sponsors: entitiesOf(body), provenance };
}

export async function audienceProfile(qloo, { entityId }) {
  const { body, provenance } = await qloo.demographics({ 'signal.interests.entities': [entityId] });
  const block = (body?.results?.demographics || []).find((d) => d.entity_id === entityId) || body?.results?.demographics?.[0];
  return { age: block?.query?.age || {}, gender: block?.query?.gender || {}, provenance, note: 'Aggregate affinity by segment (positive = over-index). Not a headcount, not about any individual.' };
}

export async function momentum(qloo, { entityId, entityType = 'urn:entity:artist', startDate, endDate }) {
  const { body, provenance } = await qloo.trending({ 'filter.type': entityType, 'signal.interests.entities': [entityId], 'filter.start_date': startDate, 'filter.end_date': endDate, take: 50 });
  const pts = [...(body?.results?.trending || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = pts[0]?.population_percentile, last = pts[pts.length - 1]?.population_percentile;
  const delta = Number.isFinite(first) && Number.isFinite(last) ? round(last - first) : null;
  const verdict = delta === null ? 'unknown' : delta > 4 ? 'rising' : delta < -4 ? 'cooling' : 'steady';
  return { series: pts.map((p) => ({ date: p.date, percentile: p.population_percentile, velocity: p.population_rank_velocity })), delta, verdict, advice: verdict === 'rising' ? 'Momentum is up: consider booking one size up for later dates.' : verdict === 'cooling' ? 'Momentum is down: keep rooms tight, sell out small.' : 'Hold venue sizes.', provenance };
}

export async function cityDossier(qloo, { entityIds, entityType, cityId }) {
  const city = CITY_BY_ID[cityId];
  if (!city) throw new Error(`Unknown city ${cityId}`);
  const [venue, after, crowd, opener, sponsor] = await Promise.all([
    localPicks(qloo, { entityIds, city, kind: 'venue', entityType }),
    localPicks(qloo, { entityIds, city, kind: 'after_party' }),
    localPicks(qloo, { entityIds, city, kind: 'crowd_brief' }),
    findOpeners(qloo, { entityIds, entityType, city }),
    sponsorFit(qloo, { entityIds, city }),
  ]);
  return { city: { id: city.id, name: city.name, state: city.state }, venue, after, crowd, opener, sponsor };
}

const round = (x) => Math.round(x * 1000) / 1000;

const NICHE_MAX = 0.97;
// A demo shown to a jury should not pitch adult shows as support acts or crowd themes.
const ADULT = /\b(porn\w*|sex|adult|nsfw)\b/i;
// Generic place genres top every city's tag list ("Bar", "Restaurant"…) and say nothing about the crowd.
const GENERIC_TAGS = new Set(['bar', 'restaurant', 'tourist attraction', 'cafe', 'coffee shop', 'park', 'hotel', 'store', 'shopping mall', 'fast food restaurant']);
// Place genres are mostly cuisines ("American", "European"); keep only the ones that describe a night out.
const NIGHT_OUT = /music|art|museum|gallery|comedy|theat|record|book|cinema|club|cultur/i;
function isTellingTag(t) {
  const name = String(t?.name || '').trim(), subtype = String(t?.subtype || '');
  if (GENERIC_TAGS.has(name.toLowerCase()) || ADULT.test(name)) return false;
  if (subtype.startsWith('urn:tag:specialty_dish')) return false;
  if (subtype.startsWith('urn:tag:genre:place')) return NIGHT_OUT.test(name);
  return true;
}
