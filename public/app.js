// Tourbook frontend (vanilla ES module). Talks only to our server, never to Qloo or the LLM.
// Design: shared design system (design-system/*), Apple HIG patterns: sidebar + toolbar + sheets + toasts.
import { UI, spring, toast, openSheet, closeSheet } from '/design-system/motion.js';

// i18n.js (loaded first) provides LANG, LOCALE, t(), tData() and dec(); English stays the source text.
const { LANG, LOCALE, t, tData, dec } = window;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}` : '–');
const fmtPop = (n) => (LANG === 'fr'
  ? (n >= 1e6 ? `${dec((n / 1e6).toFixed(1))}\u00a0M` : `${Math.round(n / 1e3)}\u00a0k`)
  : (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`));
const signed = (n, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${dec(Math.abs(n).toFixed(d))}`;
const plural = (n, w, p = `${w}s`) => `${n} ${(LANG === 'fr' ? n <= 1 : n === 1) ? t(w) : t(p)}`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const isWide = () => innerWidth >= 1000;
const TYPE_LABEL = { artist: 'Music', person: 'Comedy', podcast: 'Live podcast' };
const TYPE_ICON = { artist: 'i-note', person: 'i-mic', podcast: 'i-wave' };
const icon = (id, cls = '') => `<svg class="ui-icon ${cls}"><use href="#${id}"/></svg>`;
const newRid = () => (crypto.randomUUID ? crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const VIEW_META = {
  plan: { title: 'Tour plan', sub: 'Route a tour by taste, not population' },
  agent: { title: 'Agent', sub: 'No run yet' },
  rooms: { title: 'Room mode', sub: 'For venues and promoters' },
};

const S = {
  cfg: null, book: null, plan: 'qloo', map: null, markers: [], cities: {}, es: null, dossiers: {}, calls: [], tools: 0,
  trace: [], input: null, running: false, rid: null, retryRid: null, view: 'plan', dossierId: null, t0: 0, liveTop: null, curTool: null, venueBusy: false,
};

init();

// ---------------- boot ----------------
async function init() {
  bindUi();
  try {
    const r = await fetch('/api/config');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.cfg = await r.json();
  } catch (e) {
    showPlanError(t('Tourbook can’t reach its server'), t('{error}. Reload the page in a moment.', { error: e.message }), false);
    $('#sourceLabel').textContent = t('Offline');
    return;
  }
  S.cities = Object.fromEntries(S.cfg.cities.map((c) => [c.id, c]));
  const live = S.cfg.qloo.mode === 'live';
  $('#sourceLabel').textContent = live ? t('Live Qloo data') : t('Synthetic data');
  $('#sourceLabel').className = `ui-status ui-subhead ${live ? 'ui-status--ok' : 'ui-status--info'}`;
  $('#sourceDetail').textContent = live
    ? t('Qloo Insights API, aggregate taste only. Agent: {model}.', { model: S.cfg.llm.model || S.cfg.llm.provider })
    : t('No Qloo key on this server yet. Acts, venues and numbers are invented; every request has Qloo’s real shape.');
  renderDemos();
  $('#hoodChips').innerHTML = S.cfg.neighborhoods.map((n) => `<button class="ui-button ui-button--sm" type="button" data-hood="${esc(n)}" aria-pressed="false">${esc(n)}</button>`).join('');
  if ('speechSynthesis' in window) $('#voiceBtn').hidden = false;
  initMap();
  routeFromUrl();
}

const heroLabel = () => t('Run the {name} demo', { name: S.cfg?.demos?.[0]?.artist || '' }).replace('  ', ' ').trim();

function renderDemos() {
  const demos = S.cfg.demos;
  const blurb = (d) => t(String(d.blurb || '').replace(/\s*\(synthetic\)\s*$/i, ''));
  $('#sideDemos').innerHTML = demos.map((d, i) => `<button class="ui-nav-item" type="button" data-run-demo="${i}">${icon(TYPE_ICON[d.type] || 'i-note')}<span>${esc(d.artist)}<small>${esc(t(TYPE_LABEL[d.type] || 'Music'))} · ${esc(blurb(d))}</small></span></button>`).join('');
  const label = heroLabel();
  $('#heroDemo span').textContent = label;
  $$('[data-demo-label]').forEach((b) => { b.textContent = label; });
  $('#demoActsNote').textContent = S.cfg.qloo.mode === 'live' ? t('Real acts, live Qloo data') : t('Synthetic, one tap each');
  $('#bodyDemos').innerHTML = demos.map((d, i) => `<li><button class="ui-row" type="button" data-run-demo="${i}"><span class="ui-row__icon">${icon(TYPE_ICON[d.type] || 'i-note')}</span><span class="ui-row__body"><span class="ui-row__title">${esc(d.artist)}</span><span class="ui-row__subtitle">${esc(t(TYPE_LABEL[d.type] || 'Music'))} · ${esc(blurb(d))}</span></span>${icon('i-chev-r', 'ui-row__chevron')}</button></li>`).join('');
}

// iOS Safari ignores user-scalable=no: block the page pinch itself (the map's own pinch uses touch events and still works).
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

function bindUi() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); setView(nav.dataset.nav); return; }
    const demo = e.target.closest('[data-run-demo]');
    if (demo) { e.preventDefault(); runDemo(Number(demo.dataset.runDemo)); return; }
    if (e.target.closest('[data-new-plan]')) { openPlanSheet(); return; }
    if (e.target.closest('[data-sidebar-toggle]')) { toggleSidebar(); return; }
    if (e.target.closest('[data-sidebar-close]')) { toggleSidebar(false); return; }
    const hood = e.target.closest('[data-hood]');
    if (hood) { $('#vHood').value = hood.dataset.hood; venueSearch(); return; }
    const city = e.target.closest('[data-city]');
    if (city && !e.target.closest('.mk')) openDossier(city.dataset.city);
  });
  $('#planForm').addEventListener('submit', (e) => { e.preventDefault(); submitPlanForm(); });
  $('#fArtist').addEventListener('input', () => { $('#fArtist').removeAttribute('aria-invalid'); $('#fArtistErr').hidden = true; });
  $('#planToggle').addEventListener('change', (e) => setPlan(e.target.value));
  $('#compareFlip').addEventListener('click', () => { setPlan(S.plan === 'qloo' ? 'llm' : 'qloo'); $('#mapwrap').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' }); });
  $('#marketsMore').addEventListener('click', () => {
    const tbl = $('#marketsTable'); const all = tbl.classList.toggle('is-all');
    $('#marketsMore').textContent = all ? t('Show top 12') : t('Show all {n}', { n: S.book?.markets?.all?.length || 34 });
    $('#marketsCount').textContent = all ? t('{a} of {b}', { a: S.book.markets.all.length, b: S.book.markets.all.length }) : t('{a} of {b}', { a: 12, b: S.book.markets.all.length });
  });
  $('#retryBtn').addEventListener('click', () => { if (S.input) run(S.input, { rid: S.retryRid || undefined }); else location.reload(); });
  $('#voiceBtn').addEventListener('click', toggleVoice);
  $('#voiceStop').addEventListener('click', stopVoice);
  $('#shareBtn').addEventListener('click', share);
  $('#printBtn').addEventListener('click', () => {
    // Phones: window.print() does nothing in in-app browsers, so the app builds the PDF and opens the share sheet.
    if (matchMedia('(pointer: coarse)').matches) return savePlanPdf();
    buildPrintDossiers(); window.print();
  });
  $('#dossierNext').addEventListener('click', nextDossier);
  $('#sheet-dossier').addEventListener('close', () => { S.dossierId = null; });
  $('#zoomIn').addEventListener('click', () => S.map?.zoomIn());
  $('#zoomOut').addEventListener('click', () => S.map?.zoomOut());
  $('#zoomFit').addEventListener('click', () => fitTour(true));
  $('#mapExpand').addEventListener('click', () => setMapExpanded(!$('#mapwrap').classList.contains('is-expanded')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#mapwrap').classList.contains('is-expanded')) setMapExpanded(false); });
  $('#vPop').addEventListener('input', (e) => { $('#vPopVal').textContent = dec(Number(e.target.value).toFixed(2)); });
  $('#venueForm').addEventListener('submit', (e) => { e.preventDefault(); venueSearch(); });
  $('#vHood').addEventListener('input', () => { $('#vHood').removeAttribute('aria-invalid'); $('#vHoodErr').hidden = true; });
  addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEW_META[v] && v !== S.view) setView(v, { fromHash: true }); });
  addEventListener('resize', () => { if (isWide()) toggleSidebar(false); });
}

// ---------------- navigation ----------------
function setView(view, { fromHash = false } = {}) {
  if (!VIEW_META[view]) view = 'plan';
  S.view = view;
  for (const v of Object.keys(VIEW_META)) $(`#view-${v}`).hidden = v !== view;
  $$('.ui-nav-item[data-nav]').forEach((a) => (a.dataset.nav === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $$('.ui-tabs-top a').forEach((a) => (a.dataset.nav === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const tab = $(`.ui-tabbar__item[data-nav="${view}"]`);
  if (tab) $('.ui-tabbar').dispatchEvent(new CustomEvent('ui:select', { detail: tab }));
  if (!fromHash) history.replaceState(null, '', `${location.pathname}${location.search}${view === 'plan' ? '' : `#${view}`}`);
  toggleSidebar(false);
  updateToolbar();
  if (view === 'plan') requestAnimationFrame(() => S.map?.resize());
  scrollTo({ top: 0, behavior: 'auto' });
}
function updateToolbar() {
  const m = VIEW_META[S.view];
  let title = t(m.title), sub = t(m.sub);
  const synthetic = S.cfg && S.cfg.qloo.mode !== 'live';
  if (S.view === 'plan' && (S.running || S.book)) {
    title = S.book?.artist?.selected?.name || S.input?.artist || title;
    sub = S.running ? t('Agent working…') : `${t(TYPE_LABEL[S.input?.type] || 'Music')} · ${synthetic ? `${t('synthetic data')} · ` : ''}${S.book.meta.ms < 1000 ? t('replayed from cached Qloo answers') : t('planned in {s} s', { s: dec((S.book.meta.ms / 1000).toFixed(1)) })}`;
  }
  if (S.view === 'agent' && (S.running || S.book)) sub = `${plural(S.tools, 'tool call')} · ${plural(S.calls.length, 'Qloo request')}${S.running ? ` · ${t('running')}` : ''}`;
  $('#tbTitle').textContent = title;
  $('#tbSub').textContent = sub;
  document.title = S.view === 'plan' && S.book ? `${title} · Tourbook` : 'Tourbook';
  $('#planTools').hidden = !(S.view === 'plan' && S.book && !S.running);
  $('#newPlanBtn').classList.toggle('ui-button--prominent', Boolean(S.book) && S.view === 'plan');
  const n = S.calls.length; $('[data-agent-count]').textContent = n ? n : '';
}
function toggleSidebar(force) {
  const app = $('#app');
  if (isWide()) { if (force === undefined) { app.classList.toggle('is-sidebar-collapsed'); setTimeout(() => { S.map?.resize(); fitTour(false); }, 760); } return; }
  const open = force ?? !app.classList.contains('is-sidebar-open');
  app.classList.toggle('is-sidebar-open', open);
  $('.sidebar-scrim').hidden = !open;
  if (open) $('#sidebar .ui-nav-item[aria-current]')?.focus({ preventScroll: true });
}
function routeFromUrl() {
  const q = new URLSearchParams(location.search);
  const hash = location.hash.slice(1);
  if (q.get('view') === 'room' || hash === 'rooms') setView('rooms', { fromHash: true });
  else if (hash === 'agent') setView('agent', { fromHash: true });
  else updateToolbar();
  if ((q.has('demo') || q.get('artist')) && restoreSession()) return;
  if (q.has('demo')) {
    const v = q.get('demo');
    const i = /^\d+$/.test(v) ? Number(v) : S.cfg.demos.findIndex((d) => slug(d.artist) === v);
    if (i >= 0 && S.cfg.demos[i]) return runDemo(i, { keepView: true, rid: pendingRid() });
  }
  if (q.get('artist')) {
    run({ artist: q.get('artist').slice(0, 120), proxies: (q.get('proxies') || '').split(',').map((p) => p.trim()).filter(Boolean).slice(0, 3), type: TYPE_LABEL[q.get('type')] ? q.get('type') : 'artist' }, { keepView: true, rid: pendingRid() });
  }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------- new plan sheet ----------------
function openPlanSheet() {
  if (S.running) { toast({ title: t('The agent is still working'), detail: t('Wait for this plan to finish, then start another.') }); return; }
  openSheet('sheet-plan');
  setTimeout(() => $('#fArtist').focus({ preventScroll: true }), isWide() ? 60 : 380);
}
function submitPlanForm() {
  const artist = $('#fArtist').value.trim();
  if (!artist) { $('#fArtist').setAttribute('aria-invalid', 'true'); $('#fArtistErr').hidden = false; $('#fArtist').focus(); return; }
  const proxies = ['p1', 'p2', 'p3'].map((n) => $(`#planForm [name=${n}]`).value.trim()).filter(Boolean);
  const type = $('#fType input:checked')?.value || 'artist';
  closeSheet('sheet-plan', 'run');
  run({ artist, proxies, type });
}
function fillForm(input) {
  $('#fArtist').value = input.artist;
  ['p1', 'p2', 'p3'].forEach((n, k) => { $(`#planForm [name=${n}]`).value = input.proxies[k] || ''; });
  const r = $(`#fType input[value="${input.type}"]`) || $('#fType input');
  r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------- agent run (SSE) ----------------
function runDemo(i, opts = {}) {
  const d = S.cfg?.demos[i]; if (!d) return;
  run({ artist: d.artist, proxies: d.proxies.slice(0, 3), type: TYPE_LABEL[d.type] ? d.type : 'artist' }, { ...opts, demoIndex: i });
}

function setBusy(on, demoIndex) {
  $$('[data-run-demo], #runBtn').forEach((b) => { b.disabled = on; b.removeAttribute('aria-busy'); });
  if (on && demoIndex >= 0) $$(`[data-run-demo="${demoIndex}"]`).forEach((b) => b.setAttribute('aria-busy', 'true'));
  $('#heroDemo span').textContent = on ? t('Agent working…') : heroLabel();
}

function run(input, { rid, keepView = false, demoIndex } = {}) {
  // UB-31: one plan per click. The lock below stops a second click; the request id makes the server
  // join the run already in flight if a duplicate request still gets through.
  if (S.running) { toast({ title: t('Already planning'), detail: t('{artist} is still running. One plan at a time.', { artist: S.input?.artist }) }); return; }
  S.running = true;
  S.rid = rid || newRid(); S.retryRid = null;
  S.es?.close(); S.book = null; S.dossiers = {}; S.calls = []; S.tools = 0; S.trace = []; S.input = input; S.liveTop = null; S.heat = null; S.curTool = null; S.plan = 'qloo';
  fillForm(input);
  stopVoice(); if ($('#sheet-dossier').open) closeSheet('sheet-dossier');
  setBusy(true, demoIndex ?? S.cfg.demos.findIndex((d) => d.artist === input.artist));
  if (!keepView && S.view !== 'agent') setView('plan');
  const view = $('#view-plan');
  view.dataset.state = 'running';
  $('#planError').hidden = true; $('#stats').hidden = true; $('#planToggle').hidden = true;
  $('#planToggle input[value="qloo"]').checked = true; $('#planToggle input[value="qloo"]').dispatchEvent(new Event('change', { bubbles: true }));
  $('#summary').innerHTML = `<strong>${t('Planning {artist}.', { artist: esc(input.artist) })}</strong> <span class="muted" id="thought">${t('Connecting to the agent…')}</span>`;
  $('#live').hidden = false; $('#liveLog').innerHTML = ''; $('#steps').innerHTML = '';
  resetAgentView();
  drawBaseMap();
  updateToolbar();
  scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });

  S.t0 = performance.now();
  // A reload during the run re-attaches to the same server run (same request id) instead of starting another.
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ params: shareParams(input), rid: S.rid, t: Date.now() })); } catch {}
  history.replaceState(null, '', `?${shareParams(input)}${location.hash}`);
  const qs = new URLSearchParams({ artist: input.artist, proxies: input.proxies.join(','), type: input.type, rid: S.rid });
  if (LANG === 'fr') qs.set('lang', 'fr'); // the agent narrates and summarises in French; tools and Qloo calls are unchanged
  const es = new EventSource(`/api/plan/stream?${qs}`);
  S.es = es;
  let gotEvent = false;
  const H = {}; // the same handlers serve the live stream and the JSON fallback below
  const on = (type, fn) => { H[type] = fn; es.addEventListener(type, (e) => { gotEvent = true; if (S.es !== es) return; const d = JSON.parse(e.data); if (type !== 'done') S.trace.push([type, d]); fn(d); }); };
  on('plan', (d) => {
    $('#steps').innerHTML = d.steps.map((s) => `<li data-step="${esc(s)}">${esc(t(s))}</li>`).join('');
    setStep('Resolve');
  });
  on('joined', () => liveLine('thought', t('Attached to the run already in progress. No second plan was started.')));
  on('thought', (d) => { const t = $('#thought'); if (t) t.textContent = d.text; liveLine('thought', d.text); agentLine({ kind: 'thought', text: d.text }); });
  on('tool', (d) => {
    if (d.status === 'start') {
      S.tools++;
      if (d.stage) setStep(d.stage);
      const t = $('#thought'); if (t) t.textContent = toolPhrase(d);
      liveLine('tool', `<b>${esc(d.name)}</b><span>${esc(argSummary(d.args))}</span>`);
      agentLine({ kind: 'tool', d });
    }
    if (d.status === 'done' && d.name === 'rank_markets' && d.result?.top) { S.liveTop = d.result.top; drawLiveTop(); }
    if (d.status === 'error') { liveLine('err', `<b>${esc(d.name)}</b><span>${esc(d.error)}</span>`); agentLine({ kind: 'toolerr', d }); }
    updateToolbar();
  });
  on('heat', (d) => { S.heat = d; drawHeat(true); });
  on('call', (d) => {
    if (d.status === 'start') return;
    S.calls.push(d);
    const ft = d.params?.['filter.type'] ? ` ${d.params['filter.type'].replace('urn:entity:', '')}` : '';
    const ok = d.status === 'ok';
    liveLine(ok ? 'call' : 'err', `<b>${ok ? 'GET' : esc(String(d.status).toUpperCase())}</b><span>${esc(d.path)}${esc(ft)}</span><em>${d.ms ?? ''} ms</em>`);
    agentLine({ kind: 'call', d });
    updateToolbar();
  });
  on('done', (book) => {
    es.close(); S.es = null; S.book = book; S.running = false;
    $$('#steps li').forEach((li) => { li.className = 'is-done'; });
    setBusy(false); render();
    history.replaceState(null, '', `?${shareParams()}${location.hash}`);
    clearPending(); saveSession();
    toast({ title: t('{name} is planned', { name: book.artist?.selected?.name || input.artist }), detail: t('{requests} in {s} s', { requests: plural(book.meta.calls, 'Qloo request'), s: dec((book.meta.ms / 1000).toFixed(1)) }), tone: 'ok' });
  });
  on('fail', (d) => { es.close(); failRun(d.code === 'daily_cap' ? t('Daily limit reached') : t('The agent stopped'), t(d.error || 'Unknown error.')); });
  es.onerror = () => {
    if (S.es !== es || !S.running) return;
    es.close();
    S.retryRid = gotEvent ? S.rid : null; // reconnect to the same run: the server replays it, it never starts a second one
    failRun(gotEvent ? t('The connection dropped') : t('The agent could not start'), gotEvent ? t('The plan keeps running on the server. Try again to pick it up where it is.') : t('The server may be restarting. Try again in a moment.'), { keepPending: true });
  };
  // No event at all after 8 s: the stream is held somewhere on the way (a proxy or relay; seen on an iPhone, 22 Oct).
  // Fall back to the JSON endpoint with the same request id: it joins the run already started on the server (or starts
  // it), and its trace is replayed through the same handlers, so the plan and the agent log end up identical.
  setTimeout(async () => {
    if (gotEvent || S.es !== es || !S.running) return;
    es.close(); S.es = null;
    const th = $('#thought'); if (th) th.textContent = t('The live view is blocked on this network. The plan is still being built…');
    try {
      const r = await fetch(`/api/plan?rid=${encodeURIComponent(S.rid)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, lang: LANG === 'fr' ? 'fr' : 'en' }) });
      const out = await r.json();
      if (!S.running) return;
      if (!r.ok) { H.fail({ error: out.error, code: r.status === 429 ? 'daily_cap' : undefined }); return; }
      const { trace = [], ...book } = out;
      for (const { type, ...d } of trace) { S.trace.push([type, d]); H[type]?.(d); }
      H.done(book);
    } catch {
      if (S.running) failRun(t('The agent could not start'), t('The server may be restarting. Try again in a moment.'), { keepPending: true });
    }
  }, 8000);
}

const SESSION_KEY = 'tourbook:last';
const PENDING_KEY = 'tourbook:pending';
const clearPending = () => { try { sessionStorage.removeItem(PENDING_KEY); } catch {} };
function pendingRid() {
  try { const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); return p && p.params === location.search.slice(1) && Date.now() - p.t < 120000 ? p.rid : undefined; } catch { return undefined; }
}
function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ params: shareParams(), lang: LANG, input: S.input, book: S.book, trace: S.trace })); } catch { /* private mode or quota: reload simply re-runs */ }
}
/** Same URL reloaded in this tab: show the finished plan at once instead of spending Qloo calls again. */
function restoreSession() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return false; }
  if (!saved?.book?.markets || saved.params !== location.search.slice(1) || (saved.lang || 'en') !== LANG) return false; // a plan is replayed in the language it was written in
  S.input = saved.input; S.book = saved.book; S.trace = saved.trace || []; S.calls = []; S.tools = 0; S.curTool = null;
  fillForm(S.input);
  resetAgentView();
  for (const [type, d] of S.trace) {
    if (type === 'thought') agentLine({ kind: 'thought', text: d.text });
    else if (type === 'tool' && d.status === 'start') { S.tools++; agentLine({ kind: 'tool', d }); }
    else if (type === 'tool' && d.status === 'error') agentLine({ kind: 'toolerr', d });
    else if (type === 'call' && d.status !== 'start') { S.calls.push(d); agentLine({ kind: 'call', d }); }
  }
  render();
  return true;
}

function failRun(title, msg, { keepPending = false } = {}) {
  S.running = false; S.es = null; if (!keepPending) clearPending();
  setBusy(false);
  $('#live').hidden = true;
  $('#view-plan').dataset.state = 'empty';
  $('#summary').innerHTML = `<strong>${t('No plan for {artist} yet.', { artist: esc(S.input?.artist || t('this act')) })}</strong> <span class="muted">${t('Nothing was saved. The details are below.')}</span>`;
  showPlanError(title, msg, true);
  agentLine({ kind: 'fail', text: `${title}. ${msg}` });
  drawBaseMap();
  updateToolbar();
}
function showPlanError(title, msg, retry) {
  $('#planErrorTitle').textContent = title; $('#planErrorText').textContent = msg;
  $('#retryBtn').hidden = !retry; $('#planError').hidden = false;
}
function argSummary(a = {}) {
  return Object.entries(a).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.length}]` : typeof v === 'string' ? `"${v.length > 22 ? `${v.slice(0, 21)}…` : v}"` : v}`).join(', ');
}
/** Plain words for the line under the title: the model may call tools without narrating them. */
function toolPhrase(d) {
  const a = d.args || {}; const city = S.cities?.[a.city_id]?.name;
  const kind = { venue: 'the room', after_party: 'an after-show spot', crowd_brief: 'the crowd brief' }[a.kind];
  return ({
    resolve_entity: t('Finding “{name}” in Qloo’s taste graph.', { name: a.name }),
    rank_markets: t('Ranking 34 metros by taste against population.'),
    audience_profile: t('Profiling the audience (aggregate segments only).'),
    momentum: t('Checking six months of momentum.'),
    local_picks: city && kind ? t(`{city}: picking ${kind}.`, { city }) : t('Picking local spots.'),
    find_openers: city ? t('{city}: finding an opener with the same taste.', { city }) : t('Finding openers.'),
    sponsor_fit: city ? t('{city}: matching brands this crowd loves.', { city }) : t('Matching sponsors.'),
    llm_only_baseline: t('Asking the same model for a plan without Qloo, for the comparison.'),
  })[d.name] || t('Running {name}.', { name: d.name });
}

/** Full-screen map. In the page the map asks for two fingers so a one-finger swipe scrolls the page;
 *  opened full screen there is no page to scroll, so one finger moves the map. */
function setMapExpanded(on) {
  const wrap = $('#mapwrap'), btn = $('#mapExpand');
  // A transformed ancestor (the animated view) traps position: fixed, so the map moves to <body> while open.
  if (on && !S.mapHome) { S.mapHome = { parent: wrap.parentNode, next: wrap.nextSibling }; document.body.append(wrap); }
  if (!on && S.mapHome) { S.mapHome.parent.insertBefore(wrap, S.mapHome.next); S.mapHome = null; }
  wrap.classList.toggle('is-expanded', on);
  document.documentElement.classList.toggle('map-open', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', t(on ? 'Close the full-screen map' : 'Open the map full screen'));
  btn.querySelector('use').setAttribute('href', on ? '#i-x' : '#i-expand');
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (S.map && coarse) { if (on) S.map.cooperativeGestures.disable(); else S.map.cooperativeGestures.enable(); }
  if (!coarse) setMapActive(on); // full screen on a computer: nothing to scroll, so the wheel zooms the map
  requestAnimationFrame(() => { S.map?.resize(); fitTour(true); });
}

/** Computer (mouse or trackpad): the wheel scrolls the page over a resting map; a click on the map wakes it up and the
 *  wheel then zooms it. The map rests again when the pointer leaves it or after a click elsewhere. Phones are untouched
 *  (they keep the two-finger rule above). Dragging still pans at rest: a drag never scrolls the page, and the press wakes the map. */
function setMapActive(on) {
  const wrap = $('#mapwrap');
  if (!S.map || matchMedia('(pointer: coarse)').matches) return;
  if (on) S.map.scrollZoom.enable(); else S.map.scrollZoom.disable();
  wrap.classList.toggle('is-active', on);
}
function bindMapActivation() {
  const wrap = $('#mapwrap');
  if (!S.map || matchMedia('(pointer: coarse)').matches) return;
  const expanded = () => wrap.classList.contains('is-expanded');
  // the small cross puts the map back to rest (the wheel scrolls the page again), even with the pointer still over it
  $('#mapRest').addEventListener('click', () => setMapActive(false));
  wrap.addEventListener('pointerdown', (e) => { if (!e.target.closest('#mapRest')) setMapActive(true); });
  wrap.addEventListener('focusin', (e) => { if (!e.target.closest('#mapRest')) setMapActive(true); });
  wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !expanded()) setMapActive(false); });
  wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget) && !wrap.matches(':hover') && !expanded()) setMapActive(false); });
  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target) && !expanded()) setMapActive(false); });
  // A trackpad pinch arrives as ctrl + wheel: over a resting map, keep it from zooming the whole page and point to the click.
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || wrap.classList.contains('is-active')) return;
    e.preventDefault();
    const hint = $('#mapHint'); hint.classList.remove('is-nudge'); void hint.offsetWidth; hint.classList.add('is-nudge');
  }, { passive: false });
}

function setStep(stage) {
  const all = $$('#steps li').map((li) => li.dataset.step); const k = all.indexOf(stage);
  // Parallel tool calls can start a later stage before an earlier one: the bar never moves backwards.
  const cur = all.indexOf($$('#steps li').find((li) => li.className === 'is-active')?.dataset.step);
  if (k < cur) return;
  if (k >= 0) $('#stepLabel').textContent = t('Step {k} of {n}: {stage}', { k: k + 1, n: all.length, stage: t(stage) });
  let passed = true;
  $$('#steps li').forEach((li) => {
    if (li.dataset.step === stage) { li.className = 'is-active'; passed = false; } else li.className = passed ? 'is-done' : '';
  });
}
function liveLine(kind, html) {
  const log = $('#liveLog');
  const li = document.createElement('li');
  li.className = `is-${kind}`;
  li.innerHTML = kind === 'thought' ? esc(html) : html;
  log.append(li);
  while (log.children.length > 6) log.firstElementChild.remove();
  spring(li, [{ opacity: 0.35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' });
}

// ---------------- agent view (full run log) ----------------
function resetAgentView() {
  $('#agentEmpty').hidden = true; $('#agentBody').hidden = false;
  $('#runlog').innerHTML = '';
  $('#agentSummary').innerHTML = `<strong>${t('The agent is planning {artist}.', { artist: esc(S.input.artist) })}</strong> <span class="muted">${t('Each tool call and each Qloo request appears below as it happens.')}</span>`;
  $('#agentStats').innerHTML = ''; $('#usage').innerHTML = ''; $('#usageFoot').textContent = ''; $('#guards').innerHTML = ''; $('#logMeta').textContent = '';
}
function agentLine({ kind, d, text }) {
  const log = $('#runlog');
  if (kind === 'thought' || kind === 'fail') {
    log.insertAdjacentHTML('beforeend', `<li class="thought"${kind === 'fail' ? ' style="color:var(--status-critical-text)"' : ''}>${esc(text)}</li>`);
  } else if (kind === 'tool') {
    const li = document.createElement('li');
    li.innerHTML = `<div class="tool"><b>${esc(d.name)}</b><span class="stage">${esc(t(d.stage || ''))}</span><span class="args">${esc(JSON.stringify(d.args))}</span></div><ul class="calls"></ul>`;
    log.append(li); S.curTool = li.querySelector('.calls');
  } else if (kind === 'toolerr') {
    log.insertAdjacentHTML('beforeend', `<li class="thought" style="color:var(--status-critical-text)">${t('{name} failed: {error}', { name: esc(d.name), error: esc(d.error) })}</li>`);
  } else if (kind === 'call') {
    const ok = d.status === 'ok';
    const ft = d.params?.['filter.type'] ? ` · ${d.params['filter.type']}` : '';
    const html = `<li class="${ok ? '' : 'is-err'}" title="${esc(Object.entries(d.params || {}).map(([k, v]) => `${k}=${v}`).join('\n'))}"><span class="verb">${ok ? 'GET' : esc(String(d.status).toUpperCase())}</span><span>${esc(d.path)}${esc(ft)}${ok ? '' : ` · ${esc(d.error || d.problems?.join(' '))}`}</span><em>${d.ms ?? ''} ms${d.cache && !['miss', 'mock'].includes(d.cache) ? ` · ${esc(d.cache)}` : ''}</em></li>`;
    (S.curTool || log).insertAdjacentHTML('beforeend', html);
  }
  $('#logMeta').textContent = `${plural(S.tools, 'tool call')} · ${plural(S.calls.length, 'request')}`;
}
function renderAgentFinal() {
  const b = S.book;
  const rejected = S.calls.filter((c) => c.status === 'rejected').length;
  const endpoints = new Set(S.calls.map((c) => c.path));
  const types = new Set(S.calls.map((c) => c.params?.['filter.type']).filter(Boolean));
  $('#agentSummary').innerHTML = `<strong>${t('{tools} and {requests} in {s} s.', { tools: plural(S.tools, 'tool call'), requests: plural(b.meta.calls, 'Qloo request'), s: dec((b.meta.ms / 1000).toFixed(1)) })}</strong> ${rejected ? t('{n} rejected by the parameter validator.', { n: rejected }) : t('None was rejected by the parameter validator.')} <span class="muted">${t('Every fact in the plan comes from one of these results.')}</span>`;
  if (b.summary) $('#runlog').insertAdjacentHTML('beforeend', `<li class="final"><b>${t('Final answer')}</b><p>${esc(b.summary)}</p></li>`);
  $('#agentStats').innerHTML = [
    stat(t('Tool calls'), S.tools, t('typed, schema-checked')),
    stat(cap(t('Qloo requests')), b.meta.calls, t('each one cited in the plan')),
    stat(t('Endpoints'), endpoints.size, [...endpoints].slice(0, 3).join(' · ')),
    stat(t('Filter types'), types.size, t('heatmap, demographics, entities')),
  ].join('');
  const groups = new Map();
  for (const c of S.calls) { const k = `${c.path}|${c.params?.['filter.type'] || ''}`; groups.set(k, (groups.get(k) || 0) + 1); }
  $('#usage').innerHTML = `<thead><tr><th>${t('Endpoint')}</th><th>filter.type</th><th class="is-num">${t('Calls')}</th></tr></thead><tbody>${[...groups.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => {
    const [path, ft] = k.split('|');
    return `<tr><td><code>${esc(path)}</code></td><td class="is-muted"><code>${esc(ft || '–')}</code></td><td class="is-num">${n}</td></tr>`;
  }).join('')}</tbody>`;
  $('#usageFoot').textContent = `${plural(groups.size, 'distinct query shape')}. ${t('Heatmap scores come from one national call, so every city is on the same scale.')}`;
  const live = b.meta.qloo === 'live';
  $('#guards').innerHTML = [
    guard(t('Parameter validator'), t('{rejected} of {calls} requests rejected. Qloo ignores bad parameters silently, so we check each one first.', { rejected, calls: b.meta.calls })),
    guard(t('Key stays on the server'), t('GET only. The browser never talks to Qloo or to the model.')),
    guard(t('One plan per click'), t('A double click or a reconnect joins the run in flight. A daily cap per address protects the quota.')),
    guard(t('Data source'), live ? t('Live Qloo Insights API, aggregate affinities, never individuals.') : t('Synthetic data in mock mode. Responses mirror Qloo’s shapes; names are invented.')),
    guard(t('Planner'), S.cfg.llm.provider === 'mock' ? t('Scripted planner running the real tool loop (no model key on this server).') : t('{model} with tool calling.', { model: S.cfg.llm.model })),
  ].join('');
}
const stat = (label, value, delta, cls = '') => `<div class="ui-stat" role="listitem"><p class="ui-stat__label">${esc(label)}</p><p class="ui-stat__value ${cls}" title="${esc(String(value).replace(/<[^>]+>/g, ''))}">${value}</p>${delta ? `<p class="ui-stat__delta">${esc(delta)}</p>` : ''}</div>`;
const guard = (title, sub) => `<li><div class="ui-row"><span class="ui-row__icon guard-ok">${icon('i-check')}</span><div class="ui-row__body"><span class="ui-row__title">${esc(title)}</span><span class="ui-row__subtitle">${esc(sub)}</span></div></div></li>`;

// ---------------- results ----------------
function render() {
  const b = S.book;
  $('#live').hidden = true;
  if (!b?.markets) {
    failRun(t('No market ranking came back'), t('The agent could not resolve this act. Add three sound-alike acts and try again.'));
    return;
  }
  const view = $('#view-plan');
  view.dataset.state = 'ready';
  const live = b.meta.qloo === 'live';
  const top = b.markets.top; const lead = top[0];
  const hidden = top.filter((m) => m.hidden).length;
  const onlyQloo = b.comparison?.onlyQloo?.length ?? 0;
  const endpoints = new Set(S.calls.map((c) => c.path)).size;
  const rejected = S.calls.filter((c) => c.status === 'rejected').length;
  $('#summary').innerHTML = lead
    ? t('<strong>{name} leads the tour.</strong> Fans rank it <span class="taste">#{taste} for taste</span> but it is only #{pop} for population. {hidden} of the top {top} markets are hidden markets{miss}.', {
      name: esc(lead.name), taste: lead.affinityRank, pop: lead.popRank, hidden, top: top.length,
      miss: b.comparison ? t(', and a plan without Qloo would miss {n} of these {top} stops', { n: onlyQloo, top: top.length }) : '',
    })
    : t('No market stood out for this act.');
  const st = $('#stats');
  st.hidden = false;
  st.innerHTML = [
    stat(t('Lead market'), esc(lead?.name || '–'), lead ? `${t('Hidden Market Score {hms}', { hms: lead.hms })} · ${lead.state}` : ''),
    stat(t('Hidden markets'), `${hidden}<small>${t('of {n}', { n: top.length })}</small>`, t('beat their population rank by 5+')),
    stat(t('Changed by Qloo'), `${onlyQloo}<small>${t('of {n}', { n: top.length })}</small>`, t('stops a population plan misses'), 'is-taste'),
    stat(cap(t('Qloo requests')), b.meta.calls, `${plural(endpoints, 'endpoint')} · ${t('{n} rejected', { n: rejected })}`),
  ].join('');
  spring(st, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { preset: 'smooth', fill: 'none' });
  $('#planToggle').hidden = !b.baseline;
  renderDates(); renderCompare(); renderMarkets(); renderAudience(); renderMomentum(); renderAgentFinal();
  $('#planFoot').textContent = `${live ? t('Source: Qloo Insights API. Aggregate taste affinities, never individuals.') : t('Synthetic data: acts, venues, brands and numbers are invented in mock mode, with Qloo’s real request and response shapes.')} ${t('Agent: {agent}. Planned {date}.', { agent: S.cfg.llm.provider === 'mock' ? t('scripted planner') : S.cfg.llm.model, date: new Date(b.createdAt).toLocaleString(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}`;
  drawMap();
  updateToolbar();
  spring($('.when-ready'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { preset: 'smooth', fill: 'none' });
}

function renderDates() {
  const dates = (S.book.dates || []).filter((d) => d.market);
  for (const d of dates) S.dossiers[d.market.id] = d;
  $('#dates').innerHTML = dates.map((d, i) => {
    const m = d.market; const v = d.venue?.picks?.[0]; const o = d.opener?.openers?.[0]; const s = d.sponsor?.sponsors?.[0]; const a = d.after_party?.picks?.[0];
    const g = d.opener?.gain?.overlap;
    return `<li><button class="ui-row" type="button" data-city="${esc(m.id)}" aria-label="${t('Date {n}, {name}. Open the dossier', { n: i + 1, name: esc(m.name) })}">
      <span class="date-n">${i + 1}</span>
      <span class="ui-row__body">
        <span class="ui-row__title">${esc(m.name)}<small>${esc(m.state)} · ${fmtPop(m.pop)}</small></span>
        <span class="ui-row__subtitle">${t('Taste #{taste}, population #{pop}', { taste: m.affinityRank, pop: m.popRank })}${m.hidden ? ` · <span class="ui-status ui-status--ok">${t('Hidden market')}</span>` : ''}</span>
        <dl class="date-facts">
          <dt>${t('Room')}</dt><dd>${esc(v?.name || '–')}</dd>
          <dt>${t('Opener')}</dt><dd>${esc(o?.name || '–')}${g != null ? ` <span>· ${t('{n} % taste fit', { n: pct(g) })}</span>` : ''}</dd>
          <dt>${t('Sponsor')}</dt><dd>${esc(s?.name || '–')}</dd>
          <dt>${t('After-show')}</dt><dd>${esc(a?.name || '–')}</dd>
        </dl>
      </span>
      <span class="hms"><b>${m.hms}</b><small>HMS</small></span>
      ${icon('i-chev-r', 'ui-row__chevron')}
    </button></li>`;
  }).join('') || `<li><div class="ui-row"><span class="ui-row__body"><span class="ui-row__subtitle">${t('No dates could be prepped for this act.')}</span></span></div></li>`;
  const ids = dates.map((d) => d.market.name);
  $('#datesFoot').textContent = ids.length ? t('Route: {route}. Nearest-neighbour order, so the van doesn’t zigzag.', { route: b_route() }) : '';
}
function b_route() { return (S.book.route || []).map((id) => S.cities[id]?.name).filter(Boolean).join(' → '); }

function renderCompare() {
  const b = S.book; const base = b.baseline;
  if (!base) { $('#compare').innerHTML = `<div class="ui-empty"><p>${t('The no-Qloo baseline did not come back for this run.')}</p></div>`; $('#compareFoot').textContent = ''; return; }
  const left = base.cities.map((c) => c.id); const leftSet = new Set(left);
  const right = b.markets.top;
  const n = Math.max(left.length, right.length);
  const rows = Array.from({ length: n }, (_, i) => {
    const l = S.cities[left[i]]; const r = right[i];
    return `<tr><td>${i + 1}</td><td class="pop">${l ? `${esc(l.name)}<small>${fmtPop(l.pop)}</small>` : ''}</td><td class="${r && !leftSet.has(r.id) ? 'is-new' : 'is-shared'}">${r ? `${esc(r.name)}<small>HMS ${r.hms}</small>` : ''}</td></tr>`;
  }).join('');
  $('#compare').innerHTML = `<table><thead><tr><th>#</th><th>${t('Without Qloo')}</th><th class="qloo">${t('With Qloo')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const shared = b.comparison?.shared?.length ?? 0;
  $('#compareFoot').textContent = t('Same act, same question. Without taste data the plan follows population. With Qloo, {n} of {total} stops change{stay}. Stops in bold are the ones only Qloo found.', {
    n: b.comparison?.onlyQloo?.length ?? 0, total: right.length,
    stay: shared ? (shared === 1 ? t(' and {shared} stays', { shared }) : t(' and {shared} stay', { shared })) : '',
  });
}

function renderMarkets() {
  const all = S.book.markets.all;
  const hiddenN = all.filter((m) => m.hidden).length;
  $('#marketsSub').textContent = `${t('{n} hidden markets out of {total}.', { n: hiddenN, total: all.length })} ${S.book.markets.comparable ? t('Scored from one national heatmap call, so cities compare fairly.') : t('Strategy: {s}, per city, approximate.', { s: S.book.markets.strategy.replace(/_/g, ' ') })}`;
  const tbl = $('#marketsTable'); tbl.classList.remove('is-all');
  tbl.innerHTML = `<thead><tr><th class="is-num" data-slot="hide-compact">#</th><th>${t('City')}</th><th>${t('Hidden Market Score')}</th><th class="is-num">${t('Taste rank')}</th><th class="is-num">${t('Population rank')}</th><th class="is-num">${t('Gap')}</th><th>${t('Verdict')}</th></tr></thead><tbody>${
    all.map((m, i) => `<tr data-city="${esc(m.id)}" class="${i >= 12 ? 'is-hidden-row' : ''}">
      <td class="is-num is-muted" data-slot="hide-compact">${i + 1}</td>
      <td class="city" data-slot="title"><button class="row-link" type="button" data-city="${esc(m.id)}" aria-label="${t('{name}, Hidden Market Score {hms}. Open the dossier', { name: esc(m.name), hms: m.hms })}">${esc(m.name)}</button><small>${esc(m.state)} · ${fmtPop(m.pop)}</small></td>
      <td data-slot="trailing"><div class="hmsbar"><div class="track"><div class="fill" style="width:${m.hms}%;--d:${Math.min(i, 12) * 25}ms"></div></div><b>${m.hms}</b></div></td>
      <td class="is-num" data-slot="meta">#${m.affinityRank}<span class="only-compact"> ${t('taste · #{pop} population', { pop: m.popRank })} · ${signed(m.rankGap)}</span></td>
      <td class="is-num" data-slot="hide-compact">#${m.popRank}</td>
      <td class="is-num ${m.rankGap > 0 ? 'gap-up' : 'gap-down'}" data-slot="hide-compact">${signed(m.rankGap)}</td>
      <td data-slot="hide-compact">${m.hidden ? `<span class="ui-status ui-status--ok">${t('Hidden market')}</span>` : '<span class="is-muted">–</span>'}</td>
    </tr>`).join('')
  }</tbody>`;
  $('#marketsCount').textContent = t('{a} of {b}', { a: 12, b: all.length });
  $('#marketsMore').textContent = t('Show all {n}', { n: all.length });
}

function renderAudience() {
  const a = S.book.audience;
  if (!a || (!a.age && !a.gender)) { $('#audience').innerHTML = `<p class="ui-footnote ui-secondary">${t('Qloo returned no demographic signal for this act. The rest of the plan does not depend on it.')}</p>`; return; }
  const label = Object.fromEntries(Object.entries({ '24_and_younger': '24 and under', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+', male: 'Men', female: 'Women' }).map(([k, v]) => [k, t(v)]));
  const age = Object.entries(a.age || {}); const gender = Object.entries(a.gender || {});
  const max = Math.max(0.01, ...[...age, ...gender].map(([, v]) => Math.abs(v)));
  const row = ([k, v]) => `<div class="bar"><span>${esc(label[k] || k)}</span><div class="axis"><div class="v ${v >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(v) / max) * 50}%"></div></div><span class="n">${signed(Number(v), 2)}</span></div>`;
  const best = age.slice().sort((x, y) => y[1] - x[1])[0];
  $('#audience').innerHTML = age.map(row).join('') + (gender.length ? '<div class="bar-sep"></div>' + gender.map(row).join('') : '')
    + `<p class="advice">${best ? t('Over-indexes most with <strong>{seg}</strong>. ', { seg: esc(label[best[0]] || best[0]) }) : ''}<span class="ui-secondary">${t('Positive means over-represented. Not a headcount, never about individuals.')}</span></p>`;
}

function renderMomentum() {
  const m = S.book.momentum;
  if (!m?.series?.length) { $('#momentum').innerHTML = `<p class="ui-footnote ui-secondary">${t('No trend data for this window. Room sizes fall back to the taste score alone.')}</p>`; return; }
  const series = [...m.series].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  $('#momentumSub').innerHTML = t('{from} to {to}, weekly percentile from <code>/v2/trending</code>', { from: esc(fmt(series[0].date)), to: esc(fmt(series.at(-1).date)) });
  const ys = series.map((p) => p.percentile); const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
  const W = 400, H = 150, L = 30, R = 46, T = 10, B = 22;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, ys.length - 1);
  const y = (v) => T + (1 - (v - lo) / Math.max(0.001, hi - lo)) * (H - T - B);
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = ys.at(-1);
  const delta = Number(m.delta);
  const tone = m.verdict === 'rising' ? 'ok' : m.verdict === 'cooling' ? 'warn' : 'info';
  $('#momentum').innerHTML = `<div class="momentum-head"><span class="ui-status ui-status--${tone}">${esc(t(m.verdict[0].toUpperCase() + m.verdict.slice(1)))}</span>${Number.isFinite(delta) ? `<span class="ui-footnote ui-secondary">${t('{delta} percentile points over the window', { delta: signed(delta, 1) })}</span>` : ''}</div>
    <div class="ui-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('Weekly popularity percentile, {verdict}, from {from} to {to}', { verdict: esc(t(m.verdict)), from: ys[0].toFixed(0), to: last.toFixed(0) })}">
      <line class="ui-chart__grid" x1="${L}" x2="${W - R}" y1="${y(hi)}" y2="${y(hi)}"/><line class="ui-chart__grid" x1="${L}" x2="${W - R}" y1="${y((lo + hi) / 2)}" y2="${y((lo + hi) / 2)}"/><line class="ui-chart__axis" x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}"/>
      <text class="ui-chart__label" x="${L - 6}" y="${y(hi) + 4}" text-anchor="end">${hi}</text><text class="ui-chart__label" x="${L - 6}" y="${y(lo) + 4}" text-anchor="end">${lo}</text>
      <text class="ui-chart__label" x="${L}" y="${H - 4}">${esc(fmt(series[0].date))}</text><text class="ui-chart__label" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(fmt(series.at(-1).date))}</text>
      <path class="ui-chart__area" d="${d} L${x(ys.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z"/><path class="ui-chart__line" d="${d}"/>
      <circle class="ui-chart__dot" cx="${x(ys.length - 1)}" cy="${y(last)}" r="4"/><text class="ui-chart__label" x="${x(ys.length - 1) + 8}" y="${y(last) + 4}" style="fill:var(--label);font-weight:600">${last.toFixed(0)}</text>
    </svg></div>
    <p class="advice">${esc(t(m.advice))}</p>`;
}

// ---------------- map ----------------
const STYLE = () => `https://tiles.openfreemap.org/styles/${isDark() ? 'dark' : 'positron'}`;
const US = [[-125, 24.5], [-66.9, 49.5]];
// MapLibre's own labels (map region, markers, two-finger hint on phones) in French.
const MAP_LOCALE_FR = {
  'Map.Title': 'Carte', 'Marker.Title': 'Repère sur la carte', 'Popup.Close': 'Fermer la fenêtre',
  'CooperativeGesturesHandler.WindowsHelpText': 'Utilisez Ctrl + molette pour zoomer sur la carte',
  'CooperativeGesturesHandler.MacHelpText': 'Utilisez ⌘ + molette pour zoomer sur la carte',
  'CooperativeGesturesHandler.MobileHelpText': 'Utilisez deux doigts pour déplacer la carte',
};
function initMap() {
  if (!window.maplibregl) { $('#map').innerHTML = `<div class="map-fallback">${t('The map could not load (offline?). The plan below still works.')}</div>`; return; }
  try {
    S.map = new maplibregl.Map({ container: 'map', style: STYLE(), bounds: US, fitBoundsOptions: { padding: mapPadding() }, attributionControl: false, dragRotate: false, pitchWithRotate: false, cooperativeGestures: matchMedia('(pointer: coarse)').matches, scrollZoom: matchMedia('(pointer: coarse)').matches, ...(LANG === 'fr' ? { locale: MAP_LOCALE_FR } : {}) });
    S.map.touchZoomRotate.disableRotation();
    bindMapActivation();
    S.map.on('style.load', () => { quietStyle(); drawCurrent(); });
    S.map.once('load', () => { quietStyle(); drawCurrent(); });
    S.map.on('moveend', declutter);
    drawCurrent();
    S.map.on('error', () => {});
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.map.setStyle(STYLE()));
  } catch (e) { $('#map').innerHTML = `<div class="map-fallback">${t('The map could not load ({error}). The plan below still works.', { error: esc(e.message) })}</div>`; }
}
function quietStyle() {
  // Quiet basemap: our metros carry the labels, not the tiles.
  for (const l of S.map.getStyle().layers) if (l.type === 'symbol') S.map.setLayoutProperty(l.id, 'visibility', 'none');
  // Fan map: Qloo's national heatmap cells, under the route and the metros.
  if (!S.map.getSource('heat')) S.map.addSource('heat', { type: 'geojson', data: heatData() });
  if (!S.map.getLayer('heat')) S.map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', paint: heatPaint(0) });
  if (!S.map.getSource('route')) S.map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const c = isDark() ? '#F5F5F7' : '#1D1D1F';
  if (!S.map.getLayer('route')) S.map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c, 'line-width': 2, 'line-dasharray': [1.4, 1.6], 'line-opacity': 0.75 } });
}
function drawCurrent() { if (S.book?.markets) drawMap(); else if (S.liveTop) drawLiveTop(); else drawBaseMap(); }
function mapPadding() {
  const el = $('#mapwrap'); const w = el?.clientWidth || innerWidth;
  const under = isWide() && !$('#app').classList.contains('is-sidebar-collapsed') ? 284 : 0;
  return w < 560 ? { top: 64, bottom: 96, left: 28, right: 28 } : { top: 70, bottom: 124, left: under + 70, right: 80 };
}
function clearMarkers() { S.markers.forEach((m) => m.remove()); S.markers = []; S.map?.getSource('route')?.setData({ type: 'FeatureCollection', features: [] }); }

// ---- fan heat (30 Oct): where the fans over-index, cell by cell, from the same national heatmap call ----
const heatSrc = () => S.book?.markets?.heat || S.heat || null;
function heatData() {
  const h = heatSrc();
  return { type: 'FeatureCollection', features: (h?.cells || []).map(([lng, lat, w]) => ({ type: 'Feature', properties: { w }, geometry: { type: 'Point', coordinates: [lng, lat] } })) };
}
function heatPaint(opacity) {
  const dark = isDark();
  return {
    'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0.4, 0, 0.8, 0.22, 0.95, 0.7, 1, 1],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.75, 6, 1.4, 9, 2.2],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 15, 4, 21, 6, 40, 9, 80],
    'heatmap-color': dark
      ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(107,58,34,0)', 0.2, 'rgba(140,64,30,0.4)', 0.45, '#A9481A', 0.75, '#E8733A', 1, '#FFA066']
      : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(247,201,169,0)', 0.2, 'rgba(247,190,150,0.45)', 0.45, '#F29A62', 0.75, '#E2561F', 1, '#B23A0E'],
    'heatmap-opacity': opacity,
  };
}
let heatAnim;
/** Shows the fan heat. `bloom`: fades and swells in, the way the hotspots arrive from Qloo. Hidden in the no-Qloo view. */
function drawHeat(bloom = false) {
  if (!S.map?.getLayer('heat')) return;
  cancelAnimationFrame(heatAnim);
  S.map.getSource('heat').setData(heatData());
  const target = heatSrc() && S.plan !== 'llm' ? (isDark() ? 0.7 : 0.72) : 0;
  if (!bloom || reduceMotion() || !target) { S.map.setPaintProperty('heat', 'heatmap-opacity', target); return; }
  const t0 = performance.now(), dur = 1600;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
    S.map.setPaintProperty('heat', 'heatmap-opacity', target * e);
    S.map.setPaintProperty('heat', 'heatmap-intensity', ['interpolate', ['linear'], ['zoom'], 3, 0.75 * (0.4 + 0.6 * e), 6, 1.4 * (0.4 + 0.6 * e), 9, 2.2]);
    if (p < 1) heatAnim = requestAnimationFrame(step);
  };
  heatAnim = requestAnimationFrame(step);
}
const heatLegend = () => {
  const h = heatSrc();
  return h && S.plan !== 'llm' ? `<span class="heat-key"><i></i>${t('Fan heat: {n} areas from one Qloo heatmap call', { n: (h.total || h.cells.length).toLocaleString(LOCALE) })}</span>` : '';
};
// Hide a city label when it would collide with a higher-ranked label or dot (dense Midwest / Northeast).
function declutter() {
  if (!S.map) return;
  const placed = [];
  const items = S.markers.map((mk) => ({ mk, el: mk.getElement() })).filter((x) => x.el.querySelector('.lbl'))
    .sort((a, b) => Number(a.el.dataset.rank || 99) - Number(b.el.dataset.rank || 99));
  for (const { mk, el } of items) {
    const p = S.map.project(mk.getLngLat()); const r = Number(el.dataset.size || 20) / 2; const name = el.querySelector('.lbl').textContent;
    const w = name.length * 6.6 + 6; const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + r + 3, y1: p.y + r + 19 };
    const dots = items.map((o) => { const q = S.map.project(o.mk.getLngLat()); const rr = Number(o.el.dataset.size || 20) / 2; return { x0: q.x - rr, x1: q.x + rr, y0: q.y - rr, y1: q.y + rr }; });
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const clash = placed.some((b) => hit(box, b)) || dots.some((d) => hit(box, d));
    el.classList.toggle('no-lbl', clash);
    if (!clash) placed.push(box);
  }
}
function addMarker(m, { size, bg, label = '', rank = 0, minor = false, hidden = false, enter = false, delay = 0 }) {
  const el = document.createElement('div');
  el.className = `mk${minor ? ' is-minor' : ''}${hidden ? ' is-hidden' : ''}${enter ? ' is-enter' : ''}${rank > 5 ? ' is-rank-far' : ''}`;
  el.style.setProperty('--d', `${delay}ms`); el.style.setProperty('--r', `${size / 2}px`);
  el.dataset.size = size; if (rank) el.dataset.rank = rank;
  const ink = luminance(bg) > 0.55 ? '#1D1D1F' : '#fff';
  el.innerHTML = `<div class="dot" style="width:${size}px;height:${size}px;background:${bg};color:${ink}">${rank && size >= 18 ? rank : ''}</div>${label ? `<div class="lbl">${esc(label)}</div>` : ''}`;
  el.tabIndex = minor ? -1 : 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${m.name}${m.hms != null ? t(', Hidden Market Score {hms}', { hms: m.hms }) : ''}${t('. Open the dossier')}`);
  el.title = m.hms != null ? `${m.name} · HMS ${m.hms}${m.affinityRank != null ? ` · ${t('taste #{taste} vs population #{pop}', { taste: m.affinityRank, pop: m.popRank })}` : ''}` : `${m.name} · ${fmtPop(m.pop)}`; // ranks arrive with the finished plan
  el.addEventListener('click', (e) => { e.stopPropagation(); if (S.book) openDossier(m.id); else if (!S.running) toast({ title: m.name, detail: t('Metro population {pop}. Run a plan to score it by taste.', { pop: fmtPop(m.pop) }) }); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  S.markers.push(new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(S.map));
}
function luminance(c) {
  const h = c.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const tasteColor = (h) => { const t = Math.max(0, Math.min(1, (h - 35) / 60)); return isDark() ? mix('#6B3A22', '#FF8A4C', t) : mix('#F7C9A9', '#E2561F', t); };
const greyDot = () => (isDark() ? '#636366' : '#AEAEB2');

function drawBaseMap() {
  if (!S.map || !S.cfg) return;
  clearMarkers(); S.routeCoords = null;
  const all = S.cfg.cities; const maxPop = Math.max(...all.map((c) => c.pop));
  const k = $('#mapwrap').clientWidth < 560 ? 0.62 : 1;
  for (const c of all) addMarker(c, { size: Math.round((7 + 15 * Math.sqrt(c.pop / maxPop)) * k), bg: greyDot(), minor: true });
  drawHeat(false);
  $('#legend').innerHTML = `<b>${t('34 US metros')}</b><span class="ui-secondary">${t('Sized by population, the way tours are usually routed.')}${S.running ? ` ${t('Scoring them by taste…')}` : ''}</span>`;
}
function drawLiveTop() {
  if (!S.map || !S.liveTop) return;
  clearMarkers();
  const top = new Map(S.liveTop.map((m, i) => [m.id, { ...m, rank: i + 1 }]));
  for (const c of S.cfg.cities) {
    const t = top.get(c.id);
    if (!t) addMarker(c, { size: 7, bg: greyDot(), minor: true });
  }
  for (const [id, t] of top) { const c = S.cities[id]; addMarker({ ...c, ...t }, { size: 22 + Math.round(t.affinity * 18), bg: tasteColor(t.hms), rank: t.rank, label: c.name, enter: true, delay: t.rank * 60 }); }
  S.routeCoords = [...top.keys()].map((id) => S.cities[id]).filter(Boolean).map((c) => [c.lng, c.lat]);
  fitTour(true, true);
  declutter();
  $('#legend').innerHTML = `<b>${t('Scored by taste')}</b><span class="ui-secondary">${t('The top markets light up as the agent ranks them. Preparing the dates…')}</span>${heatLegend()}`;
}
let routeAnim;
function drawMap() {
  if (!S.map || !S.book?.markets) return;
  clearMarkers();
  const b = S.book; const all = b.markets.all;
  const affs = all.map((m) => m.affinity); const lo = Math.min(...affs), hi = Math.max(...affs);
  const maxPop = Math.max(...all.map((m) => m.pop));
  const qloo = S.plan === 'qloo';
  const selected = qloo ? new Map(b.markets.top.map((m, i) => [m.id, i + 1])) : new Map((b.baseline?.cities || []).map((c, i) => [c.id, i + 1]));
  const routeIds = qloo ? b.route : (b.baselineRoute?.length ? b.baselineRoute : (b.baseline?.cities || []).map((c) => c.id));
  const compact = $('#mapwrap').clientWidth < 560;
  const k = compact ? 0.72 : 1;
  for (const m of all.filter((x) => !selected.has(x.id))) addMarker(m, { size: 7, bg: greyDot(), minor: true });
  for (const m of all.filter((x) => selected.has(x.id))) {
    const rank = selected.get(m.id);
    const size = Math.round((qloo ? 22 + 22 * ((m.affinity - lo) / Math.max(0.001, hi - lo)) : 20 + 26 * Math.sqrt(m.pop / maxPop)) * k);
    addMarker(m, { size, bg: qloo ? tasteColor(m.hms) : (isDark() ? '#8E8E93' : '#636366'), rank, label: m.name, hidden: qloo && m.hidden, enter: true, delay: rank * 55 });
  }
  $('#legend').innerHTML = qloo
    ? `<b>${t('With Qloo')}</b><div class="ramp"></div><div class="ends"><span>${t('Hidden Market Score')}</span><span>${t('higher')}</span></div><span class="ui-secondary">${t('Size is taste affinity. A ring marks a hidden market.')}</span>${heatLegend()}`
    : `<b>${t('Without Qloo')}</b><div class="ramp is-pop"></div><div class="ends"><span>${t('Population')}</span><span>${t('bigger')}</span></div><span class="ui-secondary">${t('What a model without taste data proposes.')}</span>`;
  const coords = routeIds.map((id) => S.cities[id]).filter(Boolean).map((c) => [c.lng, c.lat]);
  S.routeCoords = coords;
  drawHeat(false);
  fitTour(true);
  declutter();
  animateRoute(coords);
}
function fitTour(animate, force = false) {
  if (!S.map) return;
  const cs = S.routeCoords;
  if ((!S.book && !force) || !cs || cs.length < 2) { S.map.fitBounds(US, { padding: mapPadding(), duration: animate && !reduceMotion() ? 700 : 0 }); return; }
  const lngs = cs.map((c) => c[0]); const lats = cs.map((c) => c[1]);
  S.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: mapPadding(), maxZoom: 5.4, duration: animate && !reduceMotion() ? 900 : 0 });
}
function animateRoute(coords) {
  cancelAnimationFrame(routeAnim);
  const src = S.map.getSource('route'); if (!src) return;
  const set = (cs) => src.setData({ type: 'FeatureCollection', features: cs.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: cs } }] : [] });
  if (reduceMotion() || coords.length < 2) return set(coords);
  const dur = 1400; const t0 = performance.now(); const segs = coords.length - 1;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const p = ease(Math.min(1, Math.max(0, (now - t0) / dur))) * segs;
    const i = Math.floor(p); const f = p - i;
    const cs = coords.slice(0, i + 1);
    if (i < segs) cs.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f]);
    set(cs);
    if (p < segs) routeAnim = requestAnimationFrame(step);
  };
  routeAnim = requestAnimationFrame(step);
}
function setPlan(p) {
  S.plan = p;
  const r = $(`#planToggle input[value="${p}"]`);
  if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  $('#compareFlip').textContent = p === 'qloo' ? t('Show without Qloo') : t('Show with Qloo');
  drawMap();
}

// ---------------- dossier sheet ----------------
async function openDossier(cityId) {
  const market = S.book?.markets?.all.find((m) => m.id === cityId);
  if (!market) return;
  S.dossierId = cityId;
  $('#dossierTitle').textContent = market.name;
  const body = $('#dossierBody');
  body.innerHTML = dossierHead(market) + `<div class="d-skel">${['70%', '90%', '55%', '80%', '65%'].map((w) => `<div class="ui-skeleton" style="width:${w};height:14px"></div>`).join('')}<p class="ui-footnote ui-secondary">${t('Asking Qloo for the room, opener, sponsor and crowd in {city}…', { city: esc(market.name) })}</p></div>`;
  if (!$('#sheet-dossier').open) openSheet('sheet-dossier');
  body.scrollTop = 0;
  updateNext();
  let d = S.dossiers[cityId];
  if (!d) {
    try { d = await fetchDossier(market); } catch (e) {
      if (S.dossierId !== cityId) return;
      body.innerHTML = dossierHead(market) + `<div class="ui-banner ui-banner--critical">${icon('i-alert')}<div style="flex:1"><strong>${t('This dossier did not load')}</strong><p>${t('{error}. The plan itself is unchanged.', { error: esc(e.message) })}</p></div><button class="ui-button ui-button--sm" type="button" id="dossierRetry">${t('Try again')}</button></div>`;
      $('#dossierRetry').addEventListener('click', () => openDossier(cityId));
      return;
    }
  }
  if (S.dossierId !== cityId) return;
  body.innerHTML = dossierHead(market) + dossierBody(d);
  spring(body, [{ opacity: 0.4 }, { opacity: 1 }], { preset: 'quick', fill: 'none' });
}
async function fetchDossier(market) {
  const ids = [S.book.artist, ...S.book.proxies].map((r) => r?.selected?.id).filter(Boolean).join(',');
  const type = S.book.artist?.selected?.type || 'urn:entity:artist';
  const res = await fetch(`/api/city/${encodeURIComponent(market.id)}?entities=${encodeURIComponent(ids)}&type=${encodeURIComponent(type)}`);
  const r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || r.error) throw new Error(r.error || `HTTP ${res.status}`);
  const d = { market, venue: r.venue, after_party: r.after, crowd_brief: r.crowd, opener: r.opener, sponsor: r.sponsor };
  S.dossiers[market.id] = d;
  return d;
}
function dossierOrder() { const top = S.book.markets.top.map((m) => m.id); return top.includes(S.dossierId) ? top : S.book.markets.all.map((m) => m.id); }
function updateNext() {
  const order = dossierOrder(); const i = order.indexOf(S.dossierId); const next = S.book.markets.all.find((m) => m.id === order[(i + 1) % order.length]);
  $('#dossierNext').setAttribute('aria-label', t('Next market: {name}', { name: next?.name || '' }));
}
function nextDossier() { const order = dossierOrder(); const i = order.indexOf(S.dossierId); openDossier(order[(i + 1) % order.length]); }

function dossierHead(m) {
  const idx = (S.book.dates || []).findIndex((d) => d.market?.id === m.id);
  const where = idx >= 0 ? t('Date {n} of the tour.', { n: idx + 1 }) : (S.book.markets.top.some((x) => x.id === m.id) ? t('In the top markets, not yet a prepped date.') : t('Outside the top markets.'));
  return `<div class="d-score"><div class="big"><b>${m.hms}</b><small>HMS</small></div>
    <p><strong>${esc(m.name)}, ${esc(m.state)}. ${t('Taste #{taste}, population #{pop}', { taste: m.affinityRank, pop: m.popRank })}.</strong> ${m.rankGap > 0 ? t('Beats its population rank by {n} places.', { n: m.rankGap }) : t('Taste does not beat population here ({gap}).', { gap: signed(m.rankGap) })} ${t('Taste affinity {aff} of 100, metro population {pop}.', { aff: pct(m.affinity), pop: fmtPop(m.pop) })} ${where}${m.hidden ? ` <span class="ui-status ui-status--ok">${t('Hidden market')}</span>` : ''}</p></div>`;
}
function evidence(prov) {
  const list = (Array.isArray(prov) ? prov : [prov]).filter(Boolean);
  if (!list.length) return '';
  const txt = list.map((p) => `GET ${p.path}\n${Object.entries(p.params || {}).map(([k, v]) => `  ${k}=${v}`).join('\n')}${p.ms != null ? `\n  · ${p.mode} · ${p.ms} ms${p.cache && p.cache !== 'mock' ? ` · cache ${p.cache}` : ''}` : ''}`).join('\n\n');
  return `<details class="evidence"><summary>${list.length > 1 ? t('Qloo requests ({n}) behind this pick', { n: list.length }) : t('Qloo request behind this pick')}</summary><pre>${esc(txt)}</pre></details>`;
}
function drivers(x) {
  const ex = x?.explainability?.['signal.interests.entities'];
  if (!Array.isArray(ex) || !ex.length) return '';
  const names = Object.fromEntries([S.book.artist, ...S.book.proxies].filter(Boolean).map((r) => [r.selected.id, r.selected.name]));
  return `<div class="drivers" aria-label="${t('Which inputs drove this pick')}">${ex.slice().sort((a, b) => b.score - a.score).slice(0, 4).map((e) => `<div class="dv"><span>${esc(names[e.entity_id] || t('Signal'))}</span><i style="--v:${pct(e.score)}%"></i><b>${pct(e.score)}</b></div>`).join('')}</div>`;
}
function pickBlock(title, sec, list, extra = '') {
  const items = list || [];
  if (!items.length) return `<div class="ui-list-section pick"><div class="ui-list__header"><strong>${title}</strong></div><ul class="ui-list"><li><div class="ui-row"><span class="ui-row__body"><span class="ui-row__subtitle">${t('Qloo returned nothing for this slot. The agent leaves it open rather than guess.')}</span></span></div></li></ul>${evidence(sec?.provenance)}</div>`;
  const [top, ...alts] = items;
  return `<div class="ui-list-section pick"><div class="ui-list__header"><strong>${title}</strong></div>
    <ul class="ui-list"><li><div class="ui-row"><span class="ui-row__body"><span class="ui-row__title">${esc(top.name)}</span>
      ${top.description || top.address ? `<span class="ui-row__subtitle">${esc([tData(top.description), top.address].filter(Boolean).join(' · '))}</span>` : ''}
      ${extra}${drivers(top)}</span><span class="aff"><b>${pct(top.affinity)}</b>${t('affinity')}</span></div></li>
      ${alts.length ? `<li><div class="ui-row"><span class="ui-row__body"><span class="alts">${t('Also strong: {names}', { names: alts.slice(0, 3).map((a) => esc(a.name)).join(', ') })}</span></span></div></li>` : ''}</ul>
    ${evidence(sec?.provenance)}</div>`;
}
function dossierBody(d) {
  const g = d.opener?.gain;
  const gain = g?.overlap != null ? `<span class="gain">${t('{n} % taste fit with the headliner', { n: pct(g.overlap) })}${g.shared?.length ? t(', shared: {list}', { list: esc(g.shared.slice(0, 3).join(', ')) }) : ''}${g.differentiators?.length ? t('; adds {list}', { list: esc(g.differentiators.slice(0, 3).join(', ')) }) : ''} (<code>/v2/analysis/compare</code>).</span>` : '';
  const cb = d.crowd_brief || {};
  const names = (xs, n) => (xs || []).slice(0, n).map((x) => esc(x.name)).join(', ');
  const brief = [
    cb.shows?.length ? `<p><span>${t('Shows they watch:')}</span> ${names(cb.shows, 3)}</p>` : '',
    cb.podcasts?.length ? `<p><span>${t('Podcasts:')}</span> ${names(cb.podcasts, 3)}</p>` : '',
    cb.themes?.length ? `<p><span>${t('Local themes for the set and the crowd work:')}</span> ${names(cb.themes, 6)}</p>` : '',
  ].join('');
  return [
    pickBlock(t('Room'), d.venue, d.venue?.picks),
    pickBlock(t('Opener'), d.opener, d.opener?.openers, gain),
    pickBlock(t('Sponsor fit'), d.sponsor, d.sponsor?.sponsors),
    pickBlock(t('After-show spot'), d.after_party, d.after_party?.picks),
    `<div class="ui-list-section"><div class="ui-list__header"><strong>${t('Crowd brief')}</strong></div><div class="ui-list brief">${brief || `<p><span>${t('No crowd signal for this city.')}</span></p>`}</div>${evidence(cb.provenance)}</div>`,
    `<p class="d-note">${S.book.meta.qloo === 'live' ? t('Qloo affinities describe aggregate audiences, never individuals.') : t('Synthetic data in mock mode. Affinities describe aggregate audiences, never individuals.')}</p>`,
  ].join('');
}
function buildPrintDossiers() {
  let head = $('#printTitle');
  if (!head) { head = document.createElement('div'); head.id = 'printTitle'; head.className = 'print-only'; $('#view-plan').prepend(head); }
  head.innerHTML = `<h1 class="ui-large-title" style="margin:0">${t('{name}: tour plan', { name: esc(S.book.artist?.selected?.name || S.input.artist) })}</h1><p class="print-head">${esc(t(TYPE_LABEL[S.input.type] || 'Music'))} · Tourbook · ${esc(new Date(S.book.createdAt).toLocaleDateString(LOCALE, { dateStyle: 'long' }))}${S.book.meta.qloo === 'live' ? '' : ` · ${t('synthetic data')}`}</p>`;
  let box = $('#printDossiers');
  if (!box) { box = document.createElement('div'); box.id = 'printDossiers'; box.className = 'print-only print-dossiers block'; $('.when-ready').append(box); }
  box.innerHTML = `<h2 class="ui-title2">${t('Date dossiers')}</h2><p class="print-head">${t('Each pick cites a Qloo request; the full request log is in Tourbook’s Agent view.')}</p>` + (S.book.dates || []).filter((d) => d.market).map((d, i) => `<section><h3 class="ui-title3">${t('Date {n}: {name}', { n: i + 1, name: esc(d.market.name) })}</h3>${dossierHead(d.market)}${dossierBody(d)}</section>`).join('');
  $$('#printDossiers details').forEach((x) => { x.open = true; });
}

// ---------------- PDF on phones (jsPDF, loaded on demand) ----------------
function loadScript(src) {
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('script')); document.head.append(s); });
}
const COLON = LANG === 'fr' ? '\u00A0: ' : ': '; // French puts a no-break space before a colon
async function savePlanPdf() {
  const b = S.book; if (!b) return;
  const btn = $('#printBtn'); btn.setAttribute('aria-busy', 'true');
  try {
    if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
    let y = M;
    const clean = (s) => String(s ?? '').replace(/[^\u0000-\u024F\u2018-\u201E\u2013\u2014\u2026\u00B7]/g, '');
    const line = (text, { size = 11, bold = false, color = [20, 20, 22], gap = 4 } = {}) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
      for (const l of doc.splitTextToSize(clean(text), W - 2 * M)) {
        if (y + size > H - M) { doc.addPage(); y = M; }
        doc.text(l, M, y + size); y += size * 1.35;
      }
      y += gap;
    };
    const name = b.artist?.selected?.name || S.input.artist;
    line(t('{name}: tour plan', { name }), { size: 22, bold: true });
    line(`${t(TYPE_LABEL[S.input.type] || 'Music')} · Tourbook · ${new Date(b.createdAt).toLocaleDateString(LOCALE, { dateStyle: 'long' })}`, { size: 10, color: [110, 110, 118], gap: 12 });
    if (b.summary) line(b.summary, { size: 11, gap: 14 });
    line(t('Markets ranked by Hidden Market Score'), { size: 14, bold: true });
    (b.markets?.top || []).forEach((m, i) => line(`${i + 1}. ${m.name}, ${m.state} · HMS ${m.hms} · ${t('Taste #{taste}, population #{pop}', { taste: m.affinityRank, pop: m.popRank })}`, { size: 10.5, gap: 1 }));
    y += 12;
    (b.dates || []).filter((d) => d.market).forEach((d, i) => {
      line(t('Date {n}: {name}', { n: i + 1, name: `${d.market.name}, ${d.market.state}` }), { size: 14, bold: true });
      const pick = (label, x, extra = '') => { if (x?.name) line(`${t(label)}${COLON}${x.name}${extra}`, { size: 10.5, gap: 1 }); };
      pick('Room', d.venue?.picks?.[0]);
      const g = d.opener?.gain?.overlap;
      pick('Opener', d.opener?.openers?.[0], g != null ? ` · ${t('{n} % taste fit', { n: pct(g) })}` : '');
      pick('Sponsor', d.sponsor?.sponsors?.[0]);
      pick('After-show', d.after_party?.picks?.[0]);
      const themes = (d.crowd_brief?.themes || []).slice(0, 5).map((x) => x.name).join(', ');
      if (themes) line(`${t('Crowd brief')}${COLON}${themes}`, { size: 10.5, gap: 1 });
      y += 10;
    });
    if (b.comparison) line(t('A model without taste data would have missed {n} of these stops.', { n: b.comparison.onlyQloo.length }), { size: 10.5, gap: 10 });
    line(t('Source: Qloo Insights API. Aggregate taste affinities, never individuals.'), { size: 9, color: [110, 110, 118] });
    const file = new File([doc.output('blob')], `Tourbook - ${clean(name)}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); } catch (e) { if (e?.name !== 'AbortError') throw e; }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  } catch {
    toast({ title: t('The PDF could not be created'), detail: t('Check the connection, then try again.'), tone: 'critical' });
  } finally { btn.removeAttribute('aria-busy'); }
}

// ---------------- voice briefing (browser speech, no paid TTS) ----------------
function briefingText() {
  const b = S.book; const name = b.artist?.selected?.name || S.input?.artist;
  const [d1, d2, d3] = b.dates || []; const top = b.markets.top;
  const parts = [t('Here\'s your tour, boss. {name}.', { name })];
  if (top[0]) parts.push(t('Lead with {city}. Hidden Market Score {hms}: taste rank {taste}, population rank only {pop}.', { city: top[0].name, hms: top[0].hms, taste: top[0].affinityRank, pop: top[0].popRank }));
  if (top[1] && top[2]) parts.push(t('Then {a} and {b}.', { a: top[1].name, b: top[2].name }));
  if (d1?.venue?.picks?.[0]) parts.push(`${t('In {city}, play {venue}', { city: d1.market.name, venue: d1.venue.picks[0].name })}${d1.opener?.openers?.[0] ? t(', open with {name}', { name: d1.opener.openers[0].name }) : ''}${d1.sponsor?.sponsors?.[0] ? t(', and pitch {name} as sponsor', { name: d1.sponsor.sponsors[0].name }) : ''}.`);
  if (d2?.after_party?.picks?.[0]) parts.push(t('After the {city} show, the crowd goes to {place}.', { city: d2.market.name, place: d2.after_party.picks[0].name }));
  if (d3) parts.push(t('{city} closes the first run.', { city: d3.market.name }));
  if (b.comparison) parts.push(t('A model without taste data would have missed {n} of these stops.', { n: b.comparison.onlyQloo.length }));
  if (b.momentum?.advice) parts.push(t(b.momentum.advice));
  if (b.meta.qloo !== 'live') parts.push(t('Note: this is synthetic demo data.'));
  return parts.join(' ');
}
let waveRaf;
// The utterance always carries its language (en-US or fr-FR): without it, a French iPhone reads the English
// briefing with its French system voice. getVoices() is often empty until 'voiceschanged' fires, so voices are
// preloaded at boot and a click waits for them briefly (never more than VOICE_WAIT_MS) before speaking anyway.
const VOICE_LANG = LANG === 'fr' ? 'fr-FR' : 'en-US';
const VOICE_WAIT_MS = 600;
let voiceToken = 0;
function loadVoices(timeout = VOICE_WAIT_MS) {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); speechSynthesis.removeEventListener?.('voiceschanged', done); resolve(speechSynthesis.getVoices()); };
    const timer = setTimeout(done, timeout);
    speechSynthesis.addEventListener?.('voiceschanged', done);
  });
}
if ('speechSynthesis' in window) loadVoices(3000); // warm the list so a click usually speaks at once
function pickVoice(voices) {
  const norm = (x) => String(x.lang || '').replace('_', '-').toLowerCase();
  const exact = VOICE_LANG.toLowerCase(); const base = exact.slice(0, 2);
  const nice = LANG === 'fr' ? /Thomas|Amélie|Amelie|Audrey|Aurélie|Marie|Google|Natural|Premium|Enhanced/i : /Samantha|Daniel|Ava|Google|Natural|Premium/i;
  const same = voices.filter((x) => norm(x) === exact);
  const family = voices.filter((x) => norm(x) === base || norm(x).startsWith(`${base}-`));
  const preferred = LANG === 'fr' ? family : family.filter((x) => /^en-(us|gb)$/.test(norm(x)));
  return same.find((x) => nice.test(x.name)) || preferred.find((x) => nice.test(x.name)) || same[0] || family[0] || null;
}
function toggleVoice() {
  if (!('speechSynthesis' in window) || !S.book) return;
  if (speechSynthesis.speaking || $('#voiceDock').dataset.state === 'thinking') return stopVoice();
  const text = briefingText();
  const dock = $('#voiceDock'); const wave = $('#voiceWave'); const line = $('#voiceLine');
  dock.hidden = false; dock.dataset.state = 'thinking'; line.textContent = t('Preparing the briefing…');
  $('#voiceBtn').setAttribute('aria-pressed', 'true'); $('#voiceBtn').setAttribute('aria-label', t('Stop the voice briefing'));
  const token = ++voiceToken;
  const speak = (voices) => {
    if (token !== voiceToken) return; // stopped (or restarted) while the voices were loading
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG;
    const v = pickVoice(voices);
    if (v) u.voice = v;
    u.rate = 1.02;
    wave.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
    const bars = [...wave.children]; const lv = bars.map(() => 0);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const showAt = (ci) => {
      let acc = 0;
      for (const s of sentences) { if (ci < acc + s.length) { const k = ci - acc; line.innerHTML = `<span class="said">${esc(s.slice(0, k))}</span><span class="next">${esc(s.slice(k))}</span>`; return; } acc += s.length; }
    };
    u.onstart = () => { dock.dataset.state = 'speaking'; showAt(0); };
    u.onboundary = (e) => { showAt(e.charIndex); bars.forEach((_, i) => { lv[i] = Math.max(lv[i], 0.35 + Math.random() * 0.65); }); };
    u.onend = stopVoice; u.onerror = stopVoice;
    const tick = () => { bars.forEach((b, i) => { lv[i] *= 0.9; b.style.setProperty('--l', lv[i].toFixed(3)); }); waveRaf = requestAnimationFrame(tick); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    cancelAnimationFrame(waveRaf); if (!reduceMotion()) tick();
  };
  // Voices already known: speak inside the click (iOS wants the user gesture). Otherwise wait briefly for them.
  const now = speechSynthesis.getVoices();
  if (now.length) speak(now); else loadVoices().then(speak);
}
function stopVoice() {
  voiceToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  cancelAnimationFrame(waveRaf);
  $('#voiceDock').hidden = true; $('#voiceDock').dataset.state = 'idle';
  $('#voiceBtn').setAttribute('aria-pressed', 'false'); $('#voiceBtn').setAttribute('aria-label', t('Play the voice briefing'));
}

// ---------------- share ----------------
function shareParams(input = S.input) {
  const i = S.cfg.demos.findIndex((d) => d.artist === input?.artist && d.proxies.slice(0, 3).join(',') === input.proxies.join(','));
  if (i >= 0) return `demo=${slug(S.cfg.demos[i].artist)}`;
  return new URLSearchParams({ artist: input.artist, proxies: input.proxies.join(','), type: input.type }).toString();
}
async function share() {
  const url = `${location.origin}${location.pathname}?${shareParams()}`;
  try { await navigator.clipboard.writeText(url); toast({ title: t('Link copied'), detail: t('Opening it replays this plan.'), tone: 'ok' }); }
  catch { toast({ title: t('Copy this link'), detail: url, action: { label: t('Open'), onClick: () => window.open(url, '_blank', 'noopener') } }); }
}

// ---------------- room mode (venue side) ----------------
const actDesc = (a) => { const d = String(a.description || '').replace(/\s*\(synthetic\)\s*$/i, '').trim(); return d && !/^(artist|musician)$/i.test(d) ? `<span class="act-desc">${esc(d)}</span>` : ''; };
async function venueSearch() {
  if (S.venueBusy) return; // one request per click (UB-31)
  const hood = $('#vHood').value.trim();
  if (!hood) { $('#vHood').setAttribute('aria-invalid', 'true'); $('#vHoodErr').hidden = false; $('#vHood').focus(); return; }
  S.venueBusy = true; $('#venueBtn').disabled = true; $('#venueBtn').textContent = t('Finding acts…');
  $$('#hoodChips [data-hood]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.hood === hood)));
  const box = $('#venueResults');
  box.innerHTML = `<div class="skel-rows" aria-label="${t('Loading acts')}">${Array.from({ length: 6 }, (_, i) => `<div class="skel-row"><div class="ui-skeleton" style="width:${40 + ((i * 17) % 35)}%;height:15px"></div><div class="ui-skeleton" style="height:15px"></div><div class="ui-skeleton" style="width:${55 + ((i * 11) % 30)}%;height:11px"></div></div>`).join('')}</div>`;
  try {
    const res = await fetch(`/api/venue?neighborhood=${encodeURIComponent(hood)}&popMax=${$('#vPop').value}`);
    const r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || r.error) throw Object.assign(new Error(r.error || `HTTP ${res.status}`), { status: res.status });
    const mock = S.cfg.qloo.mode !== 'live';
    const c = r.calls?.[0];
    const popCap = Number($('#vPop').value).toFixed(2);
    box.innerHTML = r.acts.length
      ? `<div class="ui-list-section"><div class="ui-list__header"><strong>${t('{n} acts for {hood}', { n: r.acts.length, hood: esc(hood) })}</strong><span>${t('Popularity under {cap}', { cap: dec(popCap) })}</span></div>
        <div class="ui-table-wrap"><table class="ui-table ui-table--stack acts"><thead><tr><th class="is-num" data-slot="hide-compact">#</th><th>${t('Act')}</th><th>${t('Local fit')}</th><th>${t('Popularity')}</th></tr></thead><tbody>${
          r.acts.map((a, i) => `<tr><td class="is-num is-muted" data-slot="hide-compact">${i + 1}</td><td data-slot="title"><span class="is-strong">${esc(a.name)}</span>${actDesc(a)}</td><td data-slot="trailing"><div class="meter"><div class="track"><div class="fill" style="width:${pct(a.affinity)}%"></div></div><b>${pct(a.affinity)}</b><span class="only-compact ui-footnote ui-secondary">${t('fit')}</span></div></td><td data-slot="meta"><div class="meter"><span class="only-compact">${t('Popularity')}</span><div class="track"><div class="fill is-pop" style="width:${pct(a.popularity)}%"></div></div><b>${pct(a.popularity)}</b></div></td></tr>`).join('')
        }</tbody></table></div>
        <p class="ui-list__footer">${mock ? `${t('Synthetic data.')} ` : ''}${t('Local fit is Qloo affinity for the people around {hood}', { hood: esc(hood) })}${c ? `${LANG === 'fr' ? '\u00a0:' : ':'} <code>GET ${esc(c.path)} · ${esc(Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(' & '))}</code>` : '.'}</p></div>`
      : `<div class="ui-empty"><span class="ui-empty__icon">${icon('i-room')}</span><h3>${t('No acts under {cap} popularity here', { cap: dec(popCap) })}</h3><p>${t('Raise the popularity cap, or try a wider area such as the city name.')}</p></div>`;
  } catch (e) {
    const unknown = e.status === 400;
    box.innerHTML = `<div class="ui-banner ui-banner--${unknown ? 'warn' : 'critical'}">${icon('i-alert')}<div style="flex:1"><strong>${unknown ? t('Qloo could not place “{hood}”', { hood: esc(hood) }) : t('Room mode is unavailable right now')}</strong><p>${unknown ? t('Add the city, for example “Wicker Park, Chicago”.') : t('{error}. Try again in a moment.', { error: esc(e.message) })}</p></div></div>`;
  } finally {
    S.venueBusy = false; $('#venueBtn').disabled = false; $('#venueBtn').textContent = t('Find acts');
  }
}

window.Tourbook = { S, UI, briefingText }; // handy for debugging in the console
