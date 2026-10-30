// Evaluation (30 Oct): runs the five demo acts end to end against a deployed Tourbook (live Qloo, the real planner
// model), then three Ask Tourbook requests per act, and writes the measured table to docs/EVALUATION.md (+ .json).
//   node scripts/eval.mjs https://tourbook-q2d9.onrender.com
// No Qloo response data is stored: only counts, ids of our own metros, timings and pass/fail checks.
import { writeFileSync, mkdirSync } from 'node:fs';
import { LIVE_DEMOS } from '../src/data/demos.js';
import { CITY_BY_ID } from '../src/data/cities.js';
import { REGIONS } from '../src/agent/ask.js';

const base = (process.argv[2] || 'http://localhost:8787').replace(/\/+$/, '');
const post = async (path, body, headers = {}) => {
  const t0 = performance.now();
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const json = await r.json();
  return { status: r.status, json, ms: Math.round(performance.now() - t0) };
};
const SECTIONS = ['venue', 'opener', 'sponsor', 'after_party', 'crowd_brief'];
const picksOf = (sec) => sec?.picks || sec?.openers || sec?.sponsors || [...(sec?.shows || []), ...(sec?.podcasts || []), ...(sec?.themes || [])];
const cited = (sec) => { const p = sec?.provenance; return Array.isArray(p) ? p.length > 0 && p.every((x) => x?.path) : !!p?.path; };

const rows = [], asks = [];
for (const d of LIVE_DEMOS) {
  const type = d.type.split(':').pop();
  const plan = await post('/api/plan', { artist: d.name, proxies: d.proxies, type }, { 'Idempotency-Key': `eval-${d.name}-${Date.now()}` });
  const b = plan.json;
  if (plan.status !== 200 || !b.markets) { rows.push({ act: d.name, error: b.error || plan.status }); console.log('FAIL', d.name, b.error); continue; }
  const calls = (b.trace || []).filter((x) => x.type === 'call' && x.status !== 'start');
  const rejected = calls.filter((c) => c.status === 'rejected').length;
  const endpoints = new Set(calls.map((c) => c.path)).size;
  const types = new Set(calls.map((c) => c.params?.['filter.type']).filter(Boolean)).size;
  let sections = 0, citedSections = 0, picks = 0;
  for (const date of b.dates || []) for (const k of SECTIONS) if (date[k]) { sections++; if (cited(date[k])) citedSections++; picks += picksOf(date[k]).length; }
  const top = b.markets.top;
  const row = {
    act: d.name, kind: type, ms: plan.ms, qlooCalls: b.meta.calls, endpoints, filterTypes: types, rejected,
    planner: b.meta.llm, stops: top.length, hidden: top.filter((m) => m.hidden).length,
    changedByQloo: b.comparison?.onlyQloo?.length ?? null, heatCells: b.markets.heat?.total ?? 0,
    dossierSections: sections, citedSections, picks,
  };
  rows.push(row);
  console.log('plan', JSON.stringify(row));

  // Ask Tourbook: three requests per act
  const scores = Object.fromEntries(b.markets.all.map((m) => [m.id, { hms: m.hms, affinityRank: m.affinityRank, popRank: m.popRank, hidden: m.hidden }]));
  const tour = top.map((m) => m.id);
  const weakest = [...top].sort((x, y) => x.hms - y.hms)[0];
  const qs = [
    { q: 'Swap the weakest stop for somewhere in the South', region: 'south' },
    { q: 'Swap the weakest stop', region: null },
    { q: `Drop ${weakest.name}`, drop: weakest.id },
  ];
  for (const { q, region, drop } of qs) {
    const r = await post('/api/ask', { question: q, plan: { entityIds: [b.artist.selected.id, ...(b.proxies || []).map((p) => p?.selected?.id)].filter(Boolean), entityType: b.artist.selected.type, tour, scores } });
    const p = r.json.proposal;
    const checks = [];
    if (p) {
      checks.push(['tour size 3–10', p.tour.length >= 3 && p.tour.length <= 10]);
      checks.push(['added cities are real metros with a score, not already in the tour', p.add.every((id) => CITY_BY_ID[id] && scores[id] && !tour.includes(id))]);
      checks.push(['removed cities were in the tour', p.remove.every((id) => tour.includes(id))]);
      if (region && p.add.length) checks.push(['added city is in the region asked', p.add.every((id) => REGIONS[region].includes(CITY_BY_ID[id].state))]);
      if (drop) checks.push(['drops exactly the stop named', p.remove.length === 1 && p.remove[0] === drop && !p.add.length]);
      if (p.add.length) checks.push(['rooms checked with Qloo before adding', (r.json.steps || []).some((s) => s.name === 'check_rooms')]);
      if (!region && !drop && p.add.length) checks.push(['an unprompted swap only goes to a stronger city', p.add.every((id) => scores[id].hms > Math.min(...p.remove.map((x) => scores[x].hms)))]);
    }
    const a = { act: d.name, question: q, status: r.status, ms: r.ms, by: r.json.by, valid: !!p, holds: !!p?.holds, change: p ? { remove: p.remove, add: p.add } : null,
      qlooCalls: (r.json.calls || []).length, checks: checks.map(([name, ok]) => ({ name, ok })), passed: checks.every(([, ok]) => ok), errors: r.json.errors || null };
    asks.push(a);
    console.log('ask ', d.name, '|', q, '|', a.by, a.valid ? (a.holds ? 'holds' : JSON.stringify(a.change)) : 'INVALID', `${a.ms} ms`, a.passed ? 'checks ok' : 'CHECK FAILED');
  }
}

