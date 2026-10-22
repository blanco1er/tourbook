// Private server-side cache for Qloo responses.
// Hackathon rule (developer guide): private server-side caching is allowed with no time limit,
// but Qloo response data must NEVER be stored in a public repository. The cache dir is gitignored.
// Key = sha256(path + sorted normalized params). No TTL by design (demo precompute + quota safety).
// Swap for SQLite/Postgres later by keeping the same get/set interface.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function cacheKey(path, params) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHash('sha256').update(`${path}?${sorted}`).digest('hex');
}

export class FileCache {
  constructor(dir) { this.dir = dir; this.mem = new Map(); this.ready = mkdir(dir, { recursive: true }); }
  #file(key) { return join(this.dir, key.slice(0, 2), `${key}.json`); }
  async get(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try {
      const entry = JSON.parse(await readFile(this.#file(key), 'utf8'));
      this.mem.set(key, entry);
      return entry;
    } catch { return undefined; }
  }
  async set(key, entry) {
    this.mem.set(key, entry);
    await this.ready;
    const file = this.#file(key);
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, file); // atomic replace
  }
}

export class NoCache { async get() { return undefined; } async set() {} }
