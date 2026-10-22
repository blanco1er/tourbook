// Market ranking + Hidden Market Score (HMS).
// Strategies are tried in order (MARKET_STRATEGY=auto) because the exact behaviour of urn:heatmap
// with the hackathon key is UNVERIFIED (see TECH.md §2.2 and test #1 of the probe script).
import { CITIES, US_WKT, haversineKm } from '../data/cities.js';
import { decodeGeohash } from '../qloo/geohash.js';
import { config } from '../config.js';

const METRO_KM = 50; // a heatmap cell belongs to a metro if its centre is within 50 km

export const STRATEGIES = {
  // ONE call, whole country: affinities are comparable across cities (preferred).
  async heatmap_national(qloo, ids, cities) {
    const params = { 'signal.interests.entities': ids, 'filter.location': US_WKT, take: 50 };
    if (config.qloo.heatmapBoundary) params['output.heatmap.boundary'] = config.qloo.heatmapBoundary;
    const { body, provenance } = await qloo.heatmap(params);
    return { values: assignCells(body?.results?.heatmap || [], cities), evidence: [provenance], comparable: true };
  },
  // One call per city. Heatmap affinity is query-relative => NOT strictly comparable across calls.
  async heatmap_city(qloo, ids, cities) {
    const evidence = [], values = {};
    await Promise.all(cities.map(async (c) => {
      try {
        const { body, provenance } = await qloo.heatmap({ 'signal.interests.entities': ids, 'filter.location.query': c.query, take: 20 });
        evidence.push(provenance);
        const cells = body?.results?.heatmap || [];
        if (cells.length) values[c.id] = mean(top(cells.map((x) => num(x?.query?.affinity)), 5)); // popularity would just re-encode population
      } catch (e) { evidence.push({ path: '/v2/insights', error: e.message, city: c.id }); }
    }));
    return { values, evidence, comparable: false };
  },
  // Score the artist itself for each city audience: signal.location.query + filter.results.entities.
  async artist_in_city(qloo, ids, cities, type = 'urn:entity:artist') {
    const evidence = [], values = {};
    await Promise.all(cities.map(async (c) => {
      try {
        const { body, provenance } = await qloo.insights({ 'filter.type': type, 'signal.location.query': c.query, 'filter.results.entities': ids, take: Math.min(ids.length, 50) });
        evidence.push(provenance);
        const ents = body?.results?.entities || [];
        if (ents.length) values[c.id] = mean(ents.map((e) => num(e?.query?.affinity)));
      } catch (e) { evidence.push({ path: '/v2/insights', error: e.message, city: c.id }); }
    }));
    return { values, evidence, comparable: false };
  },
  // Proxy: how strongly the city's places resonate with the fan base (top-10 mean affinity).
  async places_in_city(qloo, ids, cities) {
    const evidence = [], values = {};
    await Promise.all(cities.map(async (c) => {
      try {
        const { body, provenance } = await qloo.insights({ 'filter.type': 'urn:entity:place', 'signal.interests.entities': ids, 'filter.location.query': c.query, take: 20 });
        evidence.push(provenance);
        const ents = body?.results?.entities || [];
        if (ents.length) values[c.id] = mean(top(ents.map((e) => num(e?.query?.affinity)), 10));
      } catch (e) { evidence.push({ path: '/v2/insights', error: e.message, city: c.id }); }
    }));
    return { values, evidence, comparable: false };
  },
};

const ORDER = ['heatmap_national', 'artist_in_city', 'heatmap_city', 'places_in_city'];

export async function rankMarkets(qloo, { entityIds, entityType = 'urn:entity:artist', strategy = config.qloo.marketStrategy, cities = CITIES, topN = 8 }) {
  const order = strategy === 'auto' ? ORDER : [strategy];
  const attempts = [];
  for (const name of order) {
    try {
      const run = await STRATEGIES[name](qloo, entityIds, cities, entityType);
      const coverage = Object.keys(run.values).length / cities.length;
      attempts.push({ strategy: name, coverage: round(coverage), ok: coverage >= 0.6 });
      if (coverage >= 0.6) {
        const markets = scoreMarkets(cities, run.values);
        return { strategy: name, comparable: run.comparable, attempts, markets, top: markets.slice(0, topN), evidence: run.evidence.slice(0, 40) };
      }
    } catch (e) {
      attempts.push({ strategy: name, ok: false, error: e.message, code: e.code });
    }
  }
  const err = new Error('No market strategy produced enough coverage.'); err.attempts = attempts; throw err;
}

