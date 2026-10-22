// Factory: one Qloo client for the whole process. MOCK never touches the network.
import { config } from '../config.js';
import { HttpQlooClient } from './client.js';
import { MockQlooClient } from './mock.js';
import { FileCache } from './cache.js';
import { Limiter } from './limiter.js';

export function createQlooClient(cfg = config.qloo) {
  if (cfg.mode === 'live') {
    return new HttpQlooClient({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey,
      cache: new FileCache(cfg.cacheDir),
      limiter: new Limiter({ maxConcurrency: cfg.maxConcurrency, minIntervalMs: cfg.minIntervalMs }),
      timeoutMs: cfg.timeoutMs, maxAttempts: cfg.maxAttempts, strictParams: cfg.strictParams,
    });
  }
  return new MockQlooClient({ strictParams: cfg.strictParams });
}

export { traceStore } from './client.js';
