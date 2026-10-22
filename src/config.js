// Central configuration. Reads process.env, plus an optional local .env file (never committed).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const env = process.env;
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

const qlooKey = env.QLOO_API_KEY?.trim() || '';
const llmKey = env.LLM_API_KEY?.trim() || '';

export const config = {
  port: int(env.PORT, 8787),
  qloo: {
    mode: (env.QLOO_MODE || (qlooKey ? 'live' : 'mock')).toLowerCase(),
    apiKey: qlooKey,
    baseUrl: (env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, ''),
    cacheDir: resolve(process.cwd(), env.QLOO_CACHE_DIR || '.cache/qloo'),
    maxConcurrency: int(env.QLOO_MAX_CONCURRENCY, 4),
    minIntervalMs: int(env.QLOO_MIN_INTERVAL_MS, 150),
    timeoutMs: int(env.QLOO_TIMEOUT_MS, 20000),
    maxAttempts: int(env.QLOO_MAX_ATTEMPTS, 3),
    strictParams: (env.QLOO_STRICT_PARAMS ?? 'true') !== 'false',
    marketStrategy: env.MARKET_STRATEGY || 'auto',
    heatmapBoundary: env.HEATMAP_BOUNDARY || '',
  },
  llm: {
    provider: (env.LLM_PROVIDER || (llmKey ? 'openai' : 'mock')).toLowerCase(),
    baseUrl: (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: llmKey,
    model: env.LLM_MODEL || '',
    maxSteps: int(env.LLM_MAX_STEPS, 40),
  },
  runsPerIpPerDay: int(env.RUNS_PER_IP_PER_DAY, 30),
};

if (config.qloo.mode === 'live' && !config.qloo.apiKey) {
  console.warn('[config] QLOO_MODE=live but QLOO_API_KEY is empty: falling back to mock.');
  config.qloo.mode = 'mock';
}
if (config.llm.provider !== 'mock' && !config.llm.apiKey) {
  console.warn('[config] LLM provider set but LLM_API_KEY is empty: falling back to mock LLM.');
  config.llm.provider = 'mock';
}
