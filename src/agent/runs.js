// Run registry: makes agent runs idempotent per request.
// A double click, a second tab with the same request id, or an EventSource auto-reconnect must
// never start a second plan (each plan costs Qloo calls and LLM tokens). Requests that share a key
// join the run already in flight, or replay a run that finished less than `ttlMs` ago.
//
//   const reg = createRunRegistry();
//   const { run, joined } = reg.start(key, (emit) => runAgent({ ..., emit }), { ttlMs, admit });  // null if admit() refuses
//   const stop = run.subscribe((type, data) => ...);   // replays past events, then streams live ones
export function createRunRegistry({ ttlMs = 10 * 60 * 1000, max = 500 } = {}) {
  const runs = new Map();
  let started = 0;

  function sweep(now = Date.now()) {
    for (const [k, r] of runs) if (r.finishedAt && now - r.finishedAt > r.ttlMs) runs.delete(k);
    while (runs.size > max) runs.delete(runs.keys().next().value);
  }

  function start(key, task, opts = {}) {
    sweep();
    const existing = key ? runs.get(key) : null;
    if (existing) return { run: existing, joined: true };
    if (opts.admit && !opts.admit()) return null; // e.g. daily cap: only NEW runs are counted

    const listeners = new Set();
    const run = {
      key, ttlMs: opts.ttlMs ?? ttlMs, events: [], finishedAt: 0, error: null, result: undefined, promise: null,
      subscribe(fn) {
        for (const [t, d] of run.events) fn(t, d);
        if (run.finishedAt) return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const emit = (type, data) => { run.events.push([type, data]); for (const fn of listeners) fn(type, data); };
    started++;
    if (key) runs.set(key, run);
    run.promise = Promise.resolve()
      .then(() => task(emit))
      .then((out) => { run.result = out; return out; })
      .catch((e) => { run.error = e; emit('fail', { error: e.message, details: e.attempts }); })
      .finally(() => { run.finishedAt = Date.now(); listeners.clear(); });
    return { run, joined: false };
  }

  return { start, get size() { return runs.size; }, get started() { return started; } };
}

/** Stable key for a plan request: the client's request id if any, else caller + normalised input. */
export function runKey({ rid, ip, input }) {
  if (rid && /^[A-Za-z0-9-]{8,64}$/.test(rid)) return `rid:${rid}`;
  const norm = (s) => String(s || '').trim().toLowerCase();
  return `in:${ip}|${input.type}|${norm(input.artist)}|${input.proxies.map(norm).join(',')}`;
}
