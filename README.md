# Tourbook

**Population lies. Taste doesn't.**
Tourbook is an AI advance team for touring artists (musicians, comedians, live podcasts). An agent uses the
[Qloo Taste AI](https://www.qloo.com/) graph to find the cities where an act's fans over-index, then preps each
date: the room, an opener that widens the audience, a sponsor fit, an after-show spot and a crowd brief.
A reverse **room mode** lets a venue type its neighbourhood and get acts worth booking.

> Built for the Qloo Agentic Hackathon 2026. Live demo: **https://tourbook-q2d9.onrender.com** (real Qloo data, no sign-up).

## Try it in 20 seconds

1. Open the app and click **Run the Men I Trust demo** (or open `/?demo=men-i-trust`).
2. Watch the agent work: the seven steps, each tool call and each Qloo request stream in, and the top markets light up on the map as soon as they are ranked.
3. Flip the map between **With Qloo** and **Without Qloo** to see what taste data changes.
4. Open **Date 1**: room, opener (with its taste fit), sponsor, after-show, crowd brief, each with the Qloo request behind it.
5. Open **Agent** for the full run log and how the plan used Qloo; then **Room mode** and pick *Lower East Side*.

Other one-click demos, all real acts: `/?demo=mark-normand` (stand-up: comedy clubs), `/?demo=last-podcast-on-the-left`
(live podcast: theaters), `/?demo=tycho`, `/?demo=watchhouse` (a folk duo too small for the graph alone, planned through
three sound-alikes). Any plan can be shared with **Copy link**, saved with **Save PDF** (print stylesheet) or heard as a
30-second **voice briefing** (browser speech, no paid TTS).

Without `QLOO_API_KEY` the server runs in **mock mode** with invented acts and numbers (labelled "Synthetic data"
everywhere), so the code can be tried without a key.

## What it does

- **Hidden Market Score**: ranks 34 US metros by Qloo taste affinity vs population (taste rank vs population rank).
- **Live agent**: the plan (Resolve, Markets, Audience, Timing, Dates, Proof, Book), each typed tool call and each Qloo request stream in over SSE; the **Agent** view keeps the full run log with exact parameters.
- **Per-date dossier**: room (live-music venue, comedy club or theater, by format), opener in the same format with its taste fit, sponsor, after-show, crowd brief. Every item cites the Qloo call behind it, with the explainability split per input signal.
- **With vs without Qloo**: one toggle shows what a model without taste data plans (big metros) next to the Qloo plan, on the map and side by side.
- **Momentum**: weekly trend to size the rooms.
- **Room mode**: the same graph, read from the venue side of the booking market.
- **"How this plan used Qloo"**: every endpoint and `filter.type` the run touched, with call counts and validator rejections.

## Why it only works with Qloo

| Need | Qloo endpoint | Key parameters |
| --- | --- | --- |
| Resolve the act and its "sounds like" proxies | `GET /search` | `query`, `types`, `take` |
| Where the fans are | `GET /v2/insights` | `filter.type=urn:heatmap`, `signal.interests.entities`, `filter.location` |
| Who the audience is | `GET /v2/insights` | `filter.type=urn:demographics` |
| Openers | `GET /v2/insights` + `GET /v2/analysis/compare` | `filter.popularity.max`, `filter.tags` (same format), `feature.explainability` |
| Venues, after-show | `GET /v2/insights` + `GET /v2/tags` | `filter.type=urn:entity:place`, `filter.location.query`, `filter.tags`, `filter.price_level.max` |
| Sponsors, crowd brief | `GET /v2/insights` | `urn:entity:brand`, `urn:entity:tv_show`, `urn:entity:podcast`, `urn:tag`, `signal.location.query` |
| Timing | `GET /v2/trending` | `filter.start_date`, `filter.end_date` |
| Venue mode | `GET /v2/insights` | `urn:entity:artist`, `signal.location.query`, `filter.popularity.max` |

Measured on the five demo acts (22 Oct 2026, live): a population-ranked plan shares at most 2 of the top 8 markets
with the Qloo plan; for Mark Normand, Last Podcast on the Left and Watchhouse it shares none or one.

## Architecture

```
browser (vanilla JS + MapLibre)  ──SSE──▶  Express server
                                            ├─ agent loop (LLM tool calling, 8 typed tools)
                                            ├─ domain: markets (HMS), dossier, venue mode, baseline
                                            └─ Qloo client ─ param validator ─ limiter/retry ─ private cache (never in git)
```

- `src/qloo/`: client interface, live HTTP client (GET only, `X-Api-Key`, retries on 429/5xx with `Retry-After`),
  **MOCK client** (synthetic data, same response shapes), per-`filter.type` parameter allowlist (Qloo ignores
  invalid parameters silently, so we refuse them), on-disk cache with no TTL.
- `src/agent/`: tool definitions (JSON Schemas), OpenAI-compatible LLM provider, scripted mock planner, agent runner.
- `src/domain/`: Hidden Market Score, per-city dossier, venue mode, LLM-only baseline.
- `public/`: single-page UI on our shared design system (`public/design-system/`: tokens, components, spring motion;
  Apple HIG patterns: glass sidebar, toolbar, inset lists, sheets, toasts; light and dark; 44 pt touch targets).
- **One plan per click.** The client locks every run button while the agent works and sends a request id (`rid`)
  per click. The server keeps a registry of runs: a duplicate request (double click, reconnect, reload, second
  tab) joins the run in flight or replays the finished one, and never counts against the daily cap.
  `POST /api/plan` accepts an `Idempotency-Key` header for the same guarantee.

## Run it

Requires Node.js 20.6+.

```sh
npm install
npm start          # http://localhost:8787 (mock mode: no key needed)
npm test           # boots the server in mock mode and checks every route, incl. the double-run guard (25 checks)
```

Live mode: copy `.env.example` to `.env`, set `QLOO_API_KEY` (hackathon keys only work on `hackathon.api.qloo.com`)
and, for a model-driven planner, `LLM_PROVIDER=openai`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` (any
OpenAI-compatible endpoint; `render.yaml` uses Gemini's). Without a model key, a scripted planner runs the same tool
loop, and it also takes over mid-run if the model fails. Keys stay on the server; the browser never calls Qloo or the LLM.

Deploy: `render.yaml` is a Render Blueprint (always-on instance, health check `/api/health`); paste the two keys in
the dashboard. In live mode the server warms its private cache with the demo acts at boot (`WARM_DEMOS=false` to skip).

## Responsible use

Qloo results are aggregate cultural affinities. Tourbook sends no personal data to Qloo, shows the source of
every result, and never presents an affinity as a fact about an individual. Qloo responses are cached privately
on the server and are **not** in this repository: all fixtures in `src/data/fixtures.js` are invented.

## Known limitations

- Heatmap affinity is percentile-like and saturates at 1 in many cells, so a metro's taste score is the mean
  `affinity_rank` of the heatmap cells within 50 km of its centre.
- `/v2/analysis/compare` returns shared and distinguishing taste tags, not audience sizes: the opener card shows a
  taste fit, not a headcount.
- `/v2/trending` is flat for many acts over six months; the momentum card then says "steady".
- With the scripted planner, the "without Qloo" plan is the population-ranked answer; with a model key, it is the
  same model asked with no tools.
- 34 US metros only; populations are approximate Census 2020 figures.

## License

MIT, see [LICENSE](LICENSE). City populations: approximate US Census 2020 metro figures.
Map tiles: [OpenFreeMap](https://openfreemap.org) / OpenStreetMap contributors.
