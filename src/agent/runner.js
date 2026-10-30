// Agent loop: the model plans and calls typed tools; the server executes them against Qloo and
// keeps the full results. The Tour Book is assembled from tool results only (no unsupported claims).
import { randomUUID } from 'node:crypto';
import { traceStore } from '../qloo/client.js';
import { TOOLS, TOOL_DEFS, checkArgs } from './tools.js';
import { routeOrder } from '../domain/markets.js';
import { cityDossier } from '../domain/dossier.js';
import { compareWithQloo } from '../domain/baseline.js';
import { config } from '../config.js';
import { CITY_BY_ID } from '../data/cities.js';
import { MockLLM } from './llm.js';

export const PLAN_STEPS = ['Resolve', 'Markets', 'Audience', 'Timing', 'Dates', 'Proof', 'Book'];

const SYSTEM = `You are Tourbook, the advance team of a touring artist.
Goal: a tour plan driven by taste, not population. Work in this order:
1) resolve_entity for the headliner and each audience proxy (proxies stand in for artists too small for the graph);
2) rank_markets with all resolved IDs (headliner first);
3) audience_profile and momentum for the headliner;
4) for the top 3 markets: local_picks(kind=venue), find_openers, sponsor_fit, local_picks(kind=after_party), local_picks(kind=crowd_brief);
5) llm_only_baseline;
6) finish with a short summary: plain text, no markdown, no lists, at most 3 sentences, only facts present in tool results.
Speed: call independent tools in the same turn (parallel tool calls), e.g. all resolve_entity calls together,
audience_profile with momentum, and the five dossier tools of all three markets together.
Rules: use only IDs returned by tools; never invent venues, brands or numbers; Qloo affinities describe aggregate
audiences, never individuals; if a tool returns an error, try the next step and mention the gap.`;
// Added only when the user reads Tourbook in French: tool names, arguments and Qloo requests stay in English.
const SYSTEM_FR = `
Language: the user reads Tourbook in French. Write your short progress notes and the final summary in natural,
professional French (use "vous"). Keep tool names, IDs, entity names (artists, venues, brands, cities) unchanged.`;

