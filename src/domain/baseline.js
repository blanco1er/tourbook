// "LLM-only" baseline: what a model WITHOUT Qloo would plan. Used for the side-by-side proof.
// Mock LLM: the classic population-driven answer (biggest metros). Real LLM: asked with NO tools.
import { CITIES } from '../data/cities.js';

export async function llmOnlyBaseline(llm, { artistName, n = 8 }) {
  if (llm.kind === 'mock') {
    const cities = [...CITIES].sort((a, b) => b.pop - a.pop).slice(0, n).map((c) => ({ id: c.id, reason: 'Large metro population and major-market venue supply.' }));
    return { source: 'simulated-llm-only', note: 'Mock baseline: population-ranked metros (what an LLM without taste data typically proposes).', cities };
  }
  const allowed = CITIES.map((c) => c.id);
  const prompt = `You are a tour routing assistant with NO access to audience data. For the artist "${artistName}", pick the ${n} best US cities for a headline tour from this list of ids only: ${allowed.join(', ')}. Answer with JSON only: {"cities":[{"id":"...","reason":"..."}]}`;
  const out = await llm.chat({ messages: [{ role: 'user', content: prompt }], tools: [], json: true });
  let parsed;
  try { parsed = JSON.parse(out.content.replace(/^```(json)?|```$/g, '').trim()); } catch { parsed = { cities: [] }; }
  const cities = (parsed.cities || []).filter((c) => allowed.includes(c.id)).slice(0, n);
  return { source: `llm-only:${llm.model}`, note: 'Same model, no tools, no Qloo.', cities };
}

/** Compare the two plans: which markets only Qloo surfaced. */
export function compareWithQloo(baseline, qlooTop) {
  const b = new Set(baseline.cities.map((c) => c.id));
  const q = new Set(qlooTop.map((m) => m.id));
  return {
    onlyQloo: [...q].filter((id) => !b.has(id)),
    onlyLlm: [...b].filter((id) => !q.has(id)),
    shared: [...q].filter((id) => b.has(id)),
  };
}
