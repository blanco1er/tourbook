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
  history: { title: 'History', sub: 'Saved on this device' },
};

const S = {
  cfg: null, book: null, plan: 'qloo', map: null, markers: [], cities: {}, es: null, dossiers: {}, calls: [], tools: 0,
  trace: [], input: null, running: false, rid: null, retryRid: null, view: 'plan', dossierId: null, t0: 0, liveTop: null, curTool: null, venueBusy: false,
};

init();

// ---------------- boot ----------------
async function init() {
  S.homeSummary = $('#summary').innerHTML; // the home pitch, put back by goHome()
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
  $('#hoodChips').innerHTML = S.cfg.neighborhoods.map((n) => { const [name, city] = hoodParts(n); return `<button class="hood" type="button" data-hood="${esc(n)}" aria-pressed="false"><b>${esc(name)}</b><small>${esc(city)}</small></button>`; }).join('');
  if ('speechSynthesis' in window) $('#voiceBtn').hidden = false;
  initMap();
  routeFromUrl();
}

const heroLabel = () => (matchMedia('(max-width: 699px)').matches ? t('Run the demo') : t('Run the {name} demo', { name: S.cfg?.demos?.[0]?.artist || '' }).replace('  ', ' ').trim());

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
  bindTabs(); bindAsk(); bindRooms();
  $('#liveToggle').addEventListener('click', () => setLiveOpen(!$('#live').classList.contains('is-open')));
  $('#validateBtn').addEventListener('click', openPoster);
  $('#saveBtn').addEventListener('click', () => { if (isSaved()) unsaveTour(savedId()); else saveTour(); });
  $('#homeTabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) { S.homeTabPicked = true; setHomeTab(b.dataset.htab); } });
  $('#savedList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-unsave]'); if (del) { unsaveTour(del.dataset.unsave); return; }
    const o = e.target.closest('[data-saved]'); if (o) openSaved(o.dataset.saved);
  });
  renderSaved(); renderRooms();
  $('#histTabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) setHistTab(b.dataset.hist); });
  $('#roomsHist').addEventListener('click', (e) => {
    const del = e.target.closest('[data-room-del]'); if (del) { const l = readRooms(); l.splice(Number(del.dataset.roomDel), 1); try { localStorage.setItem(ROOMS_KEY, JSON.stringify(l)); } catch {} renderRooms(); return; }
    const o = e.target.closest('[data-room-hist]'); if (!o) return;
    const x = readRooms()[Number(o.dataset.roomHist)]; if (!x) return;
    const r = $(`#vSize input[value="${x.cap}"]`); if (r) r.checked = true; $('#vPop').value = String(x.cap);
    $('#vHood').value = x.hood; S.venueDone = true; setView('rooms'); venueSearch();
  });
  $('#actId').addEventListener('click', (e) => { if (e.target.closest('#whoBtn')) openWho(); });
  $('#whoList').addEventListener('click', (e) => {
    const r = e.target.closest('[data-who]'); if (!r) return;
    const c = S.whoCands[Number(r.dataset.who)]; closeSheet('sheet-who');
    run({ artist: c.name, proxies: S.input?.proxies || [], type: S.input?.type || 'artist', artistId: c.id });
  });
  $('#posterArtBtn').addEventListener('click', makePosterArt);
  $('#posterShare').addEventListener('click', () => sharePoster(true));
  $('#posterSave').addEventListener('click', () => sharePoster(false));
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); if (nav.dataset.nav === 'plan' && S.view === 'plan' && S.book && !S.running) goHome(); else setView(nav.dataset.nav); return; } // tapping the active Plan tab goes back home, like iOS
    if (e.target.closest('#homeBtn')) { goHome(); return; }
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
  attachSuggest($('#fArtist'), $('#fArtistSugg'), { head: true });
  ['p1', 'p2', 'p3'].forEach((n) => attachSuggest($(`#planForm [name=${n}]`), $(`#planForm [data-sugg-for=${n}]`), { head: false }));
  $('#fType').addEventListener('change', () => { const i = $('#fArtist'); if (i.value.trim().length >= 2 && i.dataset.pick !== i.value.trim()) i.dispatchEvent(new Event('input')); });
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
  $('#vSize').addEventListener('change', (e) => { $('#vPop').value = e.target.value; if ($('#vHood').value.trim()) venueSearch(); });
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
  if (view === 'rooms') { requestAnimationFrame(() => S.roomMap?.resize()); if (!S.venueDone && !S.venueBusy && S.cfg?.neighborhoods?.[0]) { $('#vHood').value ||= S.cfg.neighborhoods[0]; venueSearch(); } }
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
  $('#homeBtn').hidden = !(S.view === 'plan' && S.book && !S.running);
  updateAvatar();
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
  const artistId = $('#fArtist').dataset.pick === artist ? $('#fArtist').dataset.id : undefined; // the act picked in the live list
  closeSheet('sheet-plan', 'run');
  run({ artist, proxies, type, ...(artistId ? { artistId } : {}) });
}
function fillForm(input) {
  $('#fArtist').value = input.artist; $('#fArtist').dataset.pick = input.artistId ? input.artist : ''; $('#fArtist').dataset.id = input.artistId || '';
  $$('#planForm .sugg').forEach((u) => { u.hidden = true; u.innerHTML = ''; }); $('#proxyBox')?.classList.remove('is-callout');
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

function resumeRun() {
  if (!S.input || !S.rid || S.book) return;
  const rid = S.rid; S.running = false; S.es = null;
  run(S.input, { rid, keepView: true, resume: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.resumeOnShow) { S.resumeOnShow = false; resumeRun(); } });
function run(input, { rid, keepView = false, demoIndex, resume = false } = {}) {
  const opts = { resume }; if (!resume) S.reconnects = 0;
  // UB-31: one plan per click. The lock below stops a second click; the request id makes the server
  // join the run already in flight if a duplicate request still gets through.
  if (S.running) { toast({ title: t('Already planning'), detail: t('{artist} is still running. One plan at a time.', { artist: S.input?.artist }) }); return; }
  S.running = true;
  S.rid = rid || newRid(); S.retryRid = null;
  S.es?.close(); S.book = null; S.dossiers = {}; setActPhoto(null); S.actShown = false; $('#actId').hidden = true; S.validated = false; S.posterArt = null; S.posterFull = false; S.posterBand = false; S.posterDir = null; S.act = null; updateValidate(); S.calls = []; S.tools = 0; S.trace = []; S.input = input; S.liveTop = null; S.heat = null; S.curTool = null; S.plan = 'qloo';
  fillForm(input);
  stopVoice(); if ($('#sheet-dossier').open) closeSheet('sheet-dossier');
  setBusy(true, demoIndex ?? S.cfg.demos.findIndex((d) => d.artist === input.artist));
  if (!keepView && S.view !== 'agent') setView('plan');
  const view = $('#view-plan');
  view.dataset.state = 'running';
  $('#planError').hidden = true; $('#stats').hidden = true; $('#planToggle').hidden = true;
  $('#planToggle input[value="qloo"]').checked = true; $('#planToggle input[value="qloo"]').dispatchEvent(new Event('change', { bubbles: true }));
  $('#summary').innerHTML = `<strong>${t('Planning {artist}.', { artist: esc(input.artist) })}</strong> <span class="muted" id="thought">${t('Every step and every Qloo request shows up as it happens.')}</span>`;
  $('#live').hidden = false; setLiveOpen(true); // open by default on every screen (owner, 30 Oct); one tap on the header folds it $('#liveLog').innerHTML = ''; $('#steps').innerHTML = ''; $('#lvStages').innerHTML = ''; $('#liveNow').hidden = false; setNow(t('Connecting to the agent…'));
  S.cityWork = {}; S.readyIds = [];
  clearInterval(S.liveTimer); const t0 = Date.now();
  const tick = () => { const el = $('#liveMeta'); if (el) el.innerHTML = `${Math.round((Date.now() - t0) / 1000)} s · <b class="live-n">${S.calls.length}</b> ${t((LANG === 'fr' ? S.calls.length <= 1 : S.calls.length === 1) ? 'Qloo request' : 'Qloo requests')}`; };
  S.liveTick = tick;
  tick(); S.liveTimer = setInterval(tick, 500);
  resetAgentView();
  drawBaseMap();
  updateToolbar();
  scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });

  S.t0 = performance.now();
  // A reload during the run re-attaches to the same server run (same request id) instead of starting another.
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ params: shareParams(input), rid: S.rid, t: Date.now() })); } catch {}
  history.replaceState(null, '', `?${shareParams(input)}${location.hash}`);
  const qs = new URLSearchParams({ artist: input.artist, proxies: input.proxies.join(','), type: input.type, rid: S.rid });
  if (input.artistId) qs.set('artistId', input.artistId);
  if (LANG === 'fr') qs.set('lang', 'fr'); // the agent narrates and summarises in French; tools and Qloo calls are unchanged
  const es = new EventSource(`/api/plan/stream?${qs}`);
  S.es = es;
  let gotEvent = false;
  const H = {}; // the same handlers serve the live stream and the JSON fallback below
  const on = (type, fn) => { H[type] = fn; es.addEventListener(type, (e) => { gotEvent = true; if (S.es !== es) return; const d = JSON.parse(e.data); if (type !== 'done') S.trace.push([type, d]); fn(d); }); };
  on('plan', (d) => {
    $('#steps').innerHTML = d.steps.map((s) => `<li data-step="${esc(s)}">${esc(t(s))}</li>`).join('');
    $('#lvStages').innerHTML = d.steps.map((s, i) => `<li class="lv-stage" data-stage="${esc(s)}"><details><summary><span class="lv-n">${i + 1}</span><b>${esc(t(s))}</b><span class="lv-sum"></span>${icon('i-chev-r', 'lv-chev')}</summary><ol class="lv-lines"></ol></details></li>`).join('');
    setStep('Resolve');
  });
  on('joined', () => liveLine('thought', t('Attached to the run already in progress. No second plan was started.')));
  on('thought', (d) => { if (S.cfg?.llm?.provider !== 'mock') setNow(d.text); agentLine({ kind: 'thought', text: d.text }); }); // the scripted planner's thought only repeats the tool line
  on('tool', (d) => {
    if (d.status === 'start') {
      S.tools++;
      if (d.stage) setStep(d.stage);
      setNow(toolPhrase(d));
      lvLine(d, 'start');
      liveLine('tool', `<b>${esc(d.name)}</b><span>${esc(argSummary(d.args))}</span>`);
      cityWork(d, 'start');
      agentLine({ kind: 'tool', d });
    }
    if (d.status === 'done') { agentLine({ kind: 'done', d }); cityWork(d, 'done'); lvLine(d, 'done'); }
    if (d.status === 'done' && d.name === 'resolve_entity' && !S.actShown && d.result?.selected && (S.input?.artistId ? d.result.selected.id === S.input.artistId : d.result.selected.name?.trim().toLowerCase() === S.input?.artist?.trim().toLowerCase())) { S.actShown = true; showActId(d.result.selected, null); }
    if (d.status === 'done' && d.name === 'rank_markets' && d.result?.top) { S.liveTop = d.result.top; drawLiveTop(); }
    if (d.status === 'error') { lvLine(d, 'error'); liveLine('err', `<b>${esc(d.name)}</b><span>${esc(d.error)}</span>`); agentLine({ kind: 'toolerr', d }); }
    updateToolbar();
  });
  on('heat', (d) => { S.heat = d; drawHeat(true); });
  on('call', (d) => {
    if (d.status === 'start') return;
    S.calls.push(d);
    const ok = d.status === 'ok';
    const ft = d.params?.['filter.type'] ? ` ${d.params['filter.type'].replace('urn:entity:', '')}` : '';
    liveLine(ok ? 'call' : 'err', `<b>${ok ? 'GET' : esc(String(d.status).toUpperCase())}</b><span>${esc(d.path)}${esc(ft)}</span><em>${d.ms ?? ''} ms</em>`);
    S.liveTick?.(); $('#liveMeta .live-n')?.classList.add('is-bump');
    agentLine({ kind: 'call', d });
    lvCall(d);
    updateToolbar();
  });
  on('done', (book) => {
    es.close(); S.es = null; S.book = book; S.running = false;
    $$('#steps li').forEach((li) => { li.className = 'is-done'; });
    setBusy(false); render();
    history.replaceState(null, '', `?${shareParams()}${location.hash}`);
    clearPending(); saveSession();
    toast({ title: t('{name} is planned', { name: book.artist?.selected?.name || input.artist }), detail: book.meta.ms < 1000 ? t('Replayed from cached Qloo answers.') : t('{requests} in {s} s', { requests: plural(book.meta.calls, 'Qloo request'), s: dec((book.meta.ms / 1000).toFixed(1)) }), tone: 'ok' });
  });
  on('fail', (d) => { es.close(); failRun(d.code === 'daily_cap' ? t('Daily limit reached') : t('The agent stopped'), t(d.error || 'Unknown error.')); });
  es.onerror = () => {
    if (S.es !== es || !S.running) return;
    es.close();
    // iPhone pauses a page in the background and drops its stream, while the plan keeps running on the server.
    // Pick the same run up again (same request id: the server replays it, never a second run), silently.
    if (gotEvent || opts.resume) {
      if (document.hidden) { S.resumeOnShow = true; return; }
      if ((S.reconnects || 0) < 3) { S.reconnects = (S.reconnects || 0) + 1; setNow(t('Reconnecting to the agent…')); setTimeout(resumeRun, 900 * S.reconnects); return; }
    }
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
  try { const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); return p && p.params === location.search.slice(1) && Date.now() - p.t < 600000 ? p.rid : undefined; } catch { return undefined; }
}
function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ params: shareParams(), lang: LANG, input: S.input, book: S.book, trace: S.trace })); } catch { /* private mode or quota: reload simply re-runs */ }
}
/** Same URL reloaded in this tab: show the finished plan at once instead of spending Qloo calls again. */
// ---------------- my tours (owner, 30 Oct: a tour was lost on the way back home) ----------------
// Saved on this device only (no account): the finished plan, its agent log and its poster, reopened without a new run.
const SAVED_KEY = 'tourbook:saved';
const savedId = (b = S.book) => (b ? `${b.artist?.selected?.id || b.artist?.selected?.name}|${b.createdAt}` : '');
function readSaved() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } }
function writeSaved(list) {
  for (let keep = list.length; keep > 0; keep--) { // quota: drop the agent logs, then the oldest tours
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, keep))); return true; } catch { list = list.map((x, i) => (i >= keep - 1 ? { ...x, trace: [] } : x)); }
  }
  return false;
}
function isSaved() { const id = savedId(); return !!id && readSaved().some((x) => x.id === id); }
function saveTour({ quiet = false } = {}) {
  if (!S.book) return;
  const b = S.book; const id = savedId(b);
  const entry = { id, savedAt: Date.now(), lang: LANG, name: b.artist?.selected?.name || S.input?.artist, photo: b.artist?.selected?.photo || null, type: S.input?.type || 'artist', stops: b.markets?.top?.length || 0, lead: b.markets?.top?.[0]?.name || '', params: shareParams(), input: S.input, book: b, trace: S.trace, poster: S.posterArt || null, posterFull: !!S.posterFull, posterBand: !!S.posterBand, posterDir: S.posterDir || null };
  const list = [entry, ...readSaved().filter((x) => x.id !== id)].slice(0, 12);
  const ok = writeSaved(list);
  updateSaveBtn(); renderSaved();
  if (!quiet) toast({ title: ok ? t('Tour saved') : t('This device is out of space'), detail: ok ? t('Find it in the History tab.') : t('Delete an old tour and try again.'), tone: ok ? 'ok' : undefined });
}
function unsaveTour(id) { writeSaved(readSaved().filter((x) => x.id !== id)); updateSaveBtn(); renderSaved(); }
function updateSaveBtn() { const b = $('#saveBtn'); if (!b) return; const on = isSaved(); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', t(on ? 'Tour saved' : 'Save this tour')); }
function setHomeTab(tab) {
  S.homeTab = tab;
  $$('#homeTabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.htab === tab)));
  $$('.home-panel').forEach((p) => { p.hidden = p.dataset.hpanel !== tab; });
}
function renderSaved() {
  const list = readSaved();
  $('#savedEmpty').hidden = !!list.length;
  $('#savedNote').textContent = list.length ? t('{n} on this device', { n: list.length }) : '';
  $('#savedList').innerHTML = list.map((x) => `<li><div class="saved-row"><button type="button" class="saved-open" data-saved="${esc(x.id)}">${x.photo ? `<img src="/api/photo/${x.photo}" alt="" loading="lazy">` : `<span class="saved-ph">${icon('i-map')}</span>`}<span class="saved-txt"><b>${esc(x.name)}</b><small>${esc([t('{n} stops', { n: x.stops }), x.lead, new Date(x.savedAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · '))}</small></span></button><button type="button" class="saved-del" data-unsave="${esc(x.id)}" aria-label="${esc(t('Remove {name} from my tours', { name: x.name }))}">${icon('i-x')}</button></div></li>`).join('');
}
// Room searches history (owner, 30 Oct): the last neighbourhoods searched, reopened in one tap.
const ROOMS_KEY = 'tourbook:rooms';
function readRooms() { try { return JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]'); } catch { return []; } }
function logRoom(e) { const list = [e, ...readRooms().filter((x) => !(x.hood === e.hood && x.cap === e.cap))].slice(0, 15); try { localStorage.setItem(ROOMS_KEY, JSON.stringify(list)); } catch { /* storage full */ } renderRooms(); }
function renderRooms() {
  const list = readRooms(); if (!$('#roomsHist')) return;
  $('#roomsEmpty').hidden = !!list.length;
  $('#roomsNote').textContent = list.length ? t('{n} on this device', { n: list.length }) : '';
  $('#roomsHist').innerHTML = list.map((x, i) => `<li><div class="saved-row"><button type="button" class="saved-open" data-room-hist="${i}"><span class="saved-ph">${icon('i-pin')}</span><span class="saved-txt"><b>${esc(x.hood)}</b><small>${esc([t(SIZE_LABEL[String(x.cap)] || 'Mid-size'), t('{n} acts', { n: x.n }), x.top || '', new Date(x.at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · '))}</small></span></button><button type="button" class="saved-del" data-room-del="${i}" aria-label="${esc(t('Remove'))}">${icon('i-x')}</button></div></li>`).join('');
}
function setHistTab(tab) {
  $$('#histTabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.hist === tab)));
  $$('[data-histpanel]').forEach((p) => { p.hidden = p.dataset.histpanel !== tab; });
}

function openSaved(id) {
  const x = readSaved().find((y) => y.id === id); if (!x?.book?.markets) return;
  S.es?.close(); S.running = false;
  S.input = x.input; S.book = x.book; S.trace = x.trace || []; S.calls = []; S.tools = 0; S.curTool = null; S.plan = 'qloo';
  S.posterArt = x.poster || null; S.posterFull = !!x.posterFull; S.posterBand = !!x.posterBand; S.posterDir = x.posterDir || null; S.validated = !!x.poster; S.act = null;
  fillForm(S.input); resetAgentView();
  for (const [type, d] of S.trace) {
    if (type === 'thought') agentLine({ kind: 'thought', text: d.text });
    else if (type === 'tool' && d.status === 'start') { S.tools++; agentLine({ kind: 'tool', d }); }
    else if (type === 'tool' && d.status === 'error') agentLine({ kind: 'toolerr', d });
    else if (type === 'call' && d.status !== 'start') { S.calls.push(d); agentLine({ kind: 'call', d }); }
  }
  history.replaceState(null, '', `?${x.params}`);
  setView('plan'); render(); updateValidate(); updateSaveBtn(); saveSession();
  scrollTo({ top: 0, behavior: 'auto' });
}

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

// Back to the home screen from a finished plan (owner, 30 Oct: there was no way back).
function goHome() {
  if (S.running) return;
  stopVoice(); if ($('#sheet-dossier').open) closeSheet('sheet-dossier');
  S.book = null; S.input = null; S.trace = []; S.calls = []; S.tools = 0; S.plan = 'qloo'; S.liveTop = null; S.heat = null; setActPhoto(null); $('#actId').hidden = true; S.validated = false; S.posterArt = null; S.posterFull = false; S.posterBand = false; S.posterDir = null; S.act = null; updateValidate();
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  clearPending();
  const v = $('#view-plan'); v.dataset.state = 'empty';
  $('#summary').innerHTML = S.homeSummary;
  $('#stats').hidden = true; $('#planToggle').hidden = true; $('#planError').hidden = true; $('#live').hidden = true;
  $('#agentEmpty').hidden = false; $('#agentBody').hidden = true; $('#runlog').innerHTML = '';
  if ($('#mapwrap').classList.contains('is-expanded')) setMapExpanded(false);
  drawBaseMap();
  S.map?.fitBounds(US, { padding: mapPadding(), duration: reduceMotion() ? 0 : 700 });
  history.replaceState(null, '', `${location.pathname}${LANG === 'fr' ? '?lang=fr' : ''}`);
  setView('plan');
  updateToolbar();
  scrollTo({ top: 0, behavior: 'auto' }); requestAnimationFrame(() => scrollTo({ top: 0, behavior: 'auto' }));
}

function failRun(title, msg, { keepPending = false } = {}) {
  S.running = false; S.es = null; if (!keepPending) clearPending();
  setBusy(false);
  $('#live').hidden = true; clearInterval(S.liveTimer);
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
  lvStage(stage);
}
// Live stage list: the stage being worked on is open and shows each action as it happens; finished stages fold
// into a one-line summary and reopen on tap.
function lvStage(stage) {
  let passed = true;
  $$('#lvStages .lv-stage').forEach((li) => {
    const was = li.classList.contains('is-active');
    const now = li.dataset.stage === stage;
    li.classList.toggle('is-active', now); li.classList.toggle('is-done', passed && !now);
    if (now) { passed = false; li.querySelector('details').open = true; }
    else if (was) li.querySelector('details').open = false;
  });
}
function lvSum(li) {
  const lines = $$('.lv-line', li); const req = lines.reduce((s, x) => s + Number(x.dataset.req || 0), 0);
  li.querySelector('.lv-sum').textContent = lines.length ? `${plural(lines.length, 'action')} · ${plural(req, 'request')}` : '';
}
function lvLine(d, phase) {
  if (phase === 'start') {
    const st = $(`#lvStages .lv-stage[data-stage="${CSS.escape(d.stage || '')}"]`) || $('#lvStages .lv-stage.is-active');
    if (!st) return;
    const li = document.createElement('li'); li.className = 'lv-line is-running'; li.dataset.id = d.id || ''; li.dataset.req = '0';
    li.innerHTML = `<span class="lv-state" aria-hidden="true">${icon('i-check')}</span><span class="lv-text">${esc(toolPhrase(d))}</span><em></em>`;
    st.querySelector('.lv-lines').append(li); lvSum(st);
    S.lvCur = li;
    spring(li, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' });
    return;
  }
  const li = $(`#lvStages .lv-line[data-id="${CSS.escape(d.id || '')}"]`) || S.lvCur; if (!li) return;
  li.classList.remove('is-running'); if (phase === 'error') li.classList.add('is-err');
}
function lvCall(d) {
  const li = S.lvCur; if (!li) return;
  li.dataset.req = String(Number(li.dataset.req) + 1);
  li.querySelector('em').textContent = plural(Number(li.dataset.req), 'request');
  lvSum(li.closest('.lv-stage'));
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
// The sentence under the progress bar: what the agent is doing now, swapped with a short slide.
function setLiveOpen(open) { $('#live').classList.toggle('is-open', open); $('#liveToggle').setAttribute('aria-expanded', String(open)); }
function setNow(text) {
  const box = $('#liveNow'); if (!box || !text || box.dataset.text === text) return;
  box.dataset.text = text;
  [...box.children].forEach((c) => { if (c.classList.contains('is-out')) return; c.classList.add('is-out'); setTimeout(() => c.remove(), 320); });
  const span = document.createElement('span'); span.textContent = text; box.append(span);
  spring(span, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' });
}
// Readable names for the Qloo requests in the live feed (the Agent tab keeps the exact paths).
const TYPE_WORD = { artist: 'Artists', place: 'Places', brand: 'Brands', podcast: 'Podcasts', tv_show: 'TV shows', movie: 'Films', person: 'People', book: 'Books', videogame: 'Games' };
function callKind(d) {
  const ft = String(d.params?.['filter.type'] || '');
  if (/search/.test(d.path)) return t('Search');
  if (/compare/.test(d.path)) return t('Overlap');
  if (/trending/.test(d.path)) return t('Trend');
  if (ft === 'urn:heatmap') return t('Fan heat');
  if (ft === 'urn:demographics') return t('Audience');
  return t(TYPE_WORD[ft.replace('urn:entity:', '')] || 'Insights');
}
function callWhat(d) {
  const ft = String(d.params?.['filter.type'] || '');
  const city = S.cities?.[S.curCityId]?.name;
  if (/search/.test(d.path)) return d.params?.query ? `« ${d.params.query} »` : t('taste graph');
  if (/compare/.test(d.path)) return t('shared taste with the headliner');
  if (ft === 'urn:heatmap') return t('fan density, nationwide');
  if (ft === 'urn:demographics') return t('age and gender segments');
  if (/trending/.test(d.path)) return t('last six months');
  return d.params?.['signal.location.query'] || d.params?.['filter.location.query'] || (S.liveTop ? city : '') || t('taste affinity');
}
// Map while the dates are prepared: the city being worked on pulses, a finished city is ticked and the route grows.
const CITY_TASKS = 5; // room, after-show, crowd brief, opener, sponsor
function cityWork(d, phase) {
  const id = d.args?.city_id; if (!id || !S.map) return;
  const el = S.markers.map((m) => m.getElement()).find((x) => x.dataset.id === id);
  if (phase === 'start') {
    S.curCityId = id;
    S.markers.forEach((m) => m.getElement().classList.remove('is-working'));
    el?.classList.add('is-working');
    setMapTitle(`<span class="live-dot"></span>${esc(toolPhrase(d))}`);
    return;
  }
  const n = (S.cityWork[id] = (S.cityWork[id] || 0) + 1);
  if (n >= CITY_TASKS && !S.readyIds.includes(id)) {
    S.readyIds.push(id); el?.classList.add('is-ready'); el?.classList.remove('is-working');
    const order = (S.liveTop || []).map((m) => m.id).filter((x) => S.readyIds.includes(x));
    const coords = order.map((x) => S.cities[x]).filter(Boolean).map((c) => [c.lng, c.lat]);
    S.map.getSource('route')?.setData({ type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] : [] });
    setMapTitle(`<span class="live-dot"></span>${t('{n} of {m} dates ready', { n: S.readyIds.length, m: (S.liveTop || []).length })}`);
  }
}

// ---------------- agent view (full run log) ----------------
function resetAgentView() {
  $('#agentEmpty').hidden = true; $('#agentBody').hidden = false;
  $('#runlog').innerHTML = '';
  $('#agentSummary').innerHTML = `<strong>${t('The agent is planning {artist}.', { artist: esc(S.input.artist) })}</strong> <span class="muted">${t('Each tool call and each Qloo request appears below as it happens.')}</span>`;
  $('#agentStats').innerHTML = ''; $('#usage').innerHTML = ''; $('#usageFoot').textContent = ''; $('#guards').innerHTML = ''; $('#logMeta').textContent = '';
}
// 30 Oct: the run log is a timeline grouped by stage; each tool is one readable line whose details open on tap.
function agentGroup(stage) {
  const log = $('#runlog'); const key = stage || 'Notes';
  let g = log.querySelector(`.tl-stage[data-stage="${CSS.escape(key)}"]`);
  if (!g) {
    g = document.createElement('li'); g.className = 'tl-stage is-live'; g.dataset.stage = key;
    const n = log.querySelectorAll('.tl-stage').length + 1;
    g.innerHTML = `<div class="tl-head"><span class="tl-n">${n}</span><b>${esc(t(key))}</b><span class="tl-sum"></span></div><ol class="tl-items"></ol>`;
    log.append(g);
    log.querySelectorAll('.tl-stage.is-live').forEach((x) => { if (x !== g) x.classList.remove('is-live'); });
  }
  return g;
}
function agentSums() {
  $$('#runlog .tl-stage').forEach((g) => {
    const items = $$('.tl-item', g); const req = items.reduce((s, x) => s + Number(x.dataset.req || 0), 0); const ms = items.reduce((s, x) => s + Number(x.dataset.ms || 0), 0);
    g.querySelector('.tl-sum').textContent = `${plural(items.length, 'tool call')} · ${plural(req, 'request')}${ms ? ` · ${dec((ms / 1000).toFixed(1))} s` : ''}`;
  });
}
function agentLine({ kind, d, text }) {
  const log = $('#runlog');
  // With the scripted planner a thought only repeats the next tool line; a real model's reasoning shows under that tool.
  if (kind === 'thought') { if (S.cfg?.llm?.provider !== 'mock') S.pendingWhy = text; return; }
  if (kind === 'fail') {
    const g = log.lastElementChild?.classList.contains('tl-stage') ? log.lastElementChild : agentGroup('Notes');
    g.querySelector('.tl-items').insertAdjacentHTML('beforeend', `<li class="tl-note${kind === 'fail' ? ' is-err' : ''}">${esc(text)}</li>`);
  } else if (kind === 'tool') {
    const g = agentGroup(d.stage);
    const li = document.createElement('li');
    li.className = 'tl-item is-running'; li.dataset.id = d.id || ''; li.dataset.req = '0'; li.dataset.ms = '0';
    // Console look (owner, 30 Oct): tool name and arguments in small monospace, what it does as a comment, then every Qloo request.
    li.innerHTML = `<details><summary><span class="tl-state" aria-hidden="true">${icon('i-check')}</span><code class="tl-fn">${esc(d.name)}</code><span class="tl-a">${esc(argSummary(d.args))}</span><span class="tl-meta"></span></summary>
      <div class="tl-body"><pre class="tl-args">${esc(JSON.stringify(d.args || {}, null, 2))}</pre></div></details>
      <p class="tl-cmt"># ${esc(S.pendingWhy || toolPhrase(d))}</p><ul class="calls"></ul>`;
    g.querySelector('.tl-items').append(li); S.curTool = li; S.pendingWhy = null;
    spring(li, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' });
  } else if (kind === 'toolerr') {
    const li = $(`#runlog .tl-item[data-id="${CSS.escape(d.id || '')}"]`) || S.curTool;
    if (li) { li.classList.remove('is-running'); li.classList.add('is-err'); li.querySelector('.tl-meta').textContent = t('failed'); li.querySelector('.tl-cmt').insertAdjacentHTML('afterend', `<p class="tl-err">! ${esc(d.error)}</p>`); }
  } else if (kind === 'done') {
    const li = $(`#runlog .tl-item[data-id="${CSS.escape(d.id || '')}"]`);
    if (li) li.classList.remove('is-running');
  } else if (kind === 'call') {
    const ok = d.status === 'ok';
    const ft = d.params?.['filter.type'] ? ` · ${d.params['filter.type']}` : '';
    const html = `<li class="${ok ? '' : 'is-err'}" title="${esc(Object.entries(d.params || {}).map(([k, v]) => `${k}=${v}`).join('\n'))}"><span class="verb">${ok ? 'GET' : esc(String(d.status).toUpperCase())}</span><span>${esc(d.path)}${esc(ft)}${ok ? '' : ` · ${esc(d.error || d.problems?.join(' '))}`}</span><em>${d.ms ?? ''} ms${d.cache && !['miss', 'mock'].includes(d.cache) ? ` · ${esc(d.cache)}` : ''}</em></li>`;
    const li = S.curTool;
    if (li) {
      li.querySelector('.calls').insertAdjacentHTML('beforeend', html);
      li.dataset.req = String(Number(li.dataset.req) + 1); li.dataset.ms = String(Number(li.dataset.ms) + Number(d.ms || 0));
      li.querySelector('.tl-meta').textContent = `${li.dataset.ms} ms`;
    }
  }
  agentSums();
  $('#logMeta').textContent = `${plural(S.tools, 'tool call')} · ${plural(S.calls.length, 'request')}`;
}
function renderAgentFinal() {
  const b = S.book;
  const rejected = S.calls.filter((c) => c.status === 'rejected').length;
  const endpoints = new Set(S.calls.map((c) => c.path));
  const types = new Set(S.calls.map((c) => c.params?.['filter.type']).filter(Boolean));
  $('#agentSummary').innerHTML = `<strong>${t('Every fact in the plan traces back to one of these Qloo answers.')}</strong> ${rejected ? t('{n} rejected by the parameter validator.', { n: rejected }) : t('None was rejected by the parameter validator.')} <span class="muted">${b.meta.ms < 1000 ? t('Replayed from cached Qloo answers.') : t('Planned in {s} s.', { s: dec((b.meta.ms / 1000).toFixed(1)) })}</span>`;
  $$('#runlog .tl-stage').forEach((g) => g.classList.remove('is-live')); $$('#runlog .tl-item.is-running').forEach((x) => x.classList.remove('is-running'));
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
  $('#live').hidden = true; clearInterval(S.liveTimer);
  if (!b?.markets) {
    failRun(t('No market ranking came back'), t('The agent could not resolve this act. Add three sound-alike acts and try again.'));
    return;
  }
  const view = $('#view-plan');
  view.dataset.state = 'ready';
  if (b.artist?.selected) showActId(b.artist.selected, b.artist.candidates || []);
  updateSaveBtn();
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
  { // the headline stays; the detail sentence is wrapped so a phone can drop it (the four figures say the same)
    const sm = $('#summary'); const strong = sm.querySelector('strong');
    if (strong) { const rest = document.createElement('span'); rest.className = 'sum-rest'; while (strong.nextSibling) rest.appendChild(strong.nextSibling); sm.appendChild(rest); }
  }
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
  S.askKeep = false; S.askProposal = null; S.askUndo = null; renderAsk(); setTab(S.tab || 'dates');
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

// ---------------- result tabs (30 Oct): one panel at a time under the map ----------------
function setTab(name, focus = false) {
  S.tab = name;
  $$('#resultTabs [role="tab"]').forEach((b) => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); });
  $$('.result-panel').forEach((p) => {
    const on = p.dataset.panel === name;
    if (on && p.hidden) { p.hidden = false; spring(p, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { preset: 'smooth', fill: 'none' }); }
    else if (!on) p.hidden = true;
  });
}
function bindTabs() {
  const bar = $('#resultTabs'); if (!bar) return;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]'); if (!b) return;
    setTab(b.dataset.tab);
    // Always land on the top of the new panel, right under the sticky tab bar (never in its middle).
    const panel = $(`.result-panel[data-panel="${b.dataset.tab}"]`); if (!panel) return;
    const gap = panel.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 10;
    if (gap < 0 || bar.getBoundingClientRect().top > innerHeight * 0.6) scrollBy({ top: gap, behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
  bar.addEventListener('keydown', (e) => {
    const tabs = $$('#resultTabs [role="tab"]'); const i = tabs.findIndex((b) => b.dataset.tab === S.tab);
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (j == null) return; e.preventDefault(); setTab(tabs[(j + tabs.length) % tabs.length].dataset.tab, true);
  });
  // The tab bar sticks right under the toolbar, whatever the toolbar's height (phone title row, safe area).
  const tb = $('#toolbar'); const sync = () => document.documentElement.style.setProperty('--tb-h', `${tb.offsetHeight}px`);
  sync(); if (window.ResizeObserver) new ResizeObserver(sync).observe(tb);
}

// ---------------- Ask Tourbook: one follow-up change, checked by the server ----------------
const askPlan = () => {
  const b = S.book;
  const entityIds = [b.artist?.selected?.id, ...(b.proxies || []).map((p) => p?.selected?.id)].filter(Boolean);
  const scores = Object.fromEntries(b.markets.all.map((m) => [m.id, { hms: m.hms, affinityRank: m.affinityRank, popRank: m.popRank, hidden: m.hidden }]));
  return { entityIds, entityType: b.artist?.selected?.type, tour: b.markets.top.map((m) => m.id), scores };
};
function renderAsk() {
  const b = S.book; if (!b?.markets) return;
  const tour = new Set(b.markets.top.map((m) => m.id));
  const weakest = [...b.markets.top].sort((x, y) => x.hms - y.hms)[0];
  const bestOut = b.markets.all.find((m) => !tour.has(m.id));
  // Short label on the card, full sentence sent to the agent.
  const sug = [
    { icon: 'swap', label: t('Replace the weakest stop'), q: t('Swap the weakest stop') },
    { icon: 'pin', label: t('A city in the South'), q: t('Swap the weakest stop for somewhere in the South') },
    bestOut && { icon: 'plus', label: t('Add {city}', { city: bestOut.name }), q: t('Add a stop near {city}', { city: bestOut.name }) },
    weakest && { icon: 'minus', label: t('Remove {city}', { city: weakest.name }), q: t('Drop {city}', { city: weakest.name }) },
  ].filter(Boolean);
  const ICON = { swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>', pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>' };
  $('#askChips').innerHTML = sug.map((x) => `<button type="button" class="ask-sug" data-q="${esc(x.q)}"><i class="ask-sug__ic"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${ICON[x.icon]}</svg></i><span>${esc(x.label)}</span></button>`).join('');
  if (!S.askKeep) $('#askResult').innerHTML = '';
}
function askChecks(steps) {
  const out = [];
  for (const st of steps || []) {
    if (st.name === 'find_markets') { const a = st.args || {}; out.push(t('{n} candidates scored{where}', { n: st.result?.candidates?.length ?? 0, where: a.region ? t(' in the {region}', { region: t(a.region[0].toUpperCase() + a.region.slice(1)) }) : a.near_city ? t(' near {city}', { city: S.cities[a.near_city]?.name || a.near_city }) : '' })); }
    if (st.name === 'check_rooms') { const r = st.result || {}; out.push(r.found ? t('{n} rooms in {city} via Qloo, led by {room}', { n: r.found, city: esc(r.city), room: esc(r.rooms?.[0]?.name || '') }) : t('No room found in {city}', { city: esc(r.city || '') })); }
  }
  return [...new Set(out)];
}
function deltaCell(label, a, b, { better = 'up', unit = '' } = {}) {
  const d = Math.round((b - a) * 10) / 10; const good = better === 'up' ? d > 0 : d < 0;
  const cls = d === 0 ? '' : good ? 'is-good' : 'is-bad';
  const fmt = (x) => `${Number(x).toLocaleString(LOCALE)}${unit}`;
  return `<div class="ask-delta-cell"><span>${label}</span><b>${fmt(a)} → ${fmt(b)}</b>${d ? `<em class="${cls}">${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString(LOCALE)}${unit}</em>` : `<em>${t('same')}</em>`}</div>`;
}
let askTicker;
async function ask(question) {
  question = String(question || '').trim(); if (!question || S.asking || !S.book) return;
  S.asking = true; S.askKeep = false; $('#askInput').value = question; $('#askInput').blur(); // closes the phone keyboard
  const btn = $('#askBtn'); btn.disabled = true;
  const phases = [t('Reading the plan’s taste scores'), t('Checking rooms with Qloo'), t('Validating the change')];
  let k = 0;
  const busy = () => `<div class="ask-card is-busy"><div class="ask-card__top"><span class="ask-badge is-busy"><span class="live-dot"></span>${t('Working')}</span><span class="ask-card__q">${esc(question)}</span></div><p class="ask-phase">${phases[k]}…</p><div class="ask-bar"><i style="width:${(k + 1) * 30}%"></i></div></div>`;
  $('#askResult').innerHTML = busy();
  $('#askResult').scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  clearInterval(askTicker); askTicker = setInterval(() => { k = Math.min(phases.length - 1, k + 1); const c = $('#askResult .is-busy'); if (c) c.outerHTML = busy(); }, 4500);
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, lang: LANG, plan: askPlan() }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    (d.calls || []).forEach((c) => S.calls.push(c));
    const p = d.proposal;
    const checks = askChecks(d.steps);
    const nCalls = (d.calls || []).length;
    const proof = `<p class="ask-proof">${icon('i-check')}<span>${[...checks, nCalls ? (nCalls === 1 ? t('1 live Qloo request') : t('{n} live Qloo requests', { n: nCalls })) : t('no new Qloo request needed'), d.by === 'model' ? t('checked by the server') : t('scripted planner, checked by the server')].join(' · ')}</span></p>`;
    if (!p) { $('#askResult').innerHTML = `<div class="ask-card"><div class="ask-card__top"><span class="ask-badge is-warn">${t('No change')}</span><span class="ask-card__q">${esc(question)}</span></div><p class="ask-reason">${t('The agent could not make a valid change: {e}', { e: esc((d.errors || []).join(' ')) })}</p></div>`; return; }
    const city = (id) => esc(S.cities[id]?.name || id); const hms = (id) => S.book.markets.all.find((m) => m.id === id)?.hms;
    const diff = p.holds ? '' : `<div class="ask-diff">${p.remove.map((id) => `<div class="ask-diff__row is-out"><span class="ask-diff__sign">−</span><span class="ask-diff__city">${city(id)}</span><span class="ask-diff__hms">${hms(id)}</span></div>`).join('')}${p.add.map((id) => `<div class="ask-diff__row is-in"><span class="ask-diff__sign">+</span><span class="ask-diff__city">${city(id)}</span><span class="ask-diff__hms">${hms(id)}</span></div>`).join('')}</div>`;
    S.askProposal = p;
    $('#askResult').innerHTML = `<div class="ask-card">
      <div class="ask-card__top"><span class="ask-badge ${p.holds ? 'is-hold' : ''}">${p.holds ? t('The tour holds') : t('Proposal')}</span><span class="ask-card__q">${esc(question)}</span></div>
      ${diff}
      <p class="ask-reason">${esc(p.reason)}</p>
      ${p.holds ? '' : `<div class="ask-delta">${deltaCell(t('Mean score'), p.before.meanHms, p.after.meanHms)}${deltaCell(t('Hidden markets'), p.before.hidden, p.after.hidden)}${deltaCell(t('Route'), p.before.km, p.after.km, { better: 'down', unit: ' km' })}</div>
      <div class="ask-actions"><button class="ui-button ui-button--prominent" type="button" id="askApply">${t('Apply')}</button><button class="ui-button" type="button" id="askDismiss">${t('Keep my tour')}</button></div>`}
      ${proof}
    </div>`;
    spring($('#askResult .ask-card'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { preset: 'smooth', fill: 'none' });
  } catch (e) {
    $('#askResult').innerHTML = `<div class="ask-card"><div class="ask-card__top"><span class="ask-badge is-warn">${t('No change')}</span></div><p class="ask-reason">${t('The agent could not answer: {e}', { e: esc(e.message) })}</p></div>`;
  } finally { clearInterval(askTicker); S.asking = false; btn.disabled = false; }
}
function applyProposal() {
  const p = S.askProposal; const b = S.book; if (!p || !b) return;
  S.askUndo = { top: b.markets.top, route: b.route, comparison: b.comparison };
  const byId = Object.fromEntries(b.markets.all.map((m) => [m.id, m]));
  b.markets.top = p.tour.map((id) => byId[id]).filter(Boolean).sort((x, y) => y.hms - x.hms);
  b.route = p.after.order;
  if (b.baseline) { const base = new Set(b.baseline.cities.map((c) => c.id)); b.comparison = { ...b.comparison, onlyQloo: b.markets.top.filter((m) => !base.has(m.id)).map((m) => m.id), shared: b.markets.top.filter((m) => base.has(m.id)).map((m) => m.id) }; }
  S.askKeep = true; drawMap(); renderCompare(); renderAsk();
  $('#askResult .ask-actions').innerHTML = `<span class="ask-pill is-hold">${t('Applied')}</span><button class="ui-button ui-button--plain" type="button" id="askUndo">${t('Undo')}</button>`;
  $('#mapwrap').scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  toast({ title: t('Tour updated'), detail: t('{n} stops, {km} km. The map shows the new route.', { n: p.after.stops, km: p.after.km.toLocaleString(LOCALE) }), tone: 'ok' });
}
function undoProposal() {
  const u = S.askUndo; if (!u || !S.book) return;
  Object.assign(S.book.markets, { top: u.top }); S.book.route = u.route; S.book.comparison = u.comparison; S.askUndo = null;
  S.askKeep = true; drawMap(); renderCompare(); renderAsk();
  $('#askResult .ask-actions').innerHTML = `<button class="ui-button ui-button--prominent" type="button" id="askApply">${t('Apply')}</button><button class="ui-button" type="button" id="askDismiss">${t('Keep my tour')}</button>`;
}
function bindAsk() {
  $('#askForm')?.addEventListener('submit', (e) => { e.preventDefault(); ask($('#askInput').value); });
  $('#askChips')?.addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) ask(c.dataset.q); });
  // Phones: while the keyboard is up, the floating tab bar and the + button step aside (they would ride above the keyboard).
  const kb = (on) => document.documentElement.classList.toggle('is-typing', on && matchMedia('(pointer: coarse)').matches);
  document.addEventListener('focusin', (e) => { if (e.target.matches('input[type="text"], input[type="search"], textarea')) kb(true); });
  document.addEventListener('focusout', () => setTimeout(() => kb(!!document.activeElement?.matches?.('input[type="text"], input[type="search"], textarea')), 60));
  $('#askResult')?.addEventListener('click', (e) => {
    if (e.target.closest('#askApply')) applyProposal();
    else if (e.target.closest('#askUndo')) undoProposal();
    else if (e.target.closest('#askDismiss')) { S.askProposal = null; $('#askResult').innerHTML = ''; }
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
  const ys0 = (m?.series || []).map((p) => Number(p.percentile)).filter(Number.isFinite);
  const flat = ys0.length && Math.max(...ys0) - Math.min(...ys0) < 0.5 && Math.max(...ys0) <= 1; // Qloo has no weekly signal for this act
  if (!m?.series?.length || flat) { $('#momentum').innerHTML = `<p class="ui-footnote ui-secondary">${t('No trend data for this window. Room sizes fall back to the taste score alone.')}</p>`; return; }
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
  const ink = isDark() ? '#F5F5F7' : '#2C2C2E', glow = isDark() ? '#FF8A4C' : '#EA6A2A'; // route in neutral ink, like the stop badges
  if (!S.map.getLayer('route-glow')) S.map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': glow, 'line-width': 9, 'line-blur': 7, 'line-opacity': isDark() ? 0.55 : 0.35 } });
  if (!S.map.getLayer('route')) S.map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 2.2, 'line-opacity': 0.9 } });
  // The tour pulse: a point that keeps travelling the route, stop to stop.
  if (!S.map.getSource('bus')) S.map.addSource('bus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (!S.map.getLayer('bus-glow')) S.map.addLayer({ id: 'bus-glow', type: 'circle', source: 'bus', paint: { 'circle-radius': 14, 'circle-blur': 1, 'circle-color': glow, 'circle-opacity': 0.7 } });
  if (!S.map.getLayer('bus')) S.map.addLayer({ id: 'bus', type: 'circle', source: 'bus', paint: { 'circle-radius': 4.5, 'circle-color': '#FFFFFF', 'circle-stroke-width': 2, 'circle-stroke-color': glow } });
}
function drawCurrent() { if (S.book?.markets) drawMap(); else if (S.liveTop) drawLiveTop(); else drawBaseMap(); }
function mapPadding() {
  const el = $('#mapwrap'); const w = el?.clientWidth || innerWidth;
  const under = isWide() && !$('#app').classList.contains('is-sidebar-collapsed') ? 284 : 0;
  return w < 560 ? { top: 132, bottom: 110, left: 36, right: 36 } : { top: 96, bottom: 124, left: under + 70, right: 80 };
}
// While the 34 metros are scored (owner, 30 Oct): no sweeping line. Each metro is "read" in turn: it lights up
// and sends out a soft green ping, in a west-to-east cascade with a little natural jitter, and the map title
// counts the metros read so far. It loops until the ranking arrives.
function startScan() {
  if (S.scanTimer || !S.map) return;
  const order = () => S.markers.map((m) => ({ m, k: m.getLngLat().lng + (Math.random() - 0.5) * 6 })).sort((a, b) => a.k - b.k).map((x) => x.m);
  let queue = order(), i = 0, read = 0;
  const total = S.markers.length;
  // the title is set once; only the counter changes (rewriting it on every tick replayed its entrance and made it shake)
  setMapTitle(`<span class="live-dot"></span>${t('Reading taste · {n}/{m} metros', { n: '<b class="scan-n">0</b>', m: total })}`);
  const tick = () => {
    if (!S.markers.length) return;
    if (i >= queue.length) { queue = order(); i = 0; read = 0; }
    const el = queue[i++].getElement();
    el.classList.remove('is-ping'); void el.offsetWidth; el.classList.add('is-ping');
    read++;
    const n = $('#mapTitle .scan-n'); if (n) n.textContent = read;
    S.scanTimer = setTimeout(tick, reduceMotion() ? 260 : 60 + Math.random() * 70);
  };
  tick();
}
function stopScan() {
  clearTimeout(S.scanTimer); S.scanTimer = 0;
  S.markers?.forEach((m) => m.getElement().classList.remove('is-ping'));
}
function clearMarkers() { S.markers.forEach((m) => m.remove()); S.markers = []; S.map?.getSource('route')?.setData({ type: 'FeatureCollection', features: [] }); stopBus(); }
let busAnim;
function stopBus() { cancelAnimationFrame(busAnim); S.map?.getSource('bus')?.setData({ type: 'FeatureCollection', features: [] }); }
/** Sends the tour pulse along the route, forever, at a pace set by the route's length (about 9 s a loop). */
function runBus(coords) {
  stopBus();
  const src = S.map?.getSource('bus'); if (!src || coords.length < 2 || reduceMotion()) return;
  const seg = coords.slice(1).map((c, i) => Math.hypot(c[0] - coords[i][0], c[1] - coords[i][1])); const total = seg.reduce((a, b) => a + b, 0) || 1;
  const loop = 9000, pause = 900; const t0 = performance.now();
  const step = (now) => {
    const t = (now - t0) % (loop + pause); const p = Math.min(1, t / loop); const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    let d = e * total, i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const f = seg[i] ? Math.min(1, d / seg[i]) : 0; const a = coords[i], b = coords[i + 1];
    src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] } });
    busAnim = requestAnimationFrame(step);
  };
  busAnim = requestAnimationFrame(step);
}

