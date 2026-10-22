// LIVE probe battery: run ONCE when the Qloo key arrives, to settle every ⚠️ in TECH.md.
// Usage:  QLOO_API_KEY=... node scripts/probe.mjs --yes [--artist "Name"] [--city Denver]
// - Refuses to run without a key and without --yes (it spends real quota: ~16 GET calls).
// - Writes a report to .cache/probe-report.json (gitignored). Raw responses stay in .cache/ only:
//   NEVER copy them into the repo (hackathon rule).
import { mkdir, writeFile } from 'node:fs/promises';
import { HttpQlooClient } from '../src/qloo/client.js';
import { FileCache } from '../src/qloo/cache.js';
import { Limiter } from '../src/qloo/limiter.js';
import { config } from '../src/config.js';
import { US_WKT } from '../src/data/cities.js';

const args = process.argv.slice(2);
const arg = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
if (!config.qloo.apiKey) { console.error('No QLOO_API_KEY: nothing to probe.'); process.exit(1); }
if (!args.includes('--yes')) { console.error('This spends real Qloo quota. Re-run with --yes.'); process.exit(1); }

const artist = arg('artist', 'Khruangbin');
const city = arg('city', 'Denver');
const qloo = new HttpQlooClient({
  baseUrl: arg('base', config.qloo.baseUrl), apiKey: config.qloo.apiKey,
  cache: new FileCache(config.qloo.cacheDir), limiter: new Limiter({ maxConcurrency: 1, minIntervalMs: 400 }),
  strictParams: false, // we WANT to see what the API does with edge params
});

const report = { at: new Date().toISOString(), base: qloo.baseUrl, artist, city, tests: [] };
async function test(id, label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    const r = out?.body?.results;
    const shape = Array.isArray(r) ? `results[${r.length}]` : r ? Object.entries(r).map(([k, v]) => `${k}${Array.isArray(v) ? `[${v.length}]` : ''}`).join(',') : 'no results';
    const sample = Array.isArray(r) ? r[0] : r && Object.values(r).find(Array.isArray)?.[0];
    report.tests.push({ id, label, ok: true, ms: Date.now() - t0, shape, sampleKeys: sample ? Object.keys(sample) : [], sampleQueryKeys: sample?.query ? Object.keys(sample.query) : [], topKeys: Object.keys(out.body || {}) });
    console.log(`OK   ${id} ${label} -> ${shape}`);
    return out;
  } catch (e) {
    report.tests.push({ id, label, ok: false, ms: Date.now() - t0, status: e.status, code: e.code, error: e.message });
    console.log(`FAIL ${id} ${label} -> ${e.status ?? ''} ${e.code ?? ''} ${e.message}`);
  }
}

const s = await test('T0', 'search artist', () => qloo.search({ query: artist, types: 'urn:entity:artist', take: 5 }));
const list = Array.isArray(s?.body?.results) ? s.body.results : s?.body?.results?.entities || [];
const id = list[0]?.entity_id || list[0]?.id;
if (!id) { console.error('Could not resolve the artist; stopping.'); }
else {
  const sig = { 'signal.interests.entities': id };
  await test('T1', 'heatmap within city (where_popular)', () => qloo.heatmap({ ...sig, 'filter.location.query': city, take: 20 }));
  await test('T1b', 'heatmap nationwide WKT', () => qloo.heatmap({ ...sig, 'filter.location': US_WKT, take: 50 }));
  await test('T1c', 'heatmap boundary=locality', () => qloo.heatmap({ ...sig, 'filter.location': US_WKT, 'output.heatmap.boundary': 'urn:entity:locality', take: 50 }));
  await test('T2', 'demographics', () => qloo.demographics(sig));
  await test('T3', 'artist recs + explainability + popularity.max', () => qloo.insights({ 'filter.type': 'urn:entity:artist', ...sig, 'filter.popularity.max': 0.85, 'feature.explainability': true, take: 5 }));
  await test('T4', 'artist scored in a city (signal.location.query + filter.results.entities)', () => qloo.insights({ 'filter.type': 'urn:entity:artist', 'signal.location.query': city, 'filter.results.entities': id, take: 1 }));
  await test('T5', 'places in city (filter.location.query)', () => qloo.insights({ 'filter.type': 'urn:entity:place', ...sig, 'filter.location.query': city, take: 10 }));
  await test('T6', 'tags search "live music venue"', () => qloo.tags({ 'filter.query': 'live music venue', 'feature.semantic_search': true, take: 10 }));
  await test('T7', 'brands for fan base', () => qloo.insights({ 'filter.type': 'urn:entity:brand', ...sig, take: 5 }));
  await test('T8', 'tv shows with location signal', () => qloo.insights({ 'filter.type': 'urn:entity:tv_show', ...sig, 'signal.location.query': city, take: 5 }));
  await test('T9', 'urn:tag taste analysis', () => qloo.tagInsights({ ...sig, 'signal.location.query': city, take: 8 }));
  const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - 182);
  await test('T10', 'trending 26 weeks', () => qloo.trending({ 'filter.type': 'urn:entity:artist', ...sig, 'filter.start_date': start.toISOString().slice(0, 10), 'filter.end_date': end.toISOString().slice(0, 10), take: 50 }));
  if (list[1]) await test('T11', 'compare A vs B', () => qloo.compare({ 'a.signal.interests.entities': id, 'b.signal.interests.entities': list[1].entity_id || list[1].id, take: 10 }));
  await test('T12', 'venue mode: artists for a neighbourhood', () => qloo.insights({ 'filter.type': 'urn:entity:artist', 'signal.location.query': 'Lower East Side', 'filter.popularity.max': 0.7, take: 10 }));
  await test('T13', 'SILENT-IGNORE check: filter.location.query on artist (should be ignored)', () => qloo.insights({ 'filter.type': 'urn:entity:artist', ...sig, 'filter.location.query': city, take: 3 }));
  await test('T14', 'podcast type accepted', () => qloo.insights({ 'filter.type': 'urn:entity:podcast', ...sig, take: 3 }));
}

await mkdir(config.qloo.cacheDir.replace(/\/qloo$/, ''), { recursive: true });
const out = config.qloo.cacheDir.replace(/\/qloo$/, '') + '/probe-report.json';
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nReport: ${out} (gitignored; contains shapes and keys only, no payloads)`);