const ok = rows.filter((r) => !r.error);
const sum = (k) => ok.reduce((s, r) => s + (r[k] || 0), 0);
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : 0; };
const checksAll = asks.flatMap((a) => a.checks); const checksOk = checksAll.filter((c) => c.ok).length;
const today = new Date().toISOString().slice(0, 10);
const md = `# Tourbook — Evaluation

Measured on ${today} against the deployed app (${base}), with live Qloo data and the production planner
(${ok[0]?.planner || 'n/a'}). Reproduce: \`node scripts/eval.mjs ${base}\`. Only counts and pass/fail checks are
stored here, never Qloo response data.

## 1. Full plans, five demo acts

| Act | Kind | Qloo requests | Endpoints | filter.type values | Rejected params | Hidden markets in the tour | Stops a no-Qloo plan misses | Fan-heat cells | Dossier sections citing their Qloo request | Time |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.map((r) => r.error ? `| ${r.act} | failed: ${r.error} |||||||||| ` : `| ${r.act} | ${r.kind} | ${r.qlooCalls} | ${r.endpoints} | ${r.filterTypes} | ${r.rejected} | ${r.hidden} of ${r.stops} | ${r.changedByQloo ?? '–'} of ${r.stops} | ${r.heatCells.toLocaleString('en-US')} | ${r.citedSections} of ${r.dossierSections} | ${(r.ms / 1000).toFixed(1)} s |`).join('\n')}

- **${sum('rejected')} rejected parameters** across ${sum('qlooCalls')} Qloo requests: the validator refuses a bad request before it is sent.
- **${sum('citedSections')} of ${sum('dossierSections')} dossier sections** (room, opener, sponsor, after-show, crowd brief) carry the exact Qloo request behind them.
- **${sum('changedByQloo')} of ${sum('stops')} stops** across the five acts differ from the plan the same model makes without Qloo.
- Median time for a full plan: ${(med(ok.map((r) => r.ms)) / 1000).toFixed(1)} s (demo answers are served from the Qloo cache warmed at boot).

## 2. Ask Tourbook, three requests per act

| Act | Request | Answer | Qloo requests | Checks | Time |
|---|---|---|---|---|---|
${asks.map((a) => `| ${a.act} | ${a.question} | ${!a.valid ? `refused: ${(a.errors || []).join(' ')}` : a.holds ? 'the tour holds' : [...a.change.remove.map((id) => `− ${CITY_BY_ID[id].name}`), ...a.change.add.map((id) => `+ ${CITY_BY_ID[id].name}`)].join(', ')} | ${a.qlooCalls} | ${a.checks.filter((c) => c.ok).length}/${a.checks.length} | ${(a.ms / 1000).toFixed(1)} s |`).join('\n')}

- **${asks.filter((a) => a.valid).length} of ${asks.length}** requests returned a valid proposal (the server refuses anything else); **${checksOk} of ${checksAll.length}** independent checks pass.
- Checks: tour size 3–10; every added city is a real metro scored in this plan and not already in it; removed cities were in the tour;
  a named region is respected; "Drop X" drops exactly X; rooms are checked with Qloo before a city is added; an unprompted swap only goes to a stronger city.
- Answered by: ${[...new Set(asks.map((a) => a.by))].join(', ')}. Median time: ${(med(asks.map((a) => a.ms)) / 1000).toFixed(1)} s.

## 3. Limits, said plainly
- Scores rank taste, not ticket sales: no attendance forecast is made, and no real act has toured with it yet.
- The 34 candidate metros are a fixed list; a city outside it can't be proposed.
- Route length is a straight-line nearest-neighbour estimate, not a driving route.
`;
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/EVALUATION.md', import.meta.url), md);
writeFileSync(new URL('../docs/evaluation.json', import.meta.url), JSON.stringify({ base, date: today, plans: rows, asks }, null, 2));
console.log(`\nwrote docs/EVALUATION.md (${rows.length} plans, ${asks.length} asks, ${checksOk}/${checksAll.length} checks)`);