// ---- fan heat (30 Oct): where the fans over-index, cell by cell, from the same national heatmap call ----
const heatSrc = () => S.book?.markets?.heat || S.heat || null;
// One heat spot per metro, like a city on the Snap Map (owner, 30 Oct: the raw cells added up into one red sheet).
// Each metro's heat is the strongest Qloo heatmap cell within ~130 km of it, rescaled across the 34 metros, so the
// hottest cities stand out and the others stay faint. The source is still the one national heatmap call.
function heatData() {
  const h = heatSrc(); const cells = h?.cells || []; const cities = S.cfg?.cities || [];
  if (!cells.length || !cities.length) return { type: 'FeatureCollection', features: [] };
  const vals = cities.map((c) => {
    const k = Math.cos((c.lat * Math.PI) / 180); let best = 0;
    for (const [lng, lat, w] of cells) { const dx = (lng - c.lng) * k, dy = lat - c.lat; if (dx * dx + dy * dy < 1.44 && w > best) best = w; }
    return { c, v: best };
  }).filter((x) => x.v > 0);
  const lo = Math.min(...vals.map((x) => x.v)), hi = Math.max(...vals.map((x) => x.v));
  return { type: 'FeatureCollection', features: vals.map(({ c, v }) => ({ type: 'Feature', properties: { w: hi > lo ? 0.12 + 0.88 * ((v - lo) / (hi - lo)) : 1 }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) };
}
function heatPaint(opacity) {
  const dark = isDark();
  return {
    'heatmap-weight': ['interpolate', ['exponential', 1.8], ['get', 'w'], 0, 0, 1, 1],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 6, 2.2, 9, 2],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 30, 4, 40, 6, 76, 9, 150],
    'heatmap-color': dark
      // full spectrum like the Snap Map heatmap (owner's choice, 30 Oct): cool blue edge → teal → green → yellow → orange → red core
      ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(56,189,248,0)', 0.1, 'rgba(56,189,248,0.35)', 0.28, 'rgba(45,212,191,0.55)', 0.45, 'rgba(132,204,22,0.7)', 0.6, '#FACC15', 0.75, '#FB923C', 0.88, '#EF4444', 1, '#DC2626']
      : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(125,211,252,0)', 0.1, 'rgba(125,211,252,0.4)', 0.28, 'rgba(94,234,212,0.55)', 0.45, 'rgba(163,230,53,0.7)', 0.6, '#FDE047', 0.75, '#FB923C', 0.88, '#EF4444', 1, '#DC2626'],
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
  return h && S.plan !== 'llm' ? `<span class="heat-key"><i></i>${t('Fan heat by metro, from {n} areas of one Qloo heatmap call', { n: (h.total || h.cells.length).toLocaleString(LOCALE) })}</span>` : '';
};
// Hide a city label when it would collide with a higher-ranked label or a stop pin (dense Midwest / Northeast).
// Boxes are measured on screen, so the rule holds for any label size or position.
function declutter() {
  if (!S.map) return;
  const items = S.markers.map((mk) => ({ el: mk.getElement() })).filter((x) => x.el.querySelector('.lbl'))
    .sort((a, b) => Number(a.el.dataset.rank || 99) - Number(b.el.dataset.rank || 99));
  const box = (r, pad = 2) => ({ x0: r.left - pad, x1: r.right + pad, y0: r.top - pad, y1: r.bottom + pad });
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const pins = items.map((x) => box(x.el.querySelector('.dot').getBoundingClientRect(), 0));
  // The glass controls on the map are obstacles too (switch, headline, legend, zoom buttons).
  const placed = ['#planToggle', '#mapTitle', '#legend', '.map-controls'].map((q) => $(q)).filter((e) => e && !e.hidden && e.offsetParent)
    .map((e) => box(e.getBoundingClientRect(), 4));
  const frame = $('#mapwrap').getBoundingClientRect();
  for (const { el } of items) {
    el.classList.remove('no-lbl');
    const lbl = el.querySelector('.lbl'); lbl.style.setProperty('--dx', '0px');
    // Keep the label inside the map: it slides sideways, its pointer stays on the pin.
    const r0 = lbl.getBoundingClientRect(); const m = 8;
    const dx = r0.left < frame.left + m ? frame.left + m - r0.left : r0.right > frame.right - m ? frame.right - m - r0.right : 0;
    if (dx) lbl.style.setProperty('--dx', `${Math.round(dx)}px`);
    const b = box(lbl.getBoundingClientRect());
    const own = box(el.querySelector('.dot').getBoundingClientRect(), 0);
    const clash = placed.some((p) => hit(b, p)) || pins.some((p) => p !== own && !(p.x0 === own.x0 && p.y0 === own.y0) && hit(b, p));
    el.classList.toggle('no-lbl', clash);
    if (!clash) placed.push(b);
  }
}
function addMarker(m, { size, bg, label = '', rank = 0, score = null, minor = false, hidden = false, enter = false, delay = 0 }) {
  const el = document.createElement('div');
  el.className = `mk${minor ? ' is-minor' : ' is-stop'}${hidden ? ' is-hidden' : ''}${enter ? ' is-enter' : ''}${rank > 5 ? ' is-rank-far' : ''}`;
  el.style.setProperty('--d', `${delay}ms`); el.style.setProperty('--r', `${size / 2}px`);
  el.dataset.size = size; if (rank) el.dataset.rank = rank; if (m.id) el.dataset.id = m.id;
  el.style.setProperty('--sd', `${Math.round(((m.lng + 125) / 58) * 1800)}ms`);
  const ink = luminance(bg) > 0.55 ? '#1D1D1F' : '#fff';
  const tag = label ? `<div class="lbl">${rank ? `<i>${rank}</i>` : ''}<span>${esc(label)}</span>${score != null ? `<b>${score}</b>` : ''}</div>` : '';
  el.innerHTML = `<div class="dot" style="width:${size}px;height:${size}px;background:${bg}"></div>${tag}`;
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
// One warm orange scale: the stronger the market (Hidden Market Score), the deeper the colour (light mode) or the brighter (dark mode).
// Clean orange, no brown (owner, 30 Oct): light peach for a weaker market, deep vivid orange for a stronger one.
const tasteColor = (h) => { const t = Math.max(0, Math.min(1, (h - 35) / 60)); return isDark() ? mix('#9A3412', '#FF8A4C', t) : mix('#FBC7A4', '#C2410C', t); };
const STOP_INK = '#111111'; // tour stops: black dots with a white ring, like the Snap Map (owner, 30 Oct)
const greyDot = () => (isDark() ? '#636366' : '#AEAEB2');

function drawBaseMap() {
  if (!S.map || !S.cfg) return;
  clearMarkers(); S.routeCoords = null;
  const all = S.cfg.cities; const maxPop = Math.max(...all.map((c) => c.pop));
  const k = $('#mapwrap').clientWidth < 560 ? 0.62 : 1;
  for (const c of all) addMarker(c, { size: Math.round((7 + 15 * Math.sqrt(c.pop / maxPop)) * k), bg: greyDot(), minor: true });
  drawHeat(false);
  $('#legend').innerHTML = `<b>${t('34 US metros')}</b><span class="ui-secondary">${t('Sized by population, the way tours are usually routed.')}${S.running ? ` ${t('Scoring them by taste…')}` : ''}</span>`;
  setMapTitle(S.running ? `<span class="live-dot"></span>${t('Scoring 34 metros by taste')}` : '');
  if (S.running) startScan(); else stopScan();
}
function drawLiveTop() {
  if (!S.map || !S.liveTop) return;
  clearMarkers(); stopScan();
  const top = new Map(S.liveTop.map((m, i) => [m.id, { ...m, rank: i + 1 }]));
  for (const c of S.cfg.cities) {
    const t = top.get(c.id);
    if (!t) addMarker(c, { size: 7, bg: greyDot(), minor: true });
  }
  for (const [id, t] of top) { const c = S.cities[id]; addMarker({ ...c, ...t }, { size: 14, bg: STOP_INK, rank: t.rank, score: t.hms, label: c.name, enter: true, delay: t.rank * 90 }); }
  S.routeCoords = [...top.keys()].map((id) => S.cities[id]).filter(Boolean).map((c) => [c.lng, c.lat]);
  fitTour(true, true);
  declutter();
  setMapTitle(`<span class="live-dot"></span>${t('{n} markets ranked · preparing the dates', { n: S.liveTop.length })}`);
  $('#legend').innerHTML = `<b>${t('Scored by taste')}</b><span class="ui-secondary">${t('The top markets light up as the agent ranks them. Preparing the dates…')}</span>${heatLegend()}`;
}
let routeAnim;
function drawMap() {
  if (!S.map || !S.book?.markets) return;
  clearMarkers(); stopScan();
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
    const size = Math.round((qloo ? 12 + 9 * ((m.affinity - lo) / Math.max(0.001, hi - lo)) : 11 + 11 * Math.sqrt(m.pop / maxPop)) * k);
    addMarker(m, { size, bg: qloo ? STOP_INK : (isDark() ? '#8E8E93' : '#636366'), rank, score: qloo ? m.hms : null, label: m.name, hidden: qloo && m.hidden, enter: true, delay: rank * 90 });
  }
  $('#legend').innerHTML = qloo
    ? `<b>${t('Fan heat')}</b><div class="ramp is-heat"></div><div class="ends"><span>${t('fewer fans')}</span><span>${t('more fans')}</span></div><span class="ui-secondary">${t('Black dots are the tour stops, numbered in order, with their Hidden Market Score. A breathing halo marks a hidden market.')}</span>${heatLegend()}`
    : `<b>${t('Without Qloo')}</b><div class="ramp is-pop"></div><div class="ends"><span>${t('Population')}</span><span>${t('bigger')}</span></div><span class="ui-secondary">${t('What a model without taste data proposes.')}</span>`;
  const coords = routeIds.map((id) => S.cities[id]).filter(Boolean).map((c) => [c.lng, c.lat]);
  S.routeCoords = coords;
  const hiddenN = qloo ? b.markets.top.filter((m) => m.hidden).length : 0;
  setMapTitle(qloo
    ? `<b>${t('{n} stops', { n: coords.length })}</b><span>${t('{n} hidden markets', { n: hiddenN })}</span><span>${kmOf(coords).toLocaleString(LOCALE)} km</span>`
    : `<b>${t('Without Qloo')}</b><span>${t('{n} stops by population', { n: coords.length })}</span><span>${kmOf(coords).toLocaleString(LOCALE)} km</span>`);
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
    if (p < segs) routeAnim = requestAnimationFrame(step); else runBus(coords);
  };
  routeAnim = requestAnimationFrame(step);
}
// The map's own headline: what the map is doing now, then what the tour is.
function setMapTitle(html) { const el = $('#mapTitle'); if (!el) return; el.hidden = !html; if (html && el.innerHTML !== html) { el.innerHTML = html; el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in'); } }
const kmOf = (cs) => { let km = 0; for (let i = 1; i < cs.length; i++) { const [a, b] = [cs[i - 1], cs[i]]; const r = Math.PI / 180; const x = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2; km += 12742 * Math.asin(Math.sqrt(x)); } return Math.round(km); };
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
// 30 Oct: a venue thinks in capacity, not in a popularity index, so the room size sets Qloo's popularity cap.
// Live affinities for one neighbourhood are all ~0.999, so a "fit" bar would read 100 for everyone: what matters is
// Qloo's local order crossed with popularity. "Before they blow up" = top half locally AND below the list's median popularity.
const HOOD_CITY = { 'Lower East Side': 'New York', 'Wicker Park': 'Chicago', 'Silver Lake': 'Los Angeles', 'East Austin': 'Austin' };
function hoodParts(n) { const [name, city] = String(n).split(/,\s*/); return [name, city || HOOD_CITY[name] || '']; }
const actDesc = (a) => { const d = a.genres?.length ? a.genres.join(' · ') : String(a.description || '').replace(/\s*\(synthetic\)\s*$/i, '').trim(); return d && !/^(artist|musician)$/i.test(d) ? `<span class="act-desc">${esc(d)}</span>` : ''; };
const SIZE_LABEL = { '0.5': 'Club', '0.7': 'Mid-size', '0.9': 'Hall' };
function drawRoomMap(loc) {
  const ll = loc?.location; const hero = $('#roomHero');
  if (!ll || !window.maplibregl) { hero.hidden = true; return; }
  hero.hidden = false;
  const parts = String(loc.disambiguation || '').split(/,\s*/);
  $('#roomName').textContent = loc.name || parts[0];
  $('#roomWhere').textContent = [parts.find((p, i) => i > 0 && !/Town$|Township|County|United States/.test(p) && p !== loc.name), parts.at(-2)].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', ');
  const center = [ll.lon, ll.lat];
  if (!S.roomMap) {
    try {
      S.roomMap = new maplibregl.Map({ container: 'roomMap', style: STYLE(), center, zoom: 13.2, interactive: false, attributionControl: false, ...(LANG === 'fr' ? { locale: MAP_LOCALE_FR } : {}) });
      const el = document.createElement('div'); el.className = 'room-pin'; el.innerHTML = '<i></i><i></i><span></span>';
      S.roomPin = new maplibregl.Marker({ element: el }).setLngLat(center).addTo(S.roomMap);
    } catch { hero.hidden = true; }
  } else {
    S.roomPin.setLngLat(center);
    S.roomMap.flyTo({ center, zoom: 13.2, duration: reduceMotion() ? 0 : 1600, essential: true });
  }
}
function fameLadder(acts, cap) {
  // dots on a 0–1 popularity line, stacked in rows so close values never overlap
  const rows = [];
  const dots = [...acts].map((a, i) => ({ a, i })).sort((x, y) => x.a.popularity - y.a.popularity).map((d) => {
    const x = Math.max(0, Math.min(1, d.a.popularity || 0));
    let r = rows.findIndex((last) => x - last >= 0.075); if (r < 0) { r = rows.length; rows.push(x); } else rows[r] = x;
    return `<button type="button" class="fd${d.a.rising ? ' is-rising' : ''}" style="--x:${(x * 100).toFixed(1)}%;--r:${r}" data-act="${d.i}" aria-label="${esc(d.a.name)}, ${t('popularity')} ${pct(d.a.popularity)}">${d.i + 1}</button>`;
  });
  return `<div class="fame" style="--rows:${Math.max(1, rows.length)}">
    <div class="fame-head"><b>${t('Fame ladder')}</b><span>${t(SIZE_LABEL[String(cap)] || 'Mid-size')} · ${t('cap')} ${dec(cap.toFixed(2))}</span></div>
    <div class="fame-track"><div class="fame-band" style="width:${cap * 100}%"></div>${dots.join('')}</div>
    <div class="fame-axis"><span>${t('Emerging')}</span><span>${t('Mainstream')}</span></div>
    <div class="fame-key"><span><i class="is-rising"></i>${t('Book early')}</span><span><i></i>${t('Other acts that fit')}</span></div></div>`;
}
async function venueSearch() {
  if (S.venueBusy) return; // one request per click (UB-31)
  const hood = $('#vHood').value.trim();
  if (!hood) { $('#vHood').setAttribute('aria-invalid', 'true'); $('#vHoodErr').hidden = false; $('#vHood').focus(); return; }
  $('#vHood').blur();
  S.venueBusy = true; S.venueDone = true; $('#venueBtn').disabled = true; $('#venueForm').classList.add('is-busy');
  $$('#hoodChips [data-hood]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.hood === hood)));
  const box = $('#venueResults');
  box.innerHTML = `<div class="room-loading"><span class="room-loading__dot"></span>${t('Reading the taste around {hood}…', { hood: esc(hoodParts(hood)[0]) })}</div><div class="skel-rows" aria-label="${t('Loading acts')}">${Array.from({ length: 5 }, (_, i) => `<div class="skel-row"><div class="ui-skeleton" style="width:${40 + ((i * 17) % 35)}%;height:15px"></div><div class="ui-skeleton" style="height:15px"></div><div class="ui-skeleton" style="width:${55 + ((i * 11) % 30)}%;height:11px"></div></div>`).join('')}</div>`;
  const cap = Number($('#vPop').value);
  try {
    const res = await fetch(`/api/venue?neighborhood=${encodeURIComponent(hood)}&popMax=${cap}`);
    const r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || r.error) throw Object.assign(new Error(r.error || `HTTP ${res.status}`), { status: res.status });
    drawRoomMap(r.resolvedLocality);
    const mock = S.cfg.qloo.mode !== 'live';
    const c = r.calls?.[0];
    const acts = r.acts.map((a) => ({ ...a }));
    const pops = acts.map((a) => a.popularity).sort((x, y) => x - y); const medPop = pops[Math.floor(pops.length / 2)] ?? 0;
    acts.forEach((a, i) => { a.rising = i < Math.ceil(acts.length / 2) && a.popularity <= medPop; });
    S.venueActs = acts;
    if (acts.length) logRoom({ hood, cap, n: acts.length, top: acts[0]?.name || '', at: Date.now() });
    const rising = acts.filter((a) => a.rising).length;
    const wide = r.widenedTo ? `<div class="room-wide">${icon('i-info')}<span>${t('Not enough local signal in {hood} yet: these are the acts for {city}.', { hood: esc(hoodParts(hood)[0]), city: esc(r.widenedTo) })}</span></div>` : '';
    box.innerHTML = acts.length
      ? `${wide}<div class="room-stats"><div><b>${acts.length}</b><span>${t('acts that fit')}</span></div><div><b>${rising}</b><span>${t('to book early')}</span></div><div><b>${dec(cap.toFixed(2))}</b><span>${t('popularity cap')}</span></div></div>
        ${fameLadder(acts, cap)}
        <ol class="act-list">${acts.map((a, i) => `<li class="act${a.rising ? ' is-rising' : ''}" data-act-row="${i}" style="--i:${i}">
          <span class="act-rank">${i + 1}</span>
          <div class="act-body"><b class="act-name">${esc(a.name)}</b>${actDesc(a)}
            <div class="act-meta"><span class="act-pop" aria-hidden="true"><i style="width:${pct(a.popularity)}%"></i></span><span class="act-popn">${t('popularity')} ${pct(a.popularity)}</span>${a.rising ? `<span class="act-tag">${t('Book early')}</span>` : ''}</div></div>
          <button type="button" class="act-tour" data-plan-act="${i}" aria-label="${t('Plan a tour for {name}', { name: esc(a.name) })}">${icon('i-route')}<span>${t('Plan tour')}</span></button></li>`).join('')}</ol>
        <p class="room-foot">${mock ? `${t('Synthetic data.')} ` : ''}${t('Order is Qloo’s local taste ranking for {hood}. “Book early”: top half locally and below the median popularity. Room size sets the popularity cap (Club 0.50, Mid-size 0.70, Hall 0.90).', { hood: esc(hood) })}${c ? ` <code>GET ${esc(c.path)} · ${esc(Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(' & '))}</code>` : ''}</p>`
      : `<div class="ui-empty"><span class="ui-empty__icon">${icon('i-room')}</span><h3>${t('No acts small enough here')}</h3><p>${t('Pick a bigger room, or try a wider area such as the city name.')}</p></div>`;
    spring(box, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' });
  } catch (e) {
    const unknown = e.status === 400;
    $('#roomHero').hidden = true;
    box.innerHTML = `<div class="ui-banner ui-banner--${unknown ? 'warn' : 'critical'}">${icon('i-alert')}<div style="flex:1"><strong>${unknown ? t('Qloo could not place “{hood}”', { hood: esc(hood) }) : t('Room mode is unavailable right now')}</strong><p>${unknown ? t('Add the city, for example “Wicker Park, Chicago”.') : t('{error}. Try again in a moment.', { error: esc(e.message) })}</p></div></div>`;
  } finally {
    S.venueBusy = false; $('#venueBtn').disabled = false; $('#venueForm').classList.remove('is-busy');
  }
}
function bindRooms() {
  $('#venueResults').addEventListener('click', (e) => {
    const go = e.target.closest('[data-plan-act]');
    if (go) { const a = S.venueActs?.[Number(go.dataset.planAct)]; if (a) run({ artist: a.name, proxies: [], type: 'artist' }); return; }
    const dot = e.target.closest('[data-act]');
    if (dot) {
      const row = $(`#venueResults [data-act-row="${dot.dataset.act}"]`);
      row?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      row?.classList.remove('is-flash'); void row?.offsetWidth; row?.classList.add('is-flash');
    }
  });
}

// The act's real photo (Qloo) next to its name, as soon as the agent has found it: "yes, that's them".
function setActPhoto(id, name = '') {
  const img = $('#tbAvatar'); if (!img) return;
  S.actPhoto = id || null;
  if (!id) { img.hidden = true; img.removeAttribute('src'); $('#toolbar').classList.remove('has-avatar'); return; }
  img.alt = name; img.onload = () => { img.hidden = false; $('#toolbar').classList.add('has-avatar'); spring(img, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { preset: 'quick', fill: 'none' }); };
  img.onerror = () => { img.hidden = true; };
  img.src = `/api/photo/${id}`;
}
// Identity card under the name: who this act is, so a homonym shows at once; "Not them?" lists the other matches.
const yearsOld = (d) => { const b = new Date(d); if (Number.isNaN(+b)) return null; const n = new Date(); return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0); };
function actFacts(a) {
  const f = [];
  if (a.group === true) f.push(t('Band')); else if (a.group === false || a.born) f.push(t('Solo'));
  if (a.born) { const y = yearsOld(a.born); if (y) f.push(t('{n} years old', { n: y })); }
  else if (a.since) f.push(t('Active since {y}', { y: a.since }));
  if (a.from) f.push(String(a.from).split(',')[0]);
  const g = (a.genreTags || []).map((x) => String(x.name || x)).map((x) => (/^urn:/.test(x) ? x.split(':').pop().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : x)).filter(Boolean).slice(0, 2); if (g.length) f.push(g.join(', '));
  return f;
}
function showActId(sel, cands) {
  if (sel.photo) setActPhoto(sel.photo, sel.name);
  const box = $('#actId');
  const facts = actFacts(sel);
  const others = (cands || []).filter((c) => c.id !== sel.id);
  S.whoCands = others;
  box.innerHTML = `${facts.length ? `<span class="act-id__facts">${facts.map(esc).join(' · ')}</span>` : ''}${sel.description ? `<span class="act-id__desc">${esc(sel.description)}</span>` : ''}${others.length && !S.running ? `<button class="act-id__who" type="button" id="whoBtn">${t('Not them?')}</button>` : ''}`;
  box.hidden = !box.innerHTML;
}
function openWho() {
  const list = S.whoCands || [];
  $('#whoList').innerHTML = list.map((c, i) => `<li><button type="button" class="who-row" data-who="${i}">${c.photo ? `<img src="/api/photo/${c.photo}" alt="">` : `<span class="who-ph">${icon('i-note')}</span>`}<span class="who-txt"><b>${esc(c.name)}</b><small>${esc([...actFacts(c), c.description].filter(Boolean).join(' · '))}</small></span>${icon('i-chev-r', 'who-chev')}</button></li>`).join('');
  openSheet('sheet-who');
}
function updateAvatar() { const img = $('#tbAvatar'); const show = !!S.actPhoto && S.view === 'plan' && !!(S.running || S.book) && img.complete && img.naturalWidth > 0; img.hidden = !show; $('#toolbar').classList.toggle('has-avatar', show); }

// ---------------- live suggestions in the new-plan form (owner, 30 Oct) ----------------
// As you type, Qloo's matches show with their photo, so a tour never starts on the wrong act. Nothing on Qloo for
// that name: the form says so and points to the three sound-alikes, which have the same live list.
const suggCache = new Map();
function attachSuggest(input, list, { head }) {
  let timer = 0, seq = 0;
  const close = () => { list.hidden = true; list.innerHTML = ''; };
  const row = (c, i) => `<li role="option"><button type="button" class="sugg-row" data-i="${i}">${c.photo ? `<img src="/api/photo/${c.photo}" alt="" loading="lazy">` : `<span class="sugg-ph">${esc((c.name || '?').slice(0, 1))}</span>`}<span class="sugg-txt"><b>${esc(c.name)}</b>${c.description || c.born ? `<small>${esc([c.born ? t('{n} years old', { n: yearsOld(c.born) }) : '', c.description || ''].filter(Boolean).join(' · '))}</small>` : ''}</span></button></li>`;
  input.addEventListener('input', () => {
    const q = input.value.trim(); clearTimeout(timer);
    if (input.dataset.pick && input.dataset.pick !== q) { input.dataset.pick = ''; input.dataset.id = ''; input.closest('.ui-field, .proxies')?.querySelector(`.sugg-ok[data-for="${input.name}"]`)?.remove(); }
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      const type = $('#fType input:checked')?.value || 'artist'; const key = `${type}|${q.toLowerCase()}`; const my = ++seq;
      list.hidden = false; if (!suggCache.has(key)) list.innerHTML = `<li class="sugg-wait"><span class="live-dot"></span>${t('Searching Qloo…')}</li>`;
      let cands = suggCache.get(key);
      if (!cands) {
        try { const r = await fetch(`/api/resolve?q=${encodeURIComponent(q)}&type=${type}`); cands = r.ok ? ((await r.json()).candidates || []).slice(0, 5) : []; } catch { cands = []; }
        suggCache.set(key, cands);
      }
      if (my !== seq || input.value.trim() !== q) return;
      list._cands = cands;
      // Qloo's search is fuzzy: it always returns something. "Found" means a name that really matches what was typed.
      const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const nq = norm(q); const found = cands.some((c) => { const n = norm(c.name); return n.startsWith(nq) || nq.startsWith(n) || (nq.length >= 4 && n.includes(nq)); });
      const none = `<li class="sugg-none">${head ? `<b>${t('Not on Qloo yet')}</b><span>${t('Tourbook can still plan it: add three acts that sound like it below, they stand in for the audience.')}</span><button type="button" class="sugg-go">${t('Add sound-alikes')}</button>` : `<span>${t('No match on Qloo for this name.')}</span>`}</li>`;
      list.innerHTML = found ? cands.map(row).join('') : `${none}${cands.length ? `<li class="sugg-maybe">${t('Close names on Qloo')}</li>${cands.slice(0, 3).map(row).join('')}` : ''}`;
    }, 280);
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('.sugg-go')) { close(); $('#proxyBox')?.classList.add('is-callout'); $('#planForm [name=p1]').focus(); return; }
    const b = e.target.closest('.sugg-row'); if (!b) return;
    const c = list._cands[Number(b.dataset.i)];
    input.value = c.name; input.dataset.pick = c.name; input.dataset.id = c.id;
    close();
    // a confirmation row under the field: photo, name, who it is
    input.parentElement.querySelector(`.sugg-ok[data-for="${input.name}"]`)?.remove();
    input.insertAdjacentHTML('afterend', `<div class="sugg-ok" data-for="${input.name}">${c.photo ? `<img src="/api/photo/${c.photo}" alt="">` : ''}<span>${icon('i-check')}<b>${esc(c.name)}</b>${c.description ? ` · ${esc(c.description)}` : ''}</span></div>`);
    if (head) { $('#proxyBox')?.classList.remove('is-callout'); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement)) close(); }, 200));
}

