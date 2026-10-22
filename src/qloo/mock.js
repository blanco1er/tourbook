// MOCK Qloo client: same interface and documented response SHAPES as the live API,
// but every value is generated deterministically from invented fixtures. No network, no key.
// Shapes follow docs.qloo.com examples + @qloo/qloo-harness parsing code (see TECH.md).
// Every response carries `mock: true` so nothing synthetic can be mistaken for Qloo data.
import { createHash } from 'node:crypto';
import { BaseQlooClient, QlooError } from './client.js';
import { CITIES, haversineKm } from '../data/cities.js';
import {
  DEMO_ARTISTS, SYNTH_ARTIST_NAMES, VENUE_PATTERNS, AFTER_PATTERNS, VENUE_WORDS,
  SYNTH_BRANDS, SYNTH_SHOWS, SYNTH_PODCASTS, SYNTH_TAGS,
} from '../data/fixtures.js';
import { encodeGeohash } from './geohash.js';

const SUPPORTED = new Set(['urn:entity:artist', 'urn:entity:book', 'urn:entity:brand', 'urn:entity:destination', 'urn:entity:movie',
  'urn:entity:person', 'urn:entity:place', 'urn:entity:podcast', 'urn:entity:tv_show', 'urn:entity:videogame',
  'urn:heatmap', 'urn:demographics', 'urn:tag']);
export const MOCK_VENUE_TAG = 'urn:tag:mock:place:live_music_venue';

