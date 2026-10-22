// The 8 typed tools exposed to the LLM (OpenAI function-calling format, strict JSON Schemas).
// Each tool: { def, stage, run(args, ctx) -> { forModel, full } }.
//   forModel: compact JSON the model sees (keeps context small);
//   full:     complete result kept server-side in ctx.state for the Tour Book UI.
// The model never sees raw Qloo payloads, and every fact in the UI comes from `full` (evidence-bound).
import { CITIES, CITY_BY_ID } from '../data/cities.js';
import { rankMarkets } from '../domain/markets.js';
import { findOpeners, localPicks, sponsorFit, audienceProfile, momentum } from '../domain/dossier.js';
import { llmOnlyBaseline } from '../domain/baseline.js';

const CITY_IDS = CITIES.map((c) => c.id);
const TYPE_URN = { artist: 'urn:entity:artist', person: 'urn:entity:person', podcast: 'urn:entity:podcast' };
const ids = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'Qloo entity IDs returned by resolve_entity (headliner first).' };
const fn = (name, description, properties) => ({
  type: 'function',
  function: { name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } },
});

export const TOOLS = {
  resolve_entity: {
    stage: 'Resolve',
    def: fn('resolve_entity', 'Find the Qloo entity ID for an artist, comedian (person) or podcast by name. Always call this before any other tool; show ambiguous matches to the user.', {
      name: { type: 'string', description: 'Name as typed by the user.' },
      type: { type: 'string', enum: ['artist', 'person', 'podcast'] },
    }),
    async run({ name, type }, { qloo, state }) {
      const { body, provenance } = await qloo.search({ query: name, types: TYPE_URN[type], take: 5 });
      const raw = Array.isArray(body?.results) ? body.results : body?.results?.entities || [];
      const cands = raw.map((e) => ({ id: e.entity_id || e.id, name: e.name, type: e.subtype || e.types?.[0] || TYPE_URN[type], popularity: e.popularity, description: e?.properties?.short_description, genreTags: genreTagsOf(e, type) }));
      const exact = cands.filter((c) => c.name?.toLowerCase() === name.toLowerCase());
      const selected = exact[0] || cands[0] || null;
      const full = { input: name, selected, match: exact.length === 1 ? 'exact' : selected ? 'best_guess' : 'not_found', candidates: cands, provenance };
      // Parallel resolves can finish in any order: the headliner always comes first.
      if (selected) { if (name.trim().toLowerCase() === String(state.input?.artist || '').trim().toLowerCase()) state.resolved.unshift(full); else state.resolved.push(full); }
      return { full, forModel: { selected, match: full.match, candidates: cands.slice(0, 3).map(({ id, name: n }) => ({ id, name: n })) } };
    },
  },
  rank_markets: {
    stage: 'Markets',
    def: fn('rank_markets', 'Rank candidate US metros by Qloo taste affinity for the fan base and compute the Hidden Market Score (taste vs population).', {
      entity_ids: ids,
      top_n: { type: 'integer', minimum: 3, maximum: 12 },
    }),
    async run({ entity_ids, top_n }, { qloo, state }) {
      const entityType = state.resolved[0]?.selected?.type || 'urn:entity:artist';
      const full = await rankMarkets(qloo, { entityIds: entity_ids, entityType: TYPE_URN_FROM(entityType), topN: top_n });
      state.markets = full;
      const slim = (m) => ({ id: m.id, name: m.name, hms: m.hms, affinity: m.affinity, rankGap: m.rankGap });
      return { full, forModel: { strategy: full.strategy, top: full.top.map(slim), attempts: full.attempts } };
    },
  },
  audience_profile: {
    stage: 'Audience',
    def: fn('audience_profile', 'Aggregate age and gender affinity of the headliner audience (urn:demographics). Aggregate only, never about individuals.', {
      entity_id: { type: 'string' },
    }),
    async run({ entity_id }, { qloo, state }) {
      const full = await audienceProfile(qloo, { entityId: entity_id });
      state.audience = full;
      return { full, forModel: { age: full.age, gender: full.gender } };
    },
  },
  find_openers: {
    stage: 'Dates',
    def: fn('find_openers', 'Find support acts with a similar but less popular audience in a city, plus the audience gain (non-overlap) vs the headliner.', {
      entity_ids: ids,
      city_id: { type: 'string', enum: CITY_IDS },
      popularity_max: { type: 'number', minimum: 0.1, maximum: 1 },
    }),
    async run({ entity_ids, city_id, popularity_max }, { qloo, state }) {
      const entityType = TYPE_URN_FROM(state.resolved[0]?.selected?.type);
      const full = await findOpeners(qloo, { entityIds: entity_ids, entityType, city: CITY_BY_ID[city_id], popularityMax: popularity_max, genreTags: state.resolved[0]?.selected?.genreTags });
      dossier(state, city_id).opener = full;
      return { full, forModel: { openers: full.openers.slice(0, 3).map((o) => ({ name: o.name, popularity: o.popularity, affinity: o.affinity })), gain: full.gain?.gain ?? null } };
    },
  },
  local_picks: {
    stage: 'Dates',
    def: fn('local_picks', 'City picks for the date: the venue (kind=venue), an affordable after-show spot (kind=after_party), or the crowd brief: shows, podcasts and themes this local audience likes (kind=crowd_brief).', {
      entity_ids: ids,
      city_id: { type: 'string', enum: CITY_IDS },
      kind: { type: 'string', enum: ['venue', 'after_party', 'crowd_brief'] },
    }),
    async run({ entity_ids, city_id, kind }, { qloo, state }) {
      const full = await localPicks(qloo, { entityIds: entity_ids, city: CITY_BY_ID[city_id], kind, entityType: TYPE_URN_FROM(state.resolved[0]?.selected?.type) });
      dossier(state, city_id)[kind] = full;
      const forModel = kind === 'crowd_brief'
        ? { shows: full.shows.slice(0, 3).map((x) => x.name), podcasts: full.podcasts.map((x) => x.name), themes: full.themes.slice(0, 5).map((x) => x.name) }
        : { picks: full.picks.slice(0, 3).map((x) => ({ name: x.name, affinity: x.affinity })) };
      return { full, forModel };
    },
  },
  sponsor_fit: {
    stage: 'Dates',
    def: fn('sponsor_fit', 'Brands with the strongest affinity for this fan base in a city (sponsor shortlist).', {
      entity_ids: ids,
      city_id: { type: 'string', enum: CITY_IDS },
    }),
    async run({ entity_ids, city_id }, { qloo, state }) {
      const full = await sponsorFit(qloo, { entityIds: entity_ids, city: CITY_BY_ID[city_id] });
      dossier(state, city_id).sponsor = full;
      return { full, forModel: { sponsors: full.sponsors.slice(0, 3).map((s) => ({ name: s.name, affinity: s.affinity })) } };
    },
  },
  momentum: {
    stage: 'Timing',
    def: fn('momentum', 'Weekly popularity trend of the headliner over the last six months (/v2/trending) to decide venue sizes.', {
      entity_id: { type: 'string' },
    }),
    async run({ entity_id }, { qloo, state }) {
      // The window is set here, not by the model: models do not know today's date (one asked for 2024).
      const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - 182);
      const iso = (d) => d.toISOString().slice(0, 10);
      const full = await momentum(qloo, { entityId: entity_id, entityType: TYPE_URN_FROM(state.resolved[0]?.selected?.type), startDate: iso(start), endDate: iso(end) });
      state.momentum = full;
      return { full, forModel: { verdict: full.verdict, delta: full.delta, advice: full.advice } };
    },
  },
  llm_only_baseline: {
    stage: 'Proof',
    def: fn('llm_only_baseline', 'Produce the plan a model WITHOUT Qloo would make, for the side-by-side proof.', {
      artist_name: { type: 'string' },
      n: { type: 'integer', minimum: 3, maximum: 12 },
    }),
    async run({ artist_name, n }, { llm, state }) {
      const full = await llmOnlyBaseline(llm, { artistName: artist_name, n });
      state.baseline = full;
      return { full, forModel: { cities: full.cities.map((c) => c.id) } };
    },
  },
};