export async function runAgent({ input, qloo, llm, emit = () => {} }) {
  const runId = randomUUID();
  const state = { input, resolved: [], markets: null, audience: null, momentum: null, dates: {}, baseline: null };
  const ctx = { qloo, llm, state };
  const fr = input.lang === 'fr';
  const t0 = Date.now();
  let calls = 0;
  const tracer = { emit: (type, data) => { if (type === 'call' && data.status === 'start') calls++; emit(type, data); } };

  return traceStore.run(tracer, async () => {
    emit('plan', { runId, steps: PLAN_STEPS, mode: { qloo: qloo.mode, llm: llm.kind } });
    const messages = [
      { role: 'system', content: fr ? SYSTEM + SYSTEM_FR : SYSTEM },
      { role: 'user', content: `Plan a tour.\nINPUT: ${JSON.stringify(fr ? input : (({ lang, ...rest }) => rest)(input))}` },
    ];
    let summary = '';
    let planner = llm;
    for (let step = 0; step < config.llm.maxSteps; step++) {
      let out;
      try {
        out = await planner.chat({ messages, tools: TOOL_DEFS });
      } catch (err) {
        // A model outage or quota error must not cost the user the plan: the scripted planner reads the
        // same conversation and carries on from the tool calls already made.
        if (planner.kind === 'mock') throw err;
        emit('thought', { text: fr ? `Le modèle est indisponible (${err.message}) ; le planificateur scripté prend le relais.` : `The model is unavailable (${err.message}); the scripted planner continues from here.` });
        planner = new MockLLM();
        out = await planner.chat({ messages, tools: TOOL_DEFS });
      }
      if (!out.toolCalls?.length) { summary = plainSummary(out.content || ''); break; }
      if (out.content) emit('thought', { text: out.content });
      messages.push({ role: 'assistant', content: out.content ?? null, tool_calls: out.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }, ...(tc.extra ? { extra_content: tc.extra } : {}) })) });
      // Independent calls from one turn run concurrently (the Qloo limiter caps real concurrency);
      // results go back to the model in the order it asked for them.
      const results = await Promise.all(out.toolCalls.map(async (tc) => {
        const tool = TOOLS[tc.name];
        let forModel;
        emit('tool', { id: tc.id, name: tc.name, args: tc.arguments, stage: tool?.stage, status: 'start' });
        try {
          if (!tool) throw new Error(`Unknown tool ${tc.name}`);
          const errs = checkArgs(tool.def.function.parameters, tc.arguments);
          if (errs.length) throw new Error(`Invalid arguments: ${errs.join('; ')}`);
          ({ forModel } = await tool.run(tc.arguments, ctx));
          // The fan map (national heatmap cells) goes to the screen only: the model never sees it.
          if (tc.name === 'rank_markets' && state.markets?.heat) emit('heat', state.markets.heat);
          emit('tool', { id: tc.id, name: tc.name, stage: tool.stage, status: 'done', result: forModel });
        } catch (err) {
          forModel = { error: err.message, code: err.code };
          emit('tool', { id: tc.id, name: tc.name, stage: tool?.stage, status: 'error', error: err.message });
        }
        return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(forModel).slice(0, 8000) };
      }));
      messages.push(...results);
    }

    // Guarantee layer: if the model skipped something essential, complete it deterministically.
    if (state.markets) {
      for (const m of state.markets.top.slice(0, 3)) {
        const d = state.dates[m.id];
        if (!d || !d.venue || !d.opener || !d.sponsor || !d.after_party || !d.crowd_brief) {
          emit('thought', { text: fr ? `Finalisation du dossier de ${m.name}.` : `Completing the ${m.name} dossier.` });
          const ids = state.resolved.map((r) => r.selected.id).slice(0, 4);
          const full = await cityDossier(qloo, { entityIds: ids, entityType: state.resolved[0]?.selected?.type, cityId: m.id });
          state.dates[m.id] = { city: d?.city || full.city, venue: d?.venue || full.venue, opener: d?.opener || full.opener, sponsor: d?.sponsor || full.sponsor, after_party: d?.after_party || full.after, crowd_brief: d?.crowd_brief || full.crowd };
        }
      }
    }

    const book = assemble(runId, state, summary, { calls, ms: Date.now() - t0, qloo: qloo.mode, llm: `${llm.kind}:${llm.model}` });
    emit('done', book);
    return book;
  });
}

/** The summary is shown as one paragraph: drop markdown, keep the model's closing section, cap at 3 sentences. */
export function plainSummary(text) {
  const parts = String(text).split(/^#{1,6}\s*summary\s*$/im);
  const tail = parts[parts.length - 1];
  const flat = tail.replace(/^#{1,6}\s.*$/gm, ' ').replace(/^\s*([-*]|\d+\.)\s+/gm, ' ').replace(/[*_`]|---/g, '').replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?]+[.!?]+/g) || [flat];
  return sentences.slice(0, 3).map((x) => x.trim()).join(' ');
}

function assemble(runId, state, summary, meta) {
  const top = state.markets?.top || [];
  const comparison = state.baseline && top.length ? compareWithQloo(state.baseline, top) : null;
  return {
    runId, createdAt: new Date().toISOString(), meta,
    disclaimer: meta.qloo === 'mock' ? 'SYNTHETIC DATA: mock mode, no Qloo data.' : 'Source: Qloo Insights API (aggregate taste affinities). Not about individuals.',
    artist: state.resolved[0] || null,
    proxies: state.resolved.slice(1),
    markets: state.markets && { strategy: state.markets.strategy, comparable: state.markets.comparable, attempts: state.markets.attempts, all: state.markets.markets, top, heat: state.markets.heat || null },
    route: routeOrder(top),
    audience: state.audience,
    momentum: state.momentum,
    dates: top.slice(0, 3).map((m) => ({ market: m, ...state.dates[m.id] })),
    baseline: state.baseline,
    // Same nearest-neighbour routing for the LLM-only plan, so the map comparison is fair.
    baselineRoute: state.baseline ? routeOrder(state.baseline.cities.map((c) => CITY_BY_ID[c.id]).filter(Boolean)) : [],
    comparison,
    summary,
  };
}