// ---------------- tour poster (30 Oct) ----------------
// "Validate the tour" opens the poster: the layout (real Qloo photo, cities, route) is drawn at once and costs nothing;
// the AI artwork is painted only when asked, once per tour, then kept by the server.
function updateValidate() {
  const btn = $('#validateBtn'); if (!btn) return;
  btn.querySelector('span').textContent = S.validated ? t('Tour poster') : t('Validate the tour');
  btn.querySelector('use').setAttribute('href', S.validated ? '#i-image' : '#i-check');
  btn.classList.toggle('ui-button--prominent', !S.validated);
  $('#validateNote').textContent = S.validated ? t('Tour validated') : t('Then make its poster');
}
function tourStops() {
  const b = S.book; const top = new Map(b.markets.top.map((m) => [m.id, m]));
  return (b.route?.length ? b.route : b.markets.top.map((m) => m.id)).map((id) => (S.cities[id] ? { ...S.cities[id], hidden: !!top.get(id)?.hidden } : null)).filter(Boolean);
}
async function openPoster() {
  if (!S.book) return;
  S.validated = true; updateValidate(); saveTour({ quiet: true });
  openSheet('sheet-poster');
  const sel = S.book.artist.selected;
  if (!S.act || S.act.key !== sel.id) {
    S.act = null;
    try { const r = await fetch(`/api/act?q=${encodeURIComponent(sel.name)}&id=${encodeURIComponent(sel.id)}&type=${S.input?.type || 'artist'}`); S.act = (await r.json()).act; if (S.act) S.act.key = sel.id; } catch { /* the poster still works without the photo */ }
  }
  $('#posterArtBtn').hidden = !!S.posterArt;
  await drawPoster();
}
const loadImg = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
function coverDraw(x, img, dx, dy, dw, dh) {
  const s = Math.max(dw / img.width, dh / img.height); const w = img.width * s, h = img.height * s;
  x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}