export const TOOL_DEFS = Object.values(TOOLS).map((t) => t.def);

function dossier(state, cityId) { state.dates[cityId] ||= { city: CITY_BY_ID[cityId] }; return state.dates[cityId]; }
/**
 * Genre tags that keep openers in the same format. Artists need none (the artist type already does it);
 * a podcast's similar podcasts drift to news shows and a comedian's to actors without them.
 */
function genreTagsOf(e, type) {
  if (type === 'artist') return [];
  const keep = type === 'person' ? /^urn:tag:occupation:person:stand_up_comedian$/ : /^urn:tag:genre:media:(?!podcasts$)/;
  return (e.tags || []).map((t) => t.tag_id || t.id).filter((id) => keep.test(String(id))).slice(0, 3);
}
function TYPE_URN_FROM(t) { return ['urn:entity:artist', 'urn:entity:person', 'urn:entity:podcast'].includes(t) ? t : 'urn:entity:artist'; }

/** Minimal JSON-schema check for tool arguments (models sometimes hallucinate enums / missing fields). */
export function checkArgs(schema, args) {
  const errs = [];
  if (!args || typeof args !== 'object') return ['arguments must be an object'];
  for (const k of schema.required || []) if (args[k] === undefined) errs.push(`missing ${k}`);
  for (const [k, v] of Object.entries(args)) {
    const s = schema.properties?.[k];
    if (!s) { errs.push(`unknown argument ${k}`); continue; }
    if (s.type === 'string' && typeof v !== 'string') errs.push(`${k} must be a string`);
    if (s.enum && !s.enum.includes(v)) errs.push(`${k} must be one of ${s.enum.slice(0, 8).join(', ')}${s.enum.length > 8 ? ', ...' : ''}`);
    if (s.pattern && typeof v === 'string' && !new RegExp(s.pattern).test(v)) errs.push(`${k} has a bad format`);
    if ((s.type === 'integer' || s.type === 'number') && (typeof v !== 'number' || (s.type === 'integer' && !Number.isInteger(v)) || (s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))) errs.push(`${k} out of range`);
    if (s.type === 'array' && (!Array.isArray(v) || v.length < (s.minItems || 0) || v.length > (s.maxItems || Infinity) || v.some((x) => typeof x !== 'string'))) errs.push(`${k} must be an array of 1-${s.maxItems} strings`);
  }
  return errs;
}
