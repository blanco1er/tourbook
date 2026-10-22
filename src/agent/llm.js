// LLM provider abstraction. Interface:
//   chat({ messages, tools, json }) -> { content: string|null, toolCalls: [{ id, name, arguments: object }] }
// Providers:
//   - "openai": any OpenAI-compatible /chat/completions endpoint (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL).
//   - "mock":   a scripted planner that emits the same tool calls a good model would. No key, no network.
import { config } from '../config.js';
import { CITIES } from '../data/cities.js';

export function createLLM(cfg = config.llm) {
  return cfg.provider === 'mock' ? new MockLLM() : new OpenAICompatLLM(cfg);
}

export class OpenAICompatLLM {
  constructor({ baseUrl, apiKey, model }) {
    if (!model) throw new Error('LLM_MODEL is required for a real LLM provider.');
    this.kind = 'openai'; this.baseUrl = baseUrl; this.apiKey = apiKey; this.model = model;
  }
  async chat({ messages, tools = [], json = false }) {
    const body = { model: this.model, messages, temperature: 0.2 };
    if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${data?.error?.message || 'error'}`);
    const msg = data?.choices?.[0]?.message || {};
    return {
      content: msg.content ?? null,
      toolCalls: (msg.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: safeJson(tc.function?.arguments) })),
      usage: data.usage,
    };
  }
}

const safeJson = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s || {}; } catch { return {}; } };

/**
 * Scripted planner. Reads the conversation (tool calls already made + their results) and decides the
 * next call, exactly like a tool-using model would. Lets the whole agent loop run with no API key.
 */
export class MockLLM {
  constructor() { this.kind = 'mock'; this.model = 'mock-planner'; }

  async chat({ messages, tools = [] }) {
    if (!tools.length) return { content: '{"cities":[]}', toolCalls: [] };
    const user = messages.find((m) => m.role === 'user')?.content || '';
    const input = safeJson(user.split('INPUT:')[1] || '{}');
    const calls = [];
    const results = Object.fromEntries(messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, safeJson(m.content)]));
    for (const m of messages) if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) calls.push({ id: tc.id, name: tc.function.name, args: safeJson(tc.function.arguments), result: results[tc.id] });
    const next = this.#next(input, calls);
    if (!next) return { content: this.#final(input, calls), toolCalls: [] };
    return { content: next.thought, toolCalls: [{ id: `call_${calls.length + 1}`, name: next.name, arguments: next.args }] };
  }

  #next(input, calls) {
    const done = (name, pred = () => true) => calls.some((c) => c.name === name && pred(c.args));
    const names = [input.artist, ...(input.proxies || [])].filter(Boolean);
    const type = input.type || 'artist';
    for (const n of names) if (!done('resolve_entity', (a) => a.name === n))
      return { name: 'resolve_entity', args: { name: n, type }, thought: n === input.artist ? `Resolving "${n}" in Qloo's entity graph.` : `Resolving audience proxy "${n}".` };
    const ids = calls.filter((c) => c.name === 'resolve_entity' && c.result?.selected).map((c) => c.result.selected.id);
    if (!ids.length) return null;
    if (!done('rank_markets')) return { name: 'rank_markets', args: { entity_ids: ids.slice(0, 4), top_n: 8 }, thought: 'Ranking 34 metros by taste affinity versus population.' };
    if (!done('audience_profile')) return { name: 'audience_profile', args: { entity_id: ids[0] }, thought: 'Profiling who this audience is (aggregate segments only).' };
    if (!done('momentum')) {
      const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - 182);
      return { name: 'momentum', args: { entity_id: ids[0], start_date: iso(start), end_date: iso(end) }, thought: 'Checking six months of momentum to size the rooms.' };
    }
    const top = calls.find((c) => c.name === 'rank_markets')?.result?.top || [];
    for (const m of top.slice(0, 3)) {
      const city = m.id;
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'venue')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'venue' }, thought: `${m.name}: finding the room whose crowd matches the fan base.` };
      if (!done('find_openers', (a) => a.city_id === city)) return { name: 'find_openers', args: { entity_ids: ids, city_id: city, popularity_max: 0.85 }, thought: `${m.name}: looking for an opener that brings new fans, not the same ones.` };
      if (!done('sponsor_fit', (a) => a.city_id === city)) return { name: 'sponsor_fit', args: { entity_ids: ids, city_id: city }, thought: `${m.name}: matching brands this crowd already loves.` };
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'after_party')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'after_party' }, thought: `${m.name}: picking an affordable after-show spot.` };
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'crowd_brief')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'crowd_brief' }, thought: `${m.name}: writing the crowd brief.` };
    }
    if (!done('llm_only_baseline')) return { name: 'llm_only_baseline', args: { artist_name: input.artist, n: 8 }, thought: 'Building the LLM-only plan to prove what Qloo changes.' };
    return null;
  }

  #final(input, calls) {
    const rank = calls.find((c) => c.name === 'rank_markets')?.result;
    const hidden = (rank?.top || []).filter((m) => m.rankGap > 0).slice(0, 3).map((m) => m.name);
    const base = calls.find((c) => c.name === 'llm_only_baseline')?.result;
    const big = (base?.cities || []).slice(0, 3).map((c) => CITIES.find((x) => x.id === (c?.id ?? c))?.name).filter(Boolean);
    return `${input.artist}'s fans over-index in ${hidden.join(', ') || 'secondary markets'}, cities a population-first plan (${big.join(', ')}) would skip. Each date below comes with a room, an opener that widens the audience, a sponsor fit and a crowd brief, all traceable to Qloo calls.`;
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