function rrect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
// The most vivid colour of the artwork's middle band becomes the poster's accent (numbers, kicker), so type and art match.
function artAccent(x, W, H) {
  try {
    const d = x.getImageData(0, Math.round(H * 0.3), W, Math.round(H * 0.4)).data; let best = null, bestS = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const r = d[i], g = d[i + 1], b = d[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0; const score = sat * (mx / 255);
      if (mx > 120 && score > bestS) { bestS = score; best = [r, g, b]; }
    }
    if (!best || bestS < 0.25) return null;
    const k = 255 / Math.max(...best); return `rgb(${best.map((v) => Math.min(255, Math.round(v * Math.min(k, 1.35)))).join(',')})`;
  } catch { return null; }
}
// The tour-date block, ticket line and footer, set by the app (always exact), in the poster's accent colour.
function drawDateBlock(x, W, H, stops, font, accent) {
  const top = Math.round(H * 0.665);
  // a near-solid band in the poster's own darkest tone, so the block is always clean even if the art strays into it
  let base = [10, 10, 12];
  try { const d = x.getImageData(0, top, W, H - top).data; let best = 1e9; for (let i = 0; i < d.length; i += 4 * 211) { const l = d[i] + d[i + 1] + d[i + 2]; if (l < best) { best = l; base = [d[i], d[i + 1], d[i + 2]]; } } } catch { /* keep black */ }
  base = base.map((v) => Math.round(v * 0.55));
  const rgb = (a) => `rgba(${base.join(',')},${a})`;
  const g = x.createLinearGradient(0, top - 120, 0, top - 40); g.addColorStop(0, rgb(0)); g.addColorStop(1, rgb(1));
  x.fillStyle = g; x.fillRect(0, top - 120, W, 80); x.fillStyle = rgb(1); x.fillRect(0, top - 40, W, H - top + 40);
  const caps = /upper|caps|capital/i.test(S.posterDir?.typography || '');
  const cond = /condens|compress|narrow/i.test(S.posterDir?.typography || '');
  // numbers and ticket line: the art's accent, lifted until it reads on the dark band
  let ac = '#FFFFFF';
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(accent || '');
  if (m) { let c = m.slice(1).map(Number); for (let k = 0; k < 6 && (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 150; k++) c = c.map((v) => Math.round(v + (255 - v) * 0.3)); ac = `rgb(${c.join(',')})`; }
  const dates = (S.book?.dates || []);
  const rows = stops.map((s, i) => { const v = dates.find((d) => d.market?.id === s.id)?.venue?.picks?.[0]?.name; return { n: String(i + 1).padStart(2, '0'), city: `${s.name}, ${s.state}`, venue: v || '' }; });
  const two = rows.length > 5; const per = two ? Math.ceil(rows.length / 2) : rows.length;
  const L = 64, R = W - 64, colW = two ? (R - L - 40) / 2 : R - L;
  // the tour label, large, at the top of the band (set by the app so it is never cut or misspelled)
  const lab = t('North American tour').toUpperCase(); let ls = 64; x.font = `800 ${ls}px ${font}`;
  while (x.measureText(lab).width > R - L && ls > 30) { ls -= 2; x.font = `800 ${ls}px ${font}`; }
  x.fillStyle = '#FFFFFF'; x.textBaseline = 'alphabetic'; x.fillText(lab, L, top + 6 + ls * 0.8);
  const listTop = top + 6 + ls + 30;
  const avail = H - 150 - listTop; const rowH = Math.min(two ? 56 : 64, avail / per);
  const citySize = Math.round(Math.min(two ? 28 : 34, rowH * 0.52)); const venueSize = Math.round(citySize * 0.62);
  x.textBaseline = 'alphabetic';
  rows.forEach((row, i) => {
    const col = two && i >= per ? 1 : 0; const X = L + col * (colW + 40); const Y = listTop + (i - col * per) * rowH + citySize;
    x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(X, Y - citySize - 10); x.lineTo(X + colW, Y - citySize - 10); x.stroke();
    x.fillStyle = ac; x.font = `700 ${Math.round(citySize * 0.72)}px ${font}`; x.fillText(row.n, X, Y);
    const cx = X + citySize * 1.55;
    x.fillStyle = '#FFFFFF'; x.font = `${cond ? 700 : 600} ${citySize}px ${font}`;
    const city = caps ? row.city.toUpperCase() : row.city; x.fillText(city, cx, Y);
    if (row.venue) {
      const w = x.measureText(city).width; x.font = `500 ${venueSize}px ${font}`; x.fillStyle = 'rgba(255,255,255,.62)';
      let v = row.venue; const room = X + colW - (cx + w + 16);
      while (v.length > 3 && x.measureText(`· ${v}`).width > room) v = `${v.slice(0, -2)}…`;
      if (room > 60) x.fillText(`· ${v}`, cx + w + 12, Y);
    }
  });
  x.font = `700 30px ${font}`; x.fillStyle = ac; if ('letterSpacing' in x) x.letterSpacing = '3px';
  x.fillText(t('Tickets soon').toUpperCase(), L, H - 84);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  x.font = `500 22px ${font}`; x.fillStyle = 'rgba(255,255,255,.6)'; const f = t('Routed by taste with Qloo'); x.fillText(f, R - x.measureText(f).width, H - 84);
}
async function drawPoster() {
  const c = $('#posterCanvas'); const W = 1080, H = 1350; const x = c.getContext('2d');
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'system-ui';
  const stops = tourStops(); const name = S.book.artist.selected.name;
  x.clearRect(0, 0, W, H);
  // background: the AI artwork, or a warm dark field until it is made
  let art = null; if (S.posterArt) { try { art = await loadImg(S.posterArt); } catch { art = null; } }
  if (art && S.posterFull) { // the model designed the poster; the app sets the date block in its reserved bottom area
    coverDraw(x, art, 0, 0, W, H);
    if (S.posterBand) drawDateBlock(x, W, H, stops, font, artAccent(x, W, H));
    return;
  }
  let accent = '#FF8A4C';
  if (art) { coverDraw(x, art, 0, 0, W, H); accent = artAccent(x, W, H) || accent; }
  else {
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1A1411'); g.addColorStop(1, '#0B0908'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const r = x.createRadialGradient(W * 0.78, H * 0.22, 0, W * 0.78, H * 0.22, W * 0.9); r.addColorStop(0, 'rgba(226,86,31,.55)'); r.addColorStop(0.55, 'rgba(226,86,31,.12)'); r.addColorStop(1, 'rgba(226,86,31,0)'); x.fillStyle = r; x.fillRect(0, 0, W, H);
  }
  let g = x.createLinearGradient(0, 0, 0, 420); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, 420);
  g = x.createLinearGradient(0, H * 0.3, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,.92)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  if (art) { g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(0.75, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, H * 0.32, W, H * 0.68); } // the type side stays readable on busy art
  // the act's real photo (Qloo), never a generated face
  if (S.act?.photo) {
    try {
      const p = await loadImg(`/api/photo/${S.act.photo}`);
      x.save(); rrect(x, 72, 72, 300, 300, 40); x.clip(); coverDraw(x, p, 72, 72, 300, 300); x.restore();
      x.save(); rrect(x, 72, 72, 300, 300, 40); x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,.85)'; x.stroke(); x.restore();
    } catch { /* no photo: the layout holds without it */ }
  }
  // the route, top right, on its own small projection
  const box = { x: 430, y: 92, w: 578, h: 260 };
  const lng = stops.map((s) => s.lng), lat = stops.map((s) => s.lat);
  const [x0, x1, y0, y1] = [Math.min(...lng), Math.max(...lng), Math.min(...lat), Math.max(...lat)];
  const k = Math.min(box.w / Math.max(1, x1 - x0), box.h / Math.max(1, (y1 - y0) * 1.25));
  const px = (s) => [box.x + box.w / 2 + (s.lng - (x0 + x1) / 2) * k, box.y + box.h / 2 - (s.lat - (y0 + y1) / 2) * k * 1.25];
  x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineJoin = 'round'; x.beginPath();
  stops.forEach((s, i) => { const [X, Y] = px(s); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.stroke();
  stops.forEach((s, i) => { const [X, Y] = px(s); x.beginPath(); x.arc(X, Y, i === 0 ? 13 : 9, 0, Math.PI * 2); x.fillStyle = s.hidden ? accent : '#FFFFFF'; x.fill(); x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke(); });
  // kicker and name
  x.fillStyle = '#FF8A4C'; x.font = `700 30px ${font}`; x.textBaseline = 'alphabetic';
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  let size = 140; x.font = `800 ${size}px ${font}`;
  const words = name.split(' '); let lines = [name];
  while (x.measureText(name).width > W - 144 && size > 96) { size -= 4; x.font = `800 ${size}px ${font}`; }
  if (x.measureText(name).width > W - 144) { const mid = Math.ceil(words.length / 2); lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]; }
  x.font = `700 30px ${font}`; x.fillStyle = accent;
  x.fillText(t('THE TASTE TOUR').toUpperCase(), 72, 600 - size * 0.78 - 26); // above the cap height of the name, never touching it
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  x.font = `800 ${size}px ${font}`; x.fillStyle = '#FFFFFF'; lines.forEach((l, i) => x.fillText(l, 68, 600 + i * size * 0.95));
  // the stops, numbered, in one or two columns
  const yStart = 600 + (lines.length - 1) * size * 0.95 + 96; const two = stops.length > 5;
  const per = two ? Math.ceil(stops.length / 2) : stops.length; const rowH = Math.min(104, (H - 170 - yStart) / per);
  stops.forEach((s, i) => {
    const col = two && i >= per ? 1 : 0; const X = 72 + col * 488; const Y = yStart + (i - col * per) * rowH;
    x.fillStyle = accent; x.font = `700 28px ${font}`; x.fillText(String(i + 1).padStart(2, '0'), X, Y);
    x.fillStyle = '#FFFFFF'; x.font = `600 40px ${font}`; x.fillText(s.name, X + 58, Y);
    const w = x.measureText(s.name).width; x.fillStyle = 'rgba(255,255,255,.55)'; x.font = `500 26px ${font}`; x.fillText(s.state || '', X + 58 + w + 14, Y);
  });
  // footer
  x.fillStyle = 'rgba(255,255,255,.6)'; x.font = `500 24px ${font}`;
  x.fillText(t('Routed by taste with Qloo'), 72, H - 64);
  const hid = stops.filter((s) => s.hidden).length;
  if (hid) { const txt = t('{n} hidden markets', { n: hid }); const w = x.measureText(txt).width; x.beginPath(); x.arc(W - 72 - w - 22, H - 72, 9, 0, Math.PI * 2); x.fillStyle = accent; x.fill(); x.fillStyle = 'rgba(255,255,255,.6)'; x.fillText(txt, W - 72 - w, H - 64); }
}
// While the artwork is painted (owner, 30 Oct): a living dot grid on black, a soft swell drifting through it, and a
// percentage. The percentage is an estimate from the usual generation time; it only passes 95 % when the image is in.
const POSTER_STAGE = {
  start: { from: 1, to: 6, tau: 2, label: 'Starting…' },
  direction: { from: 6, to: 16, tau: 4, label: 'Choosing the art direction…' },
  painting: { from: 16, to: 80, tau: 18, label: 'Composing the poster…' },
  proofreading: { from: 80, to: 95, tau: 4, label: 'Proofreading the text…' },
  repainting: { from: 82, to: 97, tau: 18, label: 'Fixing a word, painting again…' },
  done: { from: 100, to: 100, tau: 1, label: 'Ready' },
};
function startDots() {
  const c = $('#posterDots'); const box = c.parentElement; const dpr = Math.min(2, devicePixelRatio || 1);
  const W = box.clientWidth, H = box.clientHeight; c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const gap = Math.max(11, Math.round(W / 28)); const t0 = performance.now(); S.dotsPct = 0; S.dotsDone = false;
  const frame = (now) => {
    const t = (now - t0) / 1000;
    x.clearRect(0, 0, W, H);
    // two soft swells on slow Lissajous paths
    const b1 = [W * (0.5 + 0.32 * Math.sin(t * 0.55)), H * (0.45 + 0.3 * Math.sin(t * 0.37 + 1))];
    const b2 = [W * (0.5 + 0.3 * Math.cos(t * 0.42 + 2)), H * (0.55 + 0.28 * Math.cos(t * 0.5))];
    const R = Math.max(W, H) * 0.42;
    for (let yy = gap / 2; yy < H; yy += gap) for (let xx = gap / 2; xx < W; xx += gap) {
      const d1 = Math.hypot(xx - b1[0], yy - b1[1]) / R, d2 = Math.hypot(xx - b2[0], yy - b2[1]) / R;
      const v = Math.min(1, Math.exp(-d1 * d1 * 2.2) + 0.7 * Math.exp(-d2 * d2 * 2.6));
      const r = 0.6 + v * gap * 0.28; x.beginPath(); x.arc(xx, yy, r, 0, Math.PI * 2);
      x.fillStyle = `rgba(255,255,255,${0.16 + v * 0.7})`; x.fill();
    }
    if (!S.dotsDone) { // within the real stage, move toward its end; never jump back, never sit still
      const st = POSTER_STAGE[S.posterStage] || POSTER_STAGE.start; const dt = (now - (S.posterStageAt || t0)) / 1000;
      const est = st.from + (st.to - st.from) * (1 - Math.exp(-dt / st.tau));
      S.dotsPct = Math.max(S.dotsPct || 0, Math.min(99, est));
    }
    const pct = Math.round(S.dotsPct); const el = $('#posterPct'); el.textContent = `${pct} %`; el.setAttribute('aria-valuenow', pct);
    S.dotsRaf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(S.dotsRaf); S.dotsRaf = requestAnimationFrame(frame);
}
function stopDots() {
  return new Promise((done) => {
    S.dotsDone = true; const from = S.dotsPct || 0; const t0 = performance.now();
    const fin = (now) => { const k = Math.min(1, (now - t0) / 450); S.dotsPct = from + (100 - from) * k; if (k < 1) requestAnimationFrame(fin); else { setTimeout(() => { cancelAnimationFrame(S.dotsRaf); done(); }, 250); } };
    requestAnimationFrame(fin);
  });
}
async function makePosterArt() {
  const b = S.book; if (!b || S.posterBusy) return;
  S.posterStage = 'start'; S.posterStageAt = performance.now(); $('.poster-row').hidden = true;
  S.posterBusy = true; const btn = $('#posterArtBtn'); btn.disabled = true; const label = btn.querySelector('span').textContent; btn.querySelector('span').textContent = t('Artwork in progress…');
  $('#posterBusy').hidden = false; $('#posterBusyText').textContent = t('Artwork for {name}', { name: b.artist.selected.name }); startDots();
  const themes = [...new Set((b.dates || []).flatMap((d) => (d.crowd_brief?.themes || []).map((x) => x.name)))].slice(0, 8);
  try {
    const r0 = await fetch('/api/poster', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId: b.artist.selected.id, name: b.artist.selected.name, description: b.artist.selected.description || '', kind: S.input?.type || 'artist', genres: S.act?.genres || [], themes, cities: tourStops().map((s) => s.name), stops: tourStops().map((s) => { const v = (b.dates || []).find((d) => d.market?.id === s.id)?.venue?.picks?.[0]?.name; return `${s.name}, ${s.state}${v ? ` · ${v}` : ''}`; }), photo: S.act?.photo || b.artist.selected.photo || null, lang: LANG }) });
    const j0 = await r0.json().catch(() => ({}));
    if (!r0.ok) throw Object.assign(new Error(j0.error || `HTTP ${r0.status}`), { code: j0.code });
    // poll the job: the real stage drives the caption and the percentage
    let j;
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const r = await fetch(`/api/poster/job/${j0.job}`); j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.stage === 'error') throw Object.assign(new Error(j.error), { code: j.code });
      if (j.stage !== S.posterStage) { S.posterStage = j.stage; S.posterStageAt = performance.now() - (j.stageMs || 0); const cap = POSTER_STAGE[j.stage]; if (cap) $('#posterBusyText').textContent = t(cap.label); }
      if (j.stage === 'done') break;
    }
    S.posterArt = j.url; S.posterFull = !!j.full; S.posterBand = !!j.band; S.posterDir = j.direction || null; btn.hidden = true; if (isSaved()) saveTour({ quiet: true });
    await drawPoster();
  } catch (e) {
    toast({ title: e.code === 'no_image_model' ? t('No image model on this server') : t('The artwork could not be made'), detail: e.code === 'no_image_model' ? t('The poster keeps its typographic version.') : t(e.message) });
  } finally { S.posterBusy = false; btn.disabled = false; btn.querySelector('span').textContent = label; await stopDots(); $('#posterBusy').hidden = true; $('.poster-row').hidden = false; S.posterStage = null; }
}
function sharePoster(share) {
  const slug = (S.book?.artist?.selected?.name || 'tour').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  $('#posterCanvas').toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `${slug}-tour-poster.png`, { type: 'image/png' });
    if (share && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: t('{name} tour poster', { name: S.book.artist.selected.name }) }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

window.Tourbook = { S, UI, briefingText, run, startScan, stopScan, startDots, drawPoster }; // handy for debugging in the console
