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
6) finish with a short summary (max 3 sentences) that only states facts present in tool results.
Rules: use only IDs returned by tools; never invent venues, brands or numbers; Qloo affinities describe aggregate
audiences, never individuals; if a tool returns an error, try the next step and mention the gap.`;

export async function runAgent({ input, qloo, llm, emit = () => {} }) {
  const runId = randomUUID();
  const state = { input, resolved: [], markets: null, audience: null, momentum: null, dates: {}, baseline: null };
  const ctx = { qloo, llm, state };
  const t0 = Date.now();
  let calls = 0;
  const tracer = { emit: (type, data) => { if (type === 'call' && data.status === 'start') calls++; emit(type, data); } };

  return traceStore.run(tracer, async () => {
    emit('plan', { runId, steps: PLAN_STEPS, mode: { qloo: qloo.mode, llm: llm.kind } });
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Plan a tour.\nINPUT: ${JSON.stringify(input)}` },
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
        emit('thought', { text: `The model is unavailable (${err.message}); the scripted planner continues from here.` });
        planner = new MockLLM();
        out = await planner.chat({ messages, tools: TOOL_DEFS });
      }
      if (!out.toolCalls?.length) { summary = out.content || ''; break; }
      if (out.content) emit('thought', { text: out.content });
      messages.push({ role: 'assistant', content: out.content ?? null, tool_calls: out.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }, ...(tc.extra ? { extra_content: tc.extra } : {}) })) });
      for (const tc of out.toolCalls) {
        const tool = TOOLS[tc.name];
        let forModel;
        emit('tool', { id: tc.id, name: tc.name, args: tc.arguments, stage: tool?.stage, status: 'start' });
        try {
          if (!tool) throw new Error(`Unknown tool ${tc.name}`);
          const errs = checkArgs(tool.def.function.parameters, tc.arguments);
          if (errs.length) throw new Error(`Invalid arguments: ${errs.join('; ')}`);
          ({ forModel } = await tool.run(tc.arguments, ctx));
          emit('tool', { id: tc.id, name: tc.name, stage: tool.stage, status: 'done', result: forModel });
        } catch (err) {
          forModel = { error: err.message, code: err.code };
          emit('tool', { id: tc.id, name: tc.name, stage: tool?.stage, status: 'error', error: err.message });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(forModel).slice(0, 8000) });
      }
    }

    // Guarantee layer: if the model skipped something essential, complete it deterministically.
    if (state.markets) {
      for (const m of state.markets.top.slice(0, 3)) {
        const d = state.dates[m.id];
        if (!d || !d.venue || !d.opener || !d.sponsor || !d.after_party || !d.crowd_brief) {
          emit('thought', { text: `Completing the ${m.name} dossier.` });
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

function assemble(runId, state, summary, meta) {
  const top = state.markets?.top || [];
  const comparison = state.baseline && top.length ? compareWithQloo(state.baseline, top) : null;
  return {
    runId, createdAt: new Date().toISOString(), meta,
    disclaimer: meta.qloo === 'mock' ? 'SYNTHETIC DATA: mock mode, no Qloo data.' : 'Source: Qloo Insights API (aggregate taste affinities). Not about individuals.',
    artist: state.resolved[0] || null,
    proxies: state.resolved.slice(1),
    markets: state.markets && { strategy: state.markets.strategy, comparable: state.markets.comparable, attempts: state.markets.attempts, all: state.markets.markets, top },
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
