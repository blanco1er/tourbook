// Qloo client interface + live HTTP implementation.
// Every Qloo call in the app goes through BaseQlooClient.get(), which:
//   1. flattens params (arrays -> comma-separated, as the API expects on GET),
//   2. validates them against the documented allowlist (silently-ignored params are the #1 trap),
//   3. records a provenance event (endpoint, params, ms, cache status) for the "evidence" UI,
//   4. delegates to _request() (HTTP for live, synthetic generator for mock).
import { AsyncLocalStorage } from 'node:async_hooks';
import { validateRequest, QlooParamError } from './validator.js';
import { cacheKey, NoCache } from './cache.js';
import { Limiter } from './limiter.js';

/** Per-run trace context: the agent runner sets { emit(type, data) } here. */
export const traceStore = new AsyncLocalStorage();

let callSeq = 0;

export function flattenParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    const s = Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null && x !== '').join(',') : String(v);
    if (s !== '') out[k] = s;
  }
  return out;
}

export class QlooError extends Error {
  constructor(code, message, { status, retryable = false, details } = {}) {
    super(message); this.name = 'QlooError'; this.code = code; this.status = status; this.retryable = retryable; this.details = details;
  }
}

export class BaseQlooClient {
  constructor({ strictParams = true, mode }) { this.strictParams = strictParams; this.mode = mode; }

  async get(path, params = {}) {
    const flat = flattenParams(params);
    const check = validateRequest(path, flat);
    const id = `q${++callSeq}`;
    const trace = traceStore.getStore();
    if (!check.ok) {
      trace?.emit('call', { id, path, params: flat, status: 'rejected', problems: check.problems });
      if (this.strictParams) throw new QlooParamError(check.problems.join(' '), { path, params: flat });
      console.warn('[qloo] param warning', path, check.problems);
    }
    const t0 = Date.now();
    trace?.emit('call', { id, path, params: flat, status: 'start' });
    try {
      const { body, cache } = await this._request(path, flat);
      const ms = Date.now() - t0;
      trace?.emit('call', { id, path, params: flat, status: 'ok', ms, cache, count: countResults(body) });
      return { body, provenance: { id, method: 'GET', path, params: flat, ms, cache, mode: this.mode } };
    } catch (err) {
      trace?.emit('call', { id, path, params: flat, status: 'error', ms: Date.now() - t0, error: err.message, code: err.code, httpStatus: err.status });
      throw err;
    }
  }

  // ---- Documented calls (thin wrappers; param names are the API's own) ----
  search(params) { return this.get('/search', params); }            // query, types, take
  insights(params) { return this.get('/v2/insights', params); }     // filter.type + signals/filters
  heatmap(params) { return this.insights({ 'filter.type': 'urn:heatmap', ...params }); }
  demographics(params) { return this.insights({ 'filter.type': 'urn:demographics', ...params }); }
  tagInsights(params) { return this.insights({ 'filter.type': 'urn:tag', ...params }); }
  compare(params) { return this.get('/v2/analysis/compare', params); }
  trending(params) { return this.get('/v2/trending', params); }
  tags(params) { return this.get('/v2/tags', params); }
  tagTypes(params = {}) { return this.get('/v2/tags/types', params); }
  audiences(params = {}) { return this.get('/v2/audiences', params); } // deprecated upstream: avoid in core flow
  entities(ids) { return this.get('/entities', { entity_ids: ids }); }

  async _request() { throw new Error('not implemented'); }
}

function countResults(body) {
  const r = body?.results;
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') {
    for (const k of ['entities', 'heatmap', 'demographics', 'tags', 'trending']) if (Array.isArray(r[k])) return r[k].length;
  }
  return undefined;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpQlooClient extends BaseQlooClient {
  #apiKey;
  constructor({ baseUrl, apiKey, cache = new NoCache(), limiter = new Limiter(), timeoutMs = 20000, maxAttempts = 3, strictParams = true }) {
    super({ strictParams, mode: 'live' });
    if (!apiKey) throw new QlooError('QLOO_CONFIGURATION_ERROR', 'QLOO_API_KEY is required for live mode.');
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') throw new QlooError('QLOO_CONFIGURATION_ERROR', 'Qloo base URL must be https.');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.#apiKey = apiKey;
    this.cache = cache; this.limiter = limiter; this.timeoutMs = timeoutMs; this.maxAttempts = maxAttempts;
    this.inflight = new Map();
  }

  async _request(path, params) {
    const key = cacheKey(path, params);
    const hit = await this.cache.get(key);
    if (hit) return { body: hit.body, cache: 'hit' };
    if (this.inflight.has(key)) return { body: await this.inflight.get(key), cache: 'dedup' };
    const p = this.limiter.schedule(() => this.#fetchWithRetry(path, params)).then(async (body) => {
      await this.cache.set(key, { path, params, fetchedAt: new Date().toISOString(), body });
      return body;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return { body: await p, cache: 'miss' };
  }

  async #fetchWithRetry(path, params) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let lastErr;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        // GET only: /v2/insights rejects POST bodies in the hackathon (developer guide).
        const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'X-Api-Key': this.#apiKey }, signal: ctrl.signal });
        const text = await res.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
        if (res.ok) return body;
        const message = body?.message || body?.error || body?.reason || `HTTP ${res.status}`;
        lastErr = new QlooError(codeForStatus(res.status), `${message}`, { status: res.status, retryable: RETRYABLE.has(res.status), details: body });
        if (!RETRYABLE.has(res.status) || attempt === this.maxAttempts) throw lastErr;
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const wait = Math.min(retryAfter ?? backoff(attempt), 30000);
        if (res.status === 429) this.limiter.pause(wait); // slow every caller down, not just this one
        await sleep(wait);
      } catch (err) {
        if (err instanceof QlooError && !err.retryable) throw err;
        if (err instanceof QlooError && attempt === this.maxAttempts) throw err;
        lastErr = err instanceof QlooError ? err : new QlooError(err.name === 'AbortError' ? 'QLOO_TIMEOUT' : 'QLOO_NETWORK_ERROR', err.message, { retryable: true });
        if (attempt === this.maxAttempts) throw lastErr;
        await sleep(backoff(attempt));
      } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }
}

function codeForStatus(s) {
  if (s === 401) return 'QLOO_AUTH';          // wrong host or bad key header
  if (s === 403) return 'QLOO_FORBIDDEN_TYPE'; // unsupported entity type in the hackathon
  if (s === 404) return 'QLOO_NO_PATH';        // wrong path or wrong method
  if (s === 400) return 'QLOO_BAD_REQUEST';    // e.g. signal.location.query found no locality
  if (s === 429) return 'QLOO_RATE_LIMIT';
  return 'QLOO_HTTP_ERROR';
}
function parseRetryAfter(v) {
  if (!v) return undefined;
  const n = Number(v); if (Number.isFinite(n)) return n * 1000;
  const d = Date.parse(v); return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}
function backoff(attempt) { const base = 250 * 2 ** (attempt - 1); return Math.round(base * (0.75 + Math.random() * 0.5)); }
