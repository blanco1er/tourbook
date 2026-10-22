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
    // OpenAI itself takes the full schema; other OpenAI-compatible hosts (Gemini) reject `strict`,
    // `additionalProperties` and `pattern` with a 400, and null assistant content.
    const portable = !/api\.openai\.com/.test(this.baseUrl);
    const body = { model: this.model, messages: portable ? messages.map((m) => (m.content === null ? { ...m, content: '' } : m)) : messages, temperature: 0.2 };
    if (tools.length) { body.tools = portable ? tools.map(portableTool) : tools; body.tool_choice = 'auto'; }
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const data = safeJson(text);
    if (!res.ok) {
      const err = Array.isArray(data) ? data[0]?.error : data?.error;
      console.warn(`[llm] HTTP ${res.status}: ${text.slice(0, 600)}`);
      throw new Error(`LLM HTTP ${res.status}: ${err?.message || 'error'}`);
    }
    const msg = data?.choices?.[0]?.message || {};
    return {
      content: msg.content ?? null,
      // `extra_content` carries Gemini 3's thought signature: it must go back with the call on the next turn.
      toolCalls: (msg.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: safeJson(tc.function?.arguments), extra: tc.extra_content })),
      usage: data.usage,
    };
  }
}

const safeJson = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s || {}; } catch { return {}; } };

function portableSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(portableSchema);
  const out = {};
  for (const [k, v] of Object.entries(s)) if (!['strict', 'additionalProperties', 'pattern'].includes(k)) out[k] = portableSchema(v);
  return out;
}
const portableTool = (t) => ({ type: 'function', function: portableSchema(t.function) });

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
    const fr = input.lang === 'fr'; // same calls, same facts: only the narration changes language
    const say = (en, frText) => (fr ? frText : en);
    for (const n of names) if (!done('resolve_entity', (a) => a.name === n))
      return { name: 'resolve_entity', args: { name: n, type }, thought: n === input.artist ? say(`Resolving "${n}" in Qloo's entity graph.`, `Recherche de « ${n} » dans le graphe d’entités de Qloo.`) : say(`Resolving audience proxy "${n}".`, `Recherche de l’artiste similaire « ${n} ».`) };
    const ids = calls.filter((c) => c.name === 'resolve_entity' && c.result?.selected).map((c) => c.result.selected.id);
    if (!ids.length) return null;
    if (!done('rank_markets')) return { name: 'rank_markets', args: { entity_ids: ids.slice(0, 4), top_n: 8 }, thought: say('Ranking 34 metros by taste affinity versus population.', 'Classement des 34 métropoles selon l’affinité de goût face à la population.') };
    if (!done('audience_profile')) return { name: 'audience_profile', args: { entity_id: ids[0] }, thought: say('Profiling who this audience is (aggregate segments only).', 'Profil de ce public (segments agrégés uniquement).') };
    if (!done('momentum')) {
      return { name: 'momentum', args: { entity_id: ids[0] }, thought: say('Checking six months of momentum to size the rooms.', 'Analyse de six mois de tendance pour dimensionner les salles.') };
    }
    const top = calls.find((c) => c.name === 'rank_markets')?.result?.top || [];
    for (const m of top.slice(0, 3)) {
      const city = m.id;
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'venue')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'venue' }, thought: say(`${m.name}: finding the room whose crowd matches the fan base.`, `${m.name} : recherche de la salle dont le public correspond aux fans.`) };
      if (!done('find_openers', (a) => a.city_id === city)) return { name: 'find_openers', args: { entity_ids: ids, city_id: city, popularity_max: 0.85 }, thought: say(`${m.name}: looking for a smaller act whose fans share this taste.`, `${m.name} : recherche d’une première partie plus modeste dont les fans partagent ce goût.`) };
      if (!done('sponsor_fit', (a) => a.city_id === city)) return { name: 'sponsor_fit', args: { entity_ids: ids, city_id: city }, thought: say(`${m.name}: matching brands this crowd already loves.`, `${m.name} : sélection des marques que ce public aime déjà.`) };
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'after_party')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'after_party' }, thought: say(`${m.name}: picking an affordable after-show spot.`, `${m.name} : choix d’un lieu d’after abordable.`) };
      if (!done('local_picks', (a) => a.city_id === city && a.kind === 'crowd_brief')) return { name: 'local_picks', args: { entity_ids: ids, city_id: city, kind: 'crowd_brief' }, thought: say(`${m.name}: writing the crowd brief.`, `${m.name} : rédaction du brief public.`) };
    }
    if (!done('llm_only_baseline')) return { name: 'llm_only_baseline', args: { artist_name: input.artist, n: 8 }, thought: say('Building the LLM-only plan to prove what Qloo changes.', 'Construction du plan sans Qloo (modèle seul) pour montrer ce que Qloo change.') };
    return null;
  }

  #final(input, calls) {
    const top = calls.find((c) => c.name === 'rank_markets')?.result?.top || [];
    const baseIds = (calls.find((c) => c.name === 'llm_only_baseline')?.result?.cities || []).map((c) => c?.id ?? c);
    const nameOf = (id) => CITIES.find((x) => x.id === id)?.name;
    // Only claim what the two plans actually disagree on.
    const onlyQloo = top.filter((m) => !baseIds.includes(m.id)).slice(0, 3).map((m) => m.name);
    const onlyBase = baseIds.filter((id) => !top.some((m) => m.id === id)).slice(0, 3).map(nameOf).filter(Boolean);
    if (input.lang === 'fr') {
      const leadFr = top[0] ? `Le marché le plus fort de ${input.artist} est ${top[0].name} (Score de marché caché ${top[0].hms}).` : `Les marchés de ${input.artist} sont classés par goût.`;
      const diffFr = onlyQloo.length && onlyBase.length
        ? ` Les données de goût ajoutent ${onlyQloo.join(', ')} ; un plan sans elles aurait retenu ${onlyBase.join(', ')} à la place.`
        : onlyQloo.length ? ` Les données de goût ajoutent ${onlyQloo.join(', ')}.` : '';
      return `${leadFr}${diffFr} Chaque date ci-dessous comprend une salle, une première partie, des sponsors adaptés et un brief public, tous traçables jusqu’aux appels Qloo.`;
    }
    const lead = top[0] ? `${input.artist}'s strongest market is ${top[0].name} (Hidden Market Score ${top[0].hms}).` : `${input.artist}'s markets are ranked by taste.`;
    const diff = onlyQloo.length && onlyBase.length
      ? ` Taste data adds ${onlyQloo.join(', ')}; a plan without it would have picked ${onlyBase.join(', ')} instead.`
      : onlyQloo.length ? ` Taste data adds ${onlyQloo.join(', ')}.` : '';
    return `${lead}${diff} Each date below comes with a room, an opener, a sponsor fit and a crowd brief, all traceable to Qloo calls.`;
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
