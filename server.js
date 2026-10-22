// Tourbook server: Express API + static single-page frontend.
// The browser never talks to Qloo or the LLM directly: keys stay server-side (kit rule).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './src/config.js';
import { createQlooClient, traceStore } from './src/qloo/index.js';
import { createLLM, MockLLM } from './src/agent/llm.js';
import { runAgent } from './src/agent/runner.js';
import { createRunRegistry, runKey } from './src/agent/runs.js';
import { rankMarkets } from './src/domain/markets.js';
import { cityDossier } from './src/domain/dossier.js';
import { venueMode } from './src/domain/venue.js';
import { llmOnlyBaseline, compareWithQloo } from './src/domain/baseline.js';
import { CITIES } from './src/data/cities.js';
import { DEMO_ARTISTS, NEIGHBORHOOD_SUGGESTIONS } from './src/data/fixtures.js';
import { LIVE_DEMOS } from './src/data/demos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const qloo = createQlooClient();
const llm = createLLM();
const DEMOS = qloo.mode === 'live' ? LIVE_DEMOS : DEMO_ARTISTS;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's proxy: req.ip is the visitor, so the daily cap is per visitor
app.use(express.json({ limit: '32kb' }));
app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));

// ---- guardrail: N agent runs per IP per day (protects LLM + Qloo quota during judging) ----
const runs = new Map();
function takeRun(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${ip}`;
  const n = (runs.get(key) || 0) + 1;
  if (n > config.runsPerIpPerDay) return false;
  runs.set(key, n);
  if (runs.size > 5000) runs.clear();
  return true;
}
const CAP_MSG = 'Daily demo limit reached for this address. Try a precomputed demo.';

// ---- idempotency: one plan per request, however many times it is sent ----
// The client sends a request id (`rid` query param or Idempotency-Key header) per click. Duplicates
// (double click, reconnect, second tab) join the run in flight or replay it; they never start a new
// plan and never count against the daily cap. Without an id, identical input from the same address
// is de-duplicated while the run is in flight (and for 5 s after it ends).
const registry = createRunRegistry();
const ridOf = (req) => String(req.query.rid || req.get('Idempotency-Key') || '').slice(0, 64);
function startPlan(req, input) {
  const rid = ridOf(req);
  const key = runKey({ rid, ip: req.ip, input });
  return registry.start(key, (emit) => runAgent({ input, qloo, llm, emit }), { ttlMs: rid ? 10 * 60 * 1000 : 5000, admit: () => takeRun(req.ip) });
}

const parseInput = (src) => {
  const proxies = Array.isArray(src.proxies) ? src.proxies : String(src.proxies || '').split(',');
  const type = ['artist', 'person', 'podcast'].includes(src.type) ? src.type : 'artist';
  return { artist: String(src.artist || '').trim().slice(0, 120), proxies: proxies.map((p) => String(p).trim().slice(0, 120)).filter(Boolean).slice(0, 3), type };
};
const ids = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message, code: e.code, details: e.attempts || e.details }));

app.get('/api/health', (req, res) => res.json({ ok: true, qloo: qloo.mode, llm: llm.kind, runsStarted: registry.started, time: new Date().toISOString() }));

app.get('/api/config', (req, res) => res.json({
  qloo: { mode: qloo.mode, strategy: config.qloo.marketStrategy },
  llm: { provider: llm.kind, model: llm.model },
  demos: DEMOS.map((d) => ({ artist: d.name, proxies: d.proxies, type: d.type.split(':').pop(), blurb: d.blurb })),
  neighborhoods: NEIGHBORHOOD_SUGGESTIONS,
  cities: CITIES.map(({ id, name, state, lat, lng, pop }) => ({ id, name, state, lat, lng, pop })),
}));

// Full agent run, JSON (curl-friendly). Send an Idempotency-Key header to make retries safe.
app.post('/api/plan', wrap(async (req, res) => {
  const input = parseInput(req.body || {});
  if (!input.artist) return res.status(400).json({ error: 'artist is required' });
  const started = startPlan(req, input);
  if (!started) return res.status(429).json({ error: CAP_MSG });
  const { run, joined } = started;
  await run.promise;
  if (run.error) throw run.error;
  const trace = run.events.filter(([t]) => t !== 'done').map(([type, data]) => ({ type, ...data }));
  if (joined) res.set('Idempotent-Replay', 'true');
  res.json({ ...run.result, trace });
}));

// Full agent run, streamed (Server-Sent Events) for the live "agent studio".
app.get('/api/plan/stream', (req, res) => {
  const input = parseInput(req.query);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!input.artist) { send('fail', { error: 'artist is required' }); return res.end(); }
  const started = startPlan(req, input);
  if (!started) { send('fail', { error: CAP_MSG, code: 'daily_cap' }); return res.end(); }
  const { run, joined } = started;
  if (joined) send('joined', { note: 'Same request id: attached to the plan already running. No second run was started.' });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  let closed = false;
  const finish = () => { if (closed) return; closed = true; clearInterval(ping); stop(); res.end(); };
  const stop = run.subscribe((type, data) => { if (closed) return; send(type, data); if (type === 'done' || type === 'fail') setImmediate(finish); });
  if (run.finishedAt) finish();
  req.on('close', () => { closed = true; clearInterval(ping); stop(); }); // the run itself continues: a reconnect replays it
});

// Direct (non-agent) endpoints used by the UI for interactions after the run.
const traced = (fn) => wrap(async (req, res) => {
  const calls = [];
  const out = await traceStore.run({ emit: (t, d) => t === 'call' && d.status !== 'start' && calls.push(d) }, () => fn(req));
  res.json({ ...out, calls });
});

app.get('/api/resolve', traced(async (req) => {
  const type = { artist: 'urn:entity:artist', person: 'urn:entity:person', podcast: 'urn:entity:podcast' }[req.query.type] || 'urn:entity:artist';
  const { body, provenance } = await qloo.search({ query: String(req.query.q || '').slice(0, 120), types: type, take: 5 });
  const list = Array.isArray(body?.results) ? body.results : body?.results?.entities || [];
  return { candidates: list.map((e) => ({ id: e.entity_id || e.id, name: e.name, type: e.subtype || e.types?.[0], popularity: e.popularity })), provenance };
}));

app.get('/api/markets', traced(async (req) => {
  const out = await rankMarkets(qloo, { entityIds: ids(req.query.entities), entityType: req.query.type || 'urn:entity:artist', topN: Number(req.query.top || 8) });
  return out;
}));

app.get('/api/city/:id', traced(async (req) => cityDossier(qloo, { entityIds: ids(req.query.entities), entityType: req.query.type || 'urn:entity:artist', cityId: req.params.id })));

app.get('/api/baseline', traced(async (req) => {
  const baseline = await llmOnlyBaseline(llm, { artistName: String(req.query.artist || 'this artist'), n: Number(req.query.n || 8) });
  const qlooTop = ids(req.query.qlooTop).map((id) => ({ id }));
  return { baseline, comparison: qlooTop.length ? compareWithQloo(baseline, qlooTop) : null };
}));

app.get('/api/venue', traced(async (req) => venueMode(qloo, { neighborhood: String(req.query.neighborhood || '').slice(0, 120), popularityMax: Math.min(1, Math.max(0.1, Number(req.query.popMax || 0.7))) })));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(config.port, () => {
  console.log(`Tourbook on http://localhost:${config.port}  (Qloo: ${qloo.mode}, LLM: ${llm.kind}${llm.model ? `:${llm.model}` : ''})`);
  if (qloo.mode === 'live' && process.env.WARM_DEMOS !== 'false') warmDemos();
});

// Fill the private Qloo cache with the demo acts at boot (scripted planner, no model calls), so a judge's
// first click on a demo answers in seconds. Sequential and best-effort: a failure only means a slower first run.
async function warmDemos() {
  const planner = new MockLLM();
  for (const d of DEMOS) {
    const input = { artist: d.name, proxies: d.proxies, type: d.type.split(':').pop() };
    try { await runAgent({ input, qloo, llm: planner }); console.log(`[warm] ${d.name}`); }
    catch (e) { console.warn(`[warm] ${d.name}: ${e.message}`); }
  }
}