// ---------- deterministic helpers ----------
function hash32(str) { const h = createHash('sha1').update(str).digest(); return h.readUInt32BE(0); }
function rng(seed) { let a = hash32(String(seed)); return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function uuidFrom(str) { const h = createHash('sha1').update(`mock:${str}`).digest('hex').toUpperCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const r3 = (x) => Math.round(x * 1000) / 1000;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const maxPop = Math.max(...CITIES.map((c) => c.pop));
const popNorm = (c) => Math.log(c.pop) / Math.log(maxPop);

// ---------- synthetic entity registry ----------
const registry = new Map(); // id -> entity
function register(e) { registry.set(e.id, e); return e; }
for (const demo of DEMO_ARTISTS) {
  const parent = register({ id: uuidFrom(demo.name), name: demo.name, type: demo.type, popularity: demo.popularity, taste: demo.taste, tags: demo.tags, blurb: demo.blurb });
  demo.proxies.forEach((p, i) => {
    const r = rng(p);
    const taste = Object.fromEntries(Object.entries(parent.taste).map(([k, v]) => [k, clamp(v * (0.78 + 0.2 * r()))]));
    register({ id: uuidFrom(p), name: p, type: demo.type, popularity: r3(0.45 + 0.25 * r()), taste, tags: demo.tags, blurb: `Similar-sounding act #${i + 1} (synthetic)` });
  });
}
function synthEntity(name, type = 'urn:entity:artist') {
  const id = uuidFrom(`${type}:${name.toLowerCase()}`);
  if (registry.has(id)) return registry.get(id);
  const r = rng(name.toLowerCase());
  const hot = [...CITIES].sort(() => r() - 0.5).slice(0, 7);
  const taste = Object.fromEntries(hot.map((c) => [c.id, r3(0.6 + 0.4 * r())]));
  return register({ id, name, type, popularity: r3(0.35 + 0.5 * r()), taste, tags: [SYNTH_TAGS[Math.floor(r() * SYNTH_TAGS.length)]], blurb: 'Synthetic entity generated for mock mode' });
}
function entityById(id) { return registry.get(id) || synthEntity(`Entity ${id.slice(0, 6)}`); }
function taste(e, city) { return e.taste?.[city.id] ?? r3(0.12 + 0.38 * rng(`${e.id}:${city.id}`)()); }
function affinityFor(ids, city, salt = '') {
  if (!ids.length) return r3(0.3 + 0.4 * rng(`${city.id}:${salt}`)());
  const vals = ids.map((id) => { const e = entityById(id); const n = rng(`${id}:${city.id}:${salt}`)() - 0.5; return clamp(0.22 + 0.62 * taste(e, city) + 0.08 * popNorm(city) + 0.06 * n); });
  return r3(vals.reduce((a, b) => a + b, 0) / vals.length);
}
function findCity(q) {
  if (!q) return undefined;
  const s = q.toLowerCase();
  return CITIES.find((c) => s === c.query.toLowerCase() || s === c.name.toLowerCase() || s.includes(c.name.toLowerCase()) || c.query.toLowerCase().includes(s));
}
const NEIGHBORHOODS = { 'lower east side': 'new-york', 'wicker park': 'chicago', 'silver lake': 'los-angeles', 'east austin': 'austin', rino: 'denver', mississippi: 'portland', soho: 'new-york' };
function findLocality(q) {
  const city = findCity(q);
  if (city) return { city, name: city.name };
  const s = (q || '').toLowerCase();
  const key = Object.keys(NEIGHBORHOODS).find((k) => s.includes(k));
  if (key) { const c = CITIES.find((x) => x.id === NEIGHBORHOODS[key]); return { city: c, name: q }; }
  return undefined;
}
const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const explain = (ids, r) => ({ 'signal.interests.entities': ids.map((id) => ({ entity_id: id, score: r3(0.3 + 0.7 * r()) })) });

function entityPayload(e, extra = {}) {
  return { name: e.name, entity_id: e.id, type: 'urn:entity', subtype: e.type, popularity: e.popularity, properties: { short_description: e.blurb }, tags: (e.tags || []).map((t) => ({ tag_id: `urn:tag:mock:${slug(t)}`, name: t })), ...extra };
}

// ---------- the client ----------
export class MockQlooClient extends BaseQlooClient {
  constructor({ strictParams = true, latencyMs = [40, 160] } = {}) { super({ strictParams, mode: 'mock' }); this.latency = latencyMs; }

  async _request(path, p) {
    const [lo, hi] = this.latency;
    await new Promise((r) => setTimeout(r, lo + Math.floor(Math.random() * (hi - lo))));
    const body = this.#route(path, p);
    return { body: { success: true, mock: true, duration: 42, ...body }, cache: 'mock' };
  }

  #route(path, p) {
    switch (path) {
      case '/search': return this.#search(p);
      case '/v2/insights': return this.#insights(p);
      case '/v2/analysis/compare': return this.#compare(p);
      case '/v2/trending': return this.#trending(p);
      case '/v2/tags': return this.#tags(p);
      case '/v2/tags/types': return { results: { tags: [{ type: 'urn:tag:mock:place' }, { type: 'urn:tag:mock:media' }] } };
      case '/v2/audiences': return { results: { entities: [] } };
      case '/entities': return { results: { entities: list(p.entity_ids).map((id) => entityPayload(entityById(id))) } };
      default: throw new QlooError('QLOO_NO_PATH', `No path matching ${path}`, { status: 404 });
    }
  }

  #search(p) {
    const q = (p.query || '').trim();
    const type = list(p.types)[0] || 'urn:entity:artist';
    if (!q) return { results: [] };
    const exact = [...registry.values()].find((e) => e.name.toLowerCase() === q.toLowerCase()) || synthEntity(q, type);
    const alts = [synthEntity(`${exact.name} (Tribute)`, exact.type), synthEntity(`${exact.name} Live Collective`, exact.type)];
    alts.forEach((a) => { a.popularity = r3(Math.min(a.popularity, 0.3)); });
    const take = Number(p.take || 5);
    return { results: [exact, ...alts].slice(0, take).map((e) => ({ ...entityPayload(e), types: [e.type] })) };
  }

  #insights(p) {
    const type = p['filter.type'];
    if (!SUPPORTED.has(type)) throw new QlooError('QLOO_FORBIDDEN_TYPE', `You do not have permission to access ${type}`, { status: 403 });
    const ids = list(p['signal.interests.entities']);
    const take = Math.min(Number(p.take || 20), 50);
    const sigLoc = p['signal.location.query'];
    const filtLoc = p['filter.location.query'];
    const locQuery = sigLoc || filtLoc;
    let loc;
    if (locQuery) {
      loc = findLocality(locQuery);
      if (!loc) throw new QlooError('QLOO_BAD_REQUEST', `No locality found for "${locQuery}"`, { status: 400 });
    }
    const salt = `${type}:${locQuery || ''}:${ids.join(',')}`;
    const r = rng(salt);
    const wantExplain = p['feature.explainability'] === 'true';
    const queryBlock = loc ? { locality: { [sigLoc ? 'signal' : 'filter']: { name: loc.name, entity_id: uuidFrom(`locality:${loc.name}`), subtype: 'urn:entity:locality' } } } : {};

    if (type === 'urn:heatmap') return { results: { heatmap: this.#heatmap(p, ids, r) }, query: queryBlock };
    if (type === 'urn:demographics') {
      const blocks = [...ids, ...list(p['signal.interests.tags'])].map((id) => {
        const rr = rng(`demo:${id}`);
        const age = Object.fromEntries(['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'].map((k, i) => [k, r3(0.55 - 0.22 * i + 0.4 * (rr() - 0.5))]));
        const g = r3(0.3 * (rr() - 0.5));
        return { entity_id: id, query: { age, gender: { male: g, female: r3(-g) } } };
      });
      return { results: { demographics: blocks } };
    }
    if (type === 'urn:tag') {
      const tags = [...SYNTH_TAGS].sort(() => r() - 0.5).slice(0, take).map((t) => ({ tag_id: `urn:tag:mock:${slug(t)}`, name: t, types: ['urn:entity:place', 'urn:entity:brand'], subtype: 'urn:tag:mock', tag_value: `urn:tag:mock:${slug(t)}`, query: { affinity: r3(0.4 + 0.6 * r()) } }));
      return { results: { tags: tags.sort((a, b) => b.query.affinity - a.query.affinity) }, query: queryBlock };
    }

    // Entity-typed insights
    const results = list(p['filter.results.entities']);
    if (results.length) {
      // "Score these specific entities for this audience/location" (filter.results.entities)
      const ents = results.map((id) => entityById(id));
      const out = ents.map((e) => entityPayload(e, { query: { affinity: loc ? affinityFor([e.id], loc.city, 'res') : r3(0.5 + 0.4 * r()) } }));
      return { results: { entities: out.sort((a, b) => b.query.affinity - a.query.affinity) }, query: queryBlock };
    }
    const popMax = p['filter.popularity.max'] ? Number(p['filter.popularity.max']) : 1;
    const city = loc?.city;
    let pool;
    if (type === 'urn:entity:place') pool = this.#places(p, city, r, take);
    else if (type === 'urn:entity:brand') pool = SYNTH_BRANDS.map((n) => ({ name: n, sub: type, desc: 'Lifestyle brand (synthetic)' }));
    else if (type === 'urn:entity:tv_show') pool = SYNTH_SHOWS.map((n) => ({ name: n, sub: type, desc: 'TV series (synthetic)' }));
    else if (type === 'urn:entity:podcast') pool = SYNTH_PODCASTS.map((n) => ({ name: n, sub: type, desc: 'Podcast (synthetic)' }));
    else pool = SYNTH_ARTIST_NAMES.map((n) => ({ name: n, sub: type, desc: 'Artist (synthetic)' }));
    const exclude = new Set(ids.map((id) => entityById(id).name));
    const entities = pool.filter((x) => !exclude.has(x.name)).map((x) => {
      const pop = x.popularity ?? r3(0.15 + 0.8 * rng(`pop:${x.name}`)());
      const aff = r3(0.35 + 0.6 * rng(`${salt}:${x.name}`)());
      return {
        name: x.name, entity_id: uuidFrom(`${x.sub}:${x.name}${city ? `:${city.id}` : ''}`), type: 'urn:entity', subtype: x.sub, popularity: pop,
        properties: { short_description: x.desc, ...(x.props || {}) }, ...(x.location ? { location: x.location } : {}),
        query: { affinity: aff, ...(wantExplain && ids.length ? { explainability: explain(ids, rng(`ex:${x.name}`)) } : {}) },
      };
    }).filter((e) => e.popularity <= popMax).sort((a, b) => b.query.affinity - a.query.affinity).slice(0, take);
    return { results: { entities }, query: queryBlock };
  }

  #places(p, city, r, take) {
    if (!city) return [];
    const isVenue = list(p['filter.tags']).includes(MOCK_VENUE_TAG);
    const priceMax = p['filter.price_level.max'] ? Number(p['filter.price_level.max']) : 4;
    const patterns = isVenue ? VENUE_PATTERNS : AFTER_PATTERNS;
    const out = [];
    for (let i = 0; i < Math.max(take, 8); i++) {
      const w = VENUE_WORDS[Math.floor(rng(`${city.id}:${i}:${isVenue}`)() * VENUE_WORDS.length)];
      const name = patterns[i % patterns.length].replace('{w}', w);
      const rr = rng(`${city.id}:${name}`);
      const price = isVenue ? 2 + Math.floor(rr() * 2) : 1 + Math.floor(rr() * priceMax);
      if (price > priceMax) continue;
      const lat = city.lat + (rr() - 0.5) * 0.06, lng = city.lng + (rr() - 0.5) * 0.06;
      out.push({
        name, sub: 'urn:entity:place', desc: isVenue ? `Live music venue, ~${[350, 650, 900, 1400, 2200][Math.floor(rr() * 5)]} cap (synthetic)` : 'Bar / late-night spot (synthetic)',
        location: { lat: r3(lat), lon: r3(lng) },
        props: { address: `${100 + Math.floor(rr() * 900)} ${w} St, ${city.name}, ${city.state}`, price_level: price, business_rating: r3(3.8 + rr() * 1.1), geocode: { city: city.name, admin1_region: city.state, country_code: 'US' } },
      });
    }
    return out;
  }

  #heatmap(p, ids, r) {
    const take = Math.min(Number(p.take || 50), 50);
    const wkt = p['filter.location'];
    const fq = p['filter.location.query'];
    let points = [];
    if (wkt && /POLYGON/i.test(wkt)) {
      points = CITIES.map((c) => ({ c, lat: c.lat + (r() - 0.5) * 0.08, lng: c.lng + (r() - 0.5) * 0.08, aff: affinityFor(ids, c, 'hm') }));
    } else {
      const loc = findLocality(fq);
      if (!loc) throw new QlooError('QLOO_BAD_REQUEST', `No locality found for "${fq}"`, { status: 400 });
      const base = affinityFor(ids, loc.city, 'hm');
      points = Array.from({ length: 16 }, (_, i) => ({ c: loc.city, lat: loc.city.lat + (r() - 0.5) * 0.25, lng: loc.city.lng + (r() - 0.5) * 0.3, aff: r3(clamp(base + 0.25 * (r() - 0.5))) }));
    }
    const sorted = [...points].sort((a, b) => b.aff - a.aff);
    return points.slice(0, take).map((pt) => ({
      location: { latitude: r3(pt.lat), longitude: r3(pt.lng), geohash: encodeGeohash(pt.lat, pt.lng, 5) },
      query: { affinity: pt.aff, affinity_rank: r3(1 - sorted.indexOf(pt) / Math.max(1, sorted.length - 1)), popularity: r3(popNorm(pt.c) * (0.7 + 0.3 * r())) },
    }));
  }

  #compare(p) {
    const a = list(p['a.signal.interests.entities']), b = list(p['b.signal.interests.entities']);
    const r = rng(`cmp:${a}:${b}`);
    const take = Math.min(Number(p.take || 10), 50);
    // Upstream result item shape is NOT documented (external $include). This shape is our guess: TECH.md §2.6.
    return { results: SYNTH_TAGS.slice(0, take).map((t) => ({ name: t, entity_id: `urn:tag:mock:${slug(t)}`, subtype: 'urn:tag:mock', query: { a: { affinity: r3(r()) }, b: { affinity: r3(r()) } } })) };
  }

  #trending(p) {
    const ids = list(p['signal.interests.entities']);
    const start = new Date(p['filter.start_date']), end = new Date(p['filter.end_date']);
    if (Number.isNaN(+start) || Number.isNaN(+end) || start > end) throw new QlooError('QLOO_BAD_REQUEST', 'Invalid date range', { status: 400 });
    const r = rng(`tr:${ids.join(',')}`);
    const slope = (r() - 0.35) * 1.2;
    const pts = [];
    let pct = 60 + r() * 20;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      pct = clamp(pct + slope + (r() - 0.5) * 2.5, 1, 99.9);
      pts.push({ date: d.toISOString().slice(0, 10), population_percentile: r3(pct), population_rank: Math.round(9000 * (1 - pct / 100)) + 50, population_rank_velocity: Math.round(slope * 40 + (r() - 0.5) * 20), velocity_fold_change: r3(1 + slope / 10), population_percent_delta: r3(slope) });
    }
    return { results: { trending: pts.reverse().slice(0, Math.min(Number(p.take || 50), 50)) } };
  }

  #tags(p) {
    const q = (p['filter.query'] || '').toLowerCase();
    const take = Math.min(Number(p.take || 20), 50);
    const base = /venue|concert|music/.test(q) ? [{ id: MOCK_VENUE_TAG, name: 'Live Music Venue', type: 'urn:tag:mock:place' }, { id: 'urn:tag:mock:place:concert_hall', name: 'Concert Hall', type: 'urn:tag:mock:place' }] : [];
    const extra = SYNTH_TAGS.filter((t) => t.includes(q.split(' ')[0] || '~')).map((t) => ({ id: `urn:tag:mock:${slug(t)}`, name: t, type: 'urn:tag:mock' }));
    return { results: { tags: [...base, ...extra].slice(0, take).map((t) => ({ ...t, parents: [{ type: 'urn:entity:place' }] })) } };
  }
}

export const mockInternals = { registry, uuidFrom };
