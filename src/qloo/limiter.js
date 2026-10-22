// Tiny concurrency + pacing limiter (no dependency).
// Qloo's hackathon limits are "rate-based and monthly" with no published number,
// so we cap concurrency and space requests, and back off on 429 (see client.js).
export class Limiter {
  constructor({ maxConcurrency = 4, minIntervalMs = 150 } = {}) {
    this.max = maxConcurrency; this.minInterval = minIntervalMs;
    this.active = 0; this.queue = []; this.lastStart = 0; this.pausedUntil = 0;
  }
  /** Pause all new starts (e.g. after a 429 with Retry-After). */
  pause(ms) { this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms); }
  schedule(fn) {
    return new Promise((resolve, reject) => { this.queue.push({ fn, resolve, reject }); this.#pump(); });
  }
  #pump() {
    if (this.active >= this.max || this.queue.length === 0) return;
    const wait = Math.max(this.lastStart + this.minInterval, this.pausedUntil) - Date.now();
    if (wait > 0) { clearTimeout(this.timer); this.timer = setTimeout(() => this.#pump(), wait); return; }
    const job = this.queue.shift();
    this.active += 1; this.lastStart = Date.now();
    Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { this.active -= 1; this.#pump(); });
    this.#pump();
  }
}