/**
 * Hidden Market Score (0-100) = 60% taste strength + 40% taste-vs-population rank gap.
 *  - affinityRank: 1 = strongest Qloo affinity among candidates
 *  - popRank:      1 = largest population among candidates
 *  - rankGap = popRank - affinityRank (> 0 means taste outranks population: a "hidden market")
 */
export function scoreMarkets(cities, values) {
  const rows = cities.filter((c) => values[c.id] !== undefined && Number.isFinite(values[c.id]));
  const n = rows.length;
  const byPop = [...rows].sort((a, b) => b.pop - a.pop);
  const byAff = [...rows].sort((a, b) => values[b.id] - values[a.id]);
  const lo = values[byAff[n - 1]?.id] ?? 0, hi = values[byAff[0]?.id] ?? 1;
  return byAff.map((c, i) => {
    const affinityRank = i + 1, popRank = byPop.indexOf(c) + 1;
    const rankGap = popRank - affinityRank;
    const strength = hi > lo ? (values[c.id] - lo) / (hi - lo) : 1;
    const gapNorm = n > 1 ? (rankGap + (n - 1)) / (2 * (n - 1)) : 0.5;
    const hms = Math.round(100 * (0.6 * strength + 0.4 * gapNorm));
    return { ...c, affinity: round(values[c.id]), affinityRank, popRank, rankGap, hms, hidden: rankGap >= 5 && strength >= 0.5 };
  }).sort((a, b) => b.hms - a.hms);
}

/**
 * Map heatmap cells (geohash or lat/lng) to candidate metros; metro value = mean cell affinity_rank
 * within METRO_KM of the city centre. Live data showed `affinity` is percentile-like and saturates at 1
 * in many cells, so a per-metro max made every city tie; the mean of the finer `affinity_rank` over the
 * metro area keeps both the order and the spread.
 */
export function assignCells(cells, cities) {
  const sums = {}, counts = {};
  for (const cell of cells) {
    const loc = cell?.location || {};
    const pt = Number.isFinite(loc.latitude) ? { lat: loc.latitude, lng: loc.longitude }
      : Number.isFinite(loc.lat) ? { lat: loc.lat, lng: loc.lng ?? loc.lon } : loc.geohash ? decodeGeohash(loc.geohash) : null;
    if (!pt) continue;
    const a = num(cell?.query?.affinity_rank ?? cell?.query?.affinity);
    if (!Number.isFinite(a)) continue;
    for (const c of cities) {
      if (haversineKm(pt, c) > METRO_KM) continue;
      sums[c.id] = (sums[c.id] || 0) + a;
      counts[c.id] = (counts[c.id] || 0) + 1;
    }
  }
  const values = {};
  for (const id of Object.keys(sums)) values[id] = sums[id] / counts[id];
  return values;
}

/** Greedy nearest-neighbour routing through the chosen markets (start = highest HMS). */
export function routeOrder(markets) {
  if (!markets.length) return [];
  const left = [...markets], route = [left.shift()];
  while (left.length) {
    const last = route[route.length - 1];
    let k = 0, best = Infinity;
    left.forEach((m, i) => { const d = haversineKm(last, m); if (d < best) { best = d; k = i; } });
    route.push(left.splice(k, 1)[0]);
  }
  return route.map((m) => m.id);
}

const num = (x) => (typeof x === 'number' ? x : Number(x));
const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
const top = (a, k) => [...a].filter(Number.isFinite).sort((x, y) => y - x).slice(0, k);
const round = (x) => Math.round(x * 1000) / 1000;
