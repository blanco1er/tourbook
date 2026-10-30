// Smoke test: boots the server in MOCK mode on a random port and checks every route.
// Usage: npm test   (never uses a Qloo or LLM key: forces QLOO_MODE=mock and LLM_PROVIDER=mock)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 9000 + Math.floor(Math.random() * 900);
const env = { ...process.env, PORT: String(port), QLOO_MODE: 'mock', LLM_PROVIDER: 'mock', QLOO_API_KEY: '', LLM_API_KEY: '' };
const srv = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
const base = `http://localhost:${port}`;
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

async function waitUp() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
}

try {
  await waitUp();
  const html = await (await fetch(`${base}/`)).text();
  ok(html.includes('<title>Tourbook</title>'), 'GET / serves the single-page app');
  ok((await fetch(`${base}/app.js`)).ok && (await fetch(`${base}/app.css`)).ok, 'static assets served');
  ok(html.includes('id="heroDemo"') && html.includes('Room mode') && html.includes('With Qloo') && html.includes('Without Qloo'), 'UI: one-click demo, with/without Qloo toggle, room mode');
  const js = await (await fetch(`${base}/app.js`)).text();
  ok(js.includes('Synthetic data'), 'UI labels mock results as synthetic data');

  const health = await (await fetch(`${base}/api/health`)).json();
  ok(health.qloo === 'mock' && health.llm === 'mock', `health: qloo=${health.qloo} llm=${health.llm}`);

  const cfg = await (await fetch(`${base}/api/config`)).json();
  ok(cfg.demos.length >= 3 && cfg.cities.length >= 30, `config: ${cfg.demos.length} demos, ${cfg.cities.length} cities`);

  const demo = cfg.demos[0];
  const plan = await (await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artist: demo.artist, proxies: demo.proxies }) })).json();
  ok(plan.markets?.top?.length >= 3, `plan: strategy=${plan.markets?.strategy}, top=${plan.markets?.top?.map((m) => m.id).join(',')}`);
  ok(plan.dates?.length === 3 && plan.dates.every((d) => d.venue && d.opener && d.sponsor && d.after_party && d.crowd_brief), 'plan: 3 complete date dossiers');
  ok(plan.baseline?.cities?.length > 0 && plan.comparison, 'plan: LLM-only baseline + comparison');
  ok(plan.audience && plan.momentum?.series?.length > 0, 'plan: audience profile + momentum');
  ok(plan.trace.filter((t) => t.type === 'call' && t.status === 'rejected').length === 0, 'plan: no Qloo call rejected by the param validator');
  ok(plan.trace.filter((t) => t.type === 'tool' && t.status === 'error').length === 0, 'plan: no tool error');

  const ids = [plan.artist.selected.id, ...plan.proxies.map((p) => p.selected.id)].join(',');
  const mk = await (await fetch(`${base}/api/markets?entities=${ids}`)).json();
  ok(mk.markets?.length >= 30 && mk.calls?.length >= 1, `markets: ${mk.markets?.length} scored, ${mk.calls?.length} call(s)`);

  const city = await (await fetch(`${base}/api/city/denver?entities=${ids}`)).json();
  ok(city.venue?.picks?.length > 0 && city.opener?.openers?.length > 0, `city dossier: venue=${city.venue?.picks?.[0]?.name}`);

  const base_ = await (await fetch(`${base}/api/baseline?artist=${encodeURIComponent(demo.artist)}&qlooTop=asheville,portland`)).json();
  ok(base_.baseline?.cities?.length === 8, 'baseline endpoint');

  const venue = await (await fetch(`${base}/api/venue?neighborhood=${encodeURIComponent('Lower East Side')}&popMax=0.6`)).json();
  ok(venue.acts?.length > 0 && venue.acts.every((a) => a.popularity <= 0.6), `venue mode: ${venue.acts?.length} acts <= 0.6 popularity`);

  const bad = await fetch(`${base}/api/venue?neighborhood=Atlantis`);
  ok(bad.status === 400, `unknown locality -> HTTP ${bad.status} (mirrors Qloo 400)`);

  const sse = await fetch(`${base}/api/plan/stream?artist=${encodeURIComponent('Night Shift Radio')}&type=podcast`);
  const text = await sse.text();
  ok(text.includes('event: plan') && text.includes('event: call') && text.includes('event: done'), 'SSE stream emits plan/call/done');

  // ---- UB-31 double run: a double click must never start two plans server-side ----
  const runIdOf = (t) => JSON.parse(t.split('event: plan\ndata: ')[1].split('\n')[0]).runId;
  const started = async () => (await (await fetch(`${base}/api/health`)).json()).runsStarted;
  const s0 = await started();
  const rid = `smoke-${Date.now()}`;
  const q = `artist=${encodeURIComponent(demo.artist)}&proxies=${encodeURIComponent(demo.proxies.join(','))}&type=artist`;
  const [a1, a2] = await Promise.all([1, 2].map(() => fetch(`${base}/api/plan/stream?${q}&rid=${rid}`).then((r) => r.text())));
  ok(runIdOf(a1) === runIdOf(a2) && a2.includes('event: done') && a1.includes('event: done'), 'double run (same request id, concurrent): both streams get the same plan');
  ok((await started()) - s0 === 1, `double run (same request id): server started ${(await started()) - s0} run (expected 1)`);
  const a3 = await (await fetch(`${base}/api/plan/stream?${q}&rid=${rid}`)).text();
  ok(runIdOf(a3) === runIdOf(a1) && (await started()) - s0 === 1, 'reconnect after the end replays the plan, no new run');
  const s1 = await started();
  const q2 = `artist=${encodeURIComponent(demo.artist)}&proxies=${encodeURIComponent(demo.proxies.slice(0, 2).join(','))}&type=artist`;
  const [b1, b2] = await Promise.all([1, 2].map(() => fetch(`${base}/api/plan/stream?${q2}`).then((r) => r.text())));
  ok(runIdOf(b1) === runIdOf(b2) && (await started()) - s1 === 1, 'double run without request id: identical input in flight is joined');
  const s2 = await started();
  const post = () => fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `smoke-post-${s2}` }, body: JSON.stringify({ artist: demo.artist, proxies: demo.proxies }) });
  const [p1, p2] = await Promise.all([post(), post()]);
  const [j1, j2] = [await p1.json(), await p2.json()];
  ok(j1.runId === j2.runId && (await started()) - s2 === 1 && [p1, p2].some((r) => r.headers.get('idempotent-replay') === 'true'), 'POST /api/plan with the same Idempotency-Key: one run, one replay');
  const c1 = await (await fetch(`${base}/api/plan/stream?${q}&rid=${rid}-new`)).text();
  ok(runIdOf(c1) !== runIdOf(a1), 'a new request id (deliberate re-run) starts a fresh plan');
  ok(js.includes('S.running') && js.includes('rid'), 'UI: run button locked while running and a request id sent per click');

  // ---- language: English by default, French on demand (UI dictionary + agent text) ----
  const i18n = await fetch(`${base}/i18n.js`);
  const i18nJs = await i18n.text();
  ok(i18n.ok && i18nJs.includes("'Room mode': 'Mode salle'") && html.includes('src="/i18n.js"') && html.includes('data-lang="fr"'), 'i18n: /i18n.js served, loaded by the page, FR / EN switch present');
  const planFr = await (await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artist: demo.artist, proxies: demo.proxies, lang: 'fr' }) })).json();
  ok(/^Le marché le plus fort de /.test(planFr.summary || '') && planFr.summary.includes('Score de marché caché'), `i18n: French summary in mock mode ("${(planFr.summary || '').slice(0, 60)}…")`);
  ok(planFr.trace.filter((x) => x.type === 'thought').every((x) => !/^Resolving|^Ranking|^Profiling|^Checking/.test(x.text)), 'i18n: French run narrates in French');
  ok(planFr.runId !== plan.runId && JSON.stringify(planFr.markets.top.map((m) => m.id)) === JSON.stringify(plan.markets.top.map((m) => m.id)), 'i18n: FR run is a distinct run with the same facts (same top markets)');
  ok(/^.+'s strongest market is .+ \(Hidden Market Score \d+\)\./.test(plan.summary) && plan.summary.endsWith('Each date below comes with a room, an opener, a sponsor fit and a crowd brief, all traceable to Qloo calls.'), 'i18n: English summary unchanged');
  const badLang = await (await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artist: demo.artist, proxies: demo.proxies, lang: 'de' }) })).json();
  ok(badLang.summary === plan.summary || badLang.summary?.startsWith(`${demo.artist}'s strongest market`), 'i18n: unknown lang falls back to English');

  // Ask Tourbook (30 Oct): one follow-up change, validated by the server
  const { CITIES: cities } = await import('../src/data/cities.js');
  ok(Array.isArray(plan.markets.heat?.cells) && plan.markets.heat.cells.length > 0 && plan.markets.heat.cells.every((c) => c.length === 3 && c[2] >= 0.4 && c[2] <= 1), `fan heat: ${plan.markets.heat?.cells?.length ?? 0} cells from the national heatmap call, weights in [0.4, 1]`);
  const askPlan = { entityIds: [plan.artist.selected.id], tour: plan.markets.top.map((m) => m.id), scores: Object.fromEntries(plan.markets.all.map((m) => [m.id, { hms: m.hms, affinityRank: m.affinityRank, popRank: m.popRank, hidden: m.hidden }])) };
  const askOf = async (question, extra = {}) => (await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, plan: { ...askPlan, ...extra } }) })).json();
  const south = await askOf('Swap the weakest stop for somewhere in the South');
  const southStates = ['DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'KY', 'TN', 'AL', 'MS', 'AR', 'LA', 'OK', 'TX'];
  const added = south.proposal?.add?.[0];
  ok(south.proposal && south.proposal.remove.length === 1 && added && southStates.includes(cities.find((c) => c.id === added)?.state) && south.steps.some((s) => s.name === 'check_rooms'), `ask: "somewhere in the South" swaps one stop for a Southern metro after a room check (${south.proposal?.remove?.[0]} -> ${added})`);
  ok(Number.isFinite(south.proposal?.before?.km) && Number.isFinite(south.proposal?.after?.meanHms) && south.proposal.tour.length === askPlan.tour.length, 'ask: the server computes before/after (route km, mean HMS) and keeps the tour size on a swap');
  const drop = await askOf(`Drop ${cities.find((c) => c.id === askPlan.tour[1]).name}`);
  ok(drop.proposal?.remove?.[0] === askPlan.tour[1] && !drop.proposal.add.length, 'ask: "Drop <city>" removes exactly that stop');
  const noTour = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x', plan: { ...askPlan, tour: [] } }) });
  ok(noTour.status === 400, 'ask: a plan without a tour is refused (400)');
  const { validateProposal } = await import('../src/agent/ask.js');
  const v = validateProposal({ remove: [askPlan.tour[0]], add: ['new-york'], reason: '' }, { tour: askPlan.tour, scores: askPlan.scores, seen: new Set() });
  ok(!v.ok && v.errors.some((e) => /find_markets/.test(e)), 'ask: a city the agent never looked up is refused (no invented stops)');
} catch (e) {
  console.error(e); failed++;
} finally {
  srv.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
