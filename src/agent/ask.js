// "Ask Tourbook" (30 Oct): a follow-up request on a finished plan, in plain words
// ("Swap the weakest stop for somewhere in the South", "Add a stop near Denver", "Drop Austin").
// The agent works from the plan's own national scores (the one heatmap call, already made), checks a candidate's
// rooms with a live Qloo call, and ends with ONE proposal. The server validates it against the plan before it is
// shown, and computes the before/after itself (driving distance, mean Hidden Market Score, hidden markets).
// With no model key, a scripted planner makes the same tool calls, so the feature never depends on the model.
import { CITIES, CITY_BY_ID, haversineKm } from '../data/cities.js';
import { localPicks } from '../domain/dossier.js';
import { routeOrder } from '../domain/markets.js';

export const REGIONS = {
  northeast: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA'],
  midwest: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS'],
  south: ['DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'KY', 'TN', 'AL', 'MS', 'AR', 'LA', 'OK', 'TX'],
  west: ['MT', 'ID', 'WY', 'CO', 'NM', 'AZ', 'UT', 'NV', 'CA', 'OR', 'WA', 'AK', 'HI'],
};
const MAX_ROUNDS = 6;
const MIN_STOPS = 3, MAX_STOPS = 10;

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const ASK_TOOLS = [
  fn('find_markets', "List candidate metros from this plan's national Qloo taste scores (no new request), best Hidden Market Score first. Optional filters: a US region, or a distance from a city.", {
    region: { type: 'string', enum: Object.keys(REGIONS) },
    near_city: { type: 'string', description: 'A metro id or name; candidates are sorted by distance to it when within_km is set.' },
    within_km: { type: 'integer', minimum: 50, maximum: 1500 },
    include_tour: { type: 'boolean', description: 'Also list the stops already in the tour (default false).' },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  }),
  fn('check_rooms', "Live Qloo check of one metro: the rooms this act's audience favours there (urn:entity:place with the room tag). Use it before proposing a city.", {
    city_id: { type: 'string' },
  }, ['city_id']),
  fn('propose_change', 'End here with ONE proposal. Empty remove and add means the tour already holds. Every added city must come from find_markets in this conversation.', {
    remove: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    add: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    reason: { type: 'string', description: 'One or two plain sentences, citing the numbers the tools returned.' },
  }, ['remove', 'add', 'reason']),
];

const SYSTEM = (lang) => `You are Tourbook's routing agent. The user has a finished tour plan and asks for a change in plain words.
Tools: find_markets (this plan's own Qloo taste scores, free), check_rooms (one live Qloo request per city), propose_change (ends the turn).
Rules: work in at most ${MAX_ROUNDS} rounds; check the rooms of any city you add; propose at most one change; never invent a number:
quote only Hidden Market Scores, ranks, rooms and distances that the tools returned. A tour keeps ${MIN_STOPS} to ${MAX_STOPS} stops.
The weakest stop is the one with the lowest Hidden Market Score.
When the user names a region or a place, honour it: swap the weakest stop that is NOT already in that region for the best candidate there
(found with find_markets, rooms checked), even if it scores lower, and state the cost in points in the reason. Only when the user asks for a
stronger tour without naming a place, and no candidate beats the weakest stop, answer that the tour holds (propose_change with empty lists).
${lang === 'fr' ? 'Write the reason in French.' : 'Write the reason in English.'}`;

/** Resolves "Denver", "denver", "salt-lake-city"… to a metro id, or null. */
export function cityIdOf(s) {
  if (!s) return null;
  const q = String(s).toLowerCase().trim();
  if (CITY_BY_ID[q]) return q;
  return CITIES.find((c) => c.name.toLowerCase() === q || c.query.toLowerCase() === q)?.id
    || CITIES.find((c) => q.includes(c.name.toLowerCase()))?.id || null;
}

/** Nearest-neighbour route length (km) through the given metros, in the same order the plan uses. */
export function routeKm(ids, scores) {
  const ms = ids.map((id) => ({ ...CITY_BY_ID[id], hms: scores[id]?.hms ?? 0 })).filter((m) => m.lat != null).sort((a, b) => b.hms - a.hms);
  const order = routeOrder(ms).map((id) => CITY_BY_ID[id]);
  let km = 0;
  for (let i = 1; i < order.length; i++) km += haversineKm(order[i - 1], order[i]);
  return { order: order.map((c) => c.id), km: Math.round(km) };
}

function summarize(ids, scores) {
  const hs = ids.map((id) => scores[id]?.hms).filter(Number.isFinite);
  return { stops: ids.length, meanHms: hs.length ? Math.round((hs.reduce((a, b) => a + b, 0) / hs.length) * 10) / 10 : null, hidden: ids.filter((id) => scores[id]?.hidden).length, ...routeKm(ids, scores) };
}

/** Validates a proposal against the plan; returns { ok, errors, proposal }. */
export function validateProposal({ remove = [], add = [], reason = '' }, { tour, scores, seen }) {
  const errors = [];
  const rem = [...new Set(remove.map(cityIdOf).filter(Boolean))], ad = [...new Set(add.map(cityIdOf).filter(Boolean))];
  if (remove.length !== rem.length || add.length !== ad.length) errors.push('Unknown city id.');
  for (const id of rem) if (!tour.includes(id)) errors.push(`${id} is not in the tour.`);
  for (const id of ad) {
    if (tour.includes(id) && !rem.includes(id)) errors.push(`${id} is already in the tour.`);
    if (!scores[id]) errors.push(`${id} has no taste score in this plan.`);
    if (!seen.has(id)) errors.push(`${id} was not returned by find_markets in this conversation.`);
  }
  const next = [...tour.filter((id) => !rem.includes(id)), ...ad];
  if (next.length < MIN_STOPS || next.length > MAX_STOPS) errors.push(`A tour keeps ${MIN_STOPS} to ${MAX_STOPS} stops.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    proposal: {
      remove: rem, add: ad, tour: next, holds: !rem.length && !ad.length,
      reason: String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      before: summarize(tour, scores), after: summarize(next, scores),
    },
  };
}

function marketRow(id, scores, extra = {}) {
  const c = CITY_BY_ID[id]; const s = scores[id];
  return { id, name: c.name, state: c.state, hms: s.hms, tasteRank: s.affinityRank, popRank: s.popRank, hidden: !!s.hidden, ...extra };
}

/** Runs one tool. `ctx` = { qloo, plan: { entityIds, entityType, tour, scores }, seen, emit }. */
async function runTool(name, args, ctx) {
  const { plan, seen } = ctx;
  if (name === 'find_markets') {
    const near = cityIdOf(args.near_city);
    const states = args.region ? REGIONS[args.region] : null;
    let rows = Object.keys(plan.scores).filter((id) => CITY_BY_ID[id])
      .filter((id) => args.include_tour || !plan.tour.includes(id))
      .filter((id) => !states || states.includes(CITY_BY_ID[id].state))
      .map((id) => marketRow(id, plan.scores, near ? { km: Math.round(haversineKm(CITY_BY_ID[near], CITY_BY_ID[id])) } : {}));
    if (near && args.within_km) rows = rows.filter((r) => r.km <= args.within_km); // the named city itself counts
    rows.sort((a, b) => b.hms - a.hms);
    rows = rows.slice(0, args.limit || 6);
    rows.forEach((r) => seen.add(r.id));
    const tour = plan.tour.map((id) => marketRow(id, plan.scores)).sort((a, b) => a.hms - b.hms);
    return { candidates: rows, tour_weakest_first: tour };
  }
  if (name === 'check_rooms') {
    const id = cityIdOf(args.city_id);
    if (!id) throw new Error(`Unknown city ${args.city_id}`);
    const r = await localPicks(ctx.qloo, { entityIds: plan.entityIds, entityType: plan.entityType, city: CITY_BY_ID[id], kind: 'venue', take: 3 });
    return { city: CITY_BY_ID[id].name, rooms: (r.picks || []).slice(0, 3).map((p) => ({ name: p.name, affinity: p.affinity })), found: (r.picks || []).length };
  }
  throw new Error(`Unknown tool ${name}`);
}

/** Scripted planner: reads the request, makes the same calls a model would (find → check → propose). */
export function scriptedPlan(question, plan) {
  const q = ` ${String(question).toLowerCase()} `;
  const region = /south|sud|southern/.test(q) ? 'south' : /midwest|middle west|centre|center/.test(q) ? 'midwest'
    : /northeast|north-east|nord-est|new england/.test(q) ? 'northeast' : /west coast|west|ouest/.test(q) ? 'west' : undefined;
  const mentioned = CITIES.filter((c) => q.includes(` ${c.name.toLowerCase()}`)).map((c) => c.id);
  const add = /\b(add|ajout|another|one more|plus une|extra)/.test(q);
  const drop = /\b(drop|remove|retir|enl[eè]v|supprim|without|sans)\b/.test(q);
  const near = /\b(near|close to|around|pr[eè]s de|autour de|vers)\b/.test(q) ? mentioned.find((id) => !plan.tour.includes(id)) || mentioned[0] : null;
  const weakest = [...plan.tour].sort((a, b) => (plan.scores[a]?.hms ?? 0) - (plan.scores[b]?.hms ?? 0))[0];
  const outside = region ? [...plan.tour].filter((id) => !REGIONS[region].includes(CITY_BY_ID[id].state)).sort((a, b) => (plan.scores[a]?.hms ?? 0) - (plan.scores[b]?.hms ?? 0))[0] : null;
  const target = drop ? mentioned.find((id) => plan.tour.includes(id)) : (!add ? (mentioned.find((id) => plan.tour.includes(id)) || outside || weakest) : null);
  return { region, near, add, drop: drop && !!target, target };
}

async function runScripted(question, ctx, log) {
  const L = (en, fr) => (ctx.lang === 'fr' ? fr : en);
  const intent = scriptedPlan(question, ctx.plan);
  const call = async (name, args) => { const result = await runTool(name, args, ctx); log({ name, args, result }); return result; };
  if (intent.drop) {
    const n = CITY_BY_ID[intent.target].name, h = ctx.plan.scores[intent.target].hms;
    return { remove: [intent.target], add: [], reason: L(`Drops ${n} (Hidden Market Score ${h}) as asked.`, `Retire ${n} (Hidden Market Score ${h}), comme demandé.`) };
  }
  const found = await call('find_markets', { ...(intent.region ? { region: intent.region } : {}), ...(intent.near ? { near_city: intent.near, within_km: 450 } : {}), limit: 5 });
  const best = found.candidates[0];
  const out = intent.target ? ctx.plan.scores[intent.target] : null;
  // An explicit region or place is honoured even if it scores lower; the before/after shows the cost. Otherwise the
  // agent only swaps for a stronger city, and says the tour holds when none is.
  const explicit = !!(intent.region || intent.near);
  if (!best || (!intent.add && !explicit && out && best.hms <= out.hms)) {
    return { remove: [], add: [], reason: best ? L(`The tour holds: the best candidate, ${best.name} (${best.hms}), does not beat ${CITY_BY_ID[intent.target].name} (${out.hms}).`, `La tournée tient : le meilleur candidat, ${best.name} (${best.hms}), ne bat pas ${CITY_BY_ID[intent.target].name} (${out.hms}).`) : L('No candidate matches this request in this plan.', 'Aucune ville de ce plan ne répond à cette demande.') };
  }
  const rooms = await call('check_rooms', { city_id: best.id });
  const roomTxt = rooms.found ? L(` Qloo finds ${rooms.found} room${rooms.found > 1 ? 's' : ''} its audience favours there, led by ${rooms.rooms[0].name}.`, ` Qloo y trouve ${rooms.found} salle${rooms.found > 1 ? 's' : ''} que ce public apprécie, en tête ${rooms.rooms[0].name}.`) : '';
  if (intent.add || !intent.target) return { remove: [], add: [best.id], reason: L(`Adds ${best.name} (Hidden Market Score ${best.hms}).`, `Ajoute ${best.name} (Hidden Market Score ${best.hms}).`) + roomTxt };
  const d = out.hms - best.hms, was = CITY_BY_ID[intent.target].name;
  const cost = d > 0 ? L(` It scores ${d} points lower: the price of the place you asked for.`, ` Elle a ${d} points de moins : c'est le prix de l'endroit demandé.`) : '';
  return { remove: [intent.target], add: [best.id], reason: L(`${best.name} (Hidden Market Score ${best.hms}) replaces ${was} (${out.hms}).`, `${best.name} (Hidden Market Score ${best.hms}) remplace ${was} (${out.hms}).`) + cost + roomTxt };
}

/**
 * One ask. `plan` = { entityIds, entityType, tour: [metro ids], scores: { id: { hms, affinityRank, popRank, hidden } } }.
 * Returns { proposal, steps, by: 'model' | 'scripted', errors? }.
 */
export async function askTourbook({ question, plan, lang = 'en', qloo, llm }) {
  const ctx = { qloo, plan, lang, seen: new Set() };
  const steps = [];
  const log = (s) => steps.push({ name: s.name, args: s.args, result: s.result });
  const finish = (p, by) => {
    const v = validateProposal(p, { tour: plan.tour, scores: plan.scores, seen: ctx.seen });
    return v.ok ? { proposal: v.proposal, steps, by } : { errors: v.errors, steps, by };
  };
  if (llm?.kind === 'openai') {
    try {
      const messages = [
        { role: 'system', content: SYSTEM(lang) },
        { role: 'user', content: `Tour now (weakest first): ${plan.tour.map((id) => `${CITY_BY_ID[id].name} [${id}] HMS ${plan.scores[id]?.hms}`).sort().join('; ')}.\nRequest: ${String(question).slice(0, 300)}` },
      ];
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const out = await llm.chat({ messages, tools: ASK_TOOLS });
        if (!out.toolCalls?.length) break;
        messages.push({ role: 'assistant', content: out.content ?? null, tool_calls: out.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }, ...(tc.extra ? { extra_content: tc.extra } : {}) })) });
        for (const tc of out.toolCalls) {
          if (tc.name === 'propose_change') {
            const r = finish(tc.arguments, 'model');
            if (r.proposal) return r;
            // One retry: the model sees why its proposal was refused.
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ refused: r.errors }) });
            continue;
          }
          let result;
          try { result = await runTool(tc.name, tc.arguments || {}, ctx); log({ name: tc.name, args: tc.arguments, result }); }
          catch (e) { result = { error: e.message }; }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 6000) });
        }
      }
    } catch (e) {
      steps.push({ name: 'note', result: { text: `Model unavailable (${e.message}); the scripted planner answers.` } });
    }
  }
  return finish(await runScripted(question, ctx, log), 'scripted');
}
