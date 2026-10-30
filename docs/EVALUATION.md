# Tourbook — Evaluation

Measured on 2026-10-30 against the deployed app (https://tourbook-q2d9.onrender.com), with live Qloo data and the production planner
(openai:gemini-3.8-flash). Reproduce: `node scripts/eval.mjs https://tourbook-q2d9.onrender.com`. Only counts and pass/fail checks are
stored here, never Qloo response data.

## 1. Full plans, five demo acts

| Act | Kind | Qloo requests | Endpoints | filter.type values | Rejected params | Hidden markets in the tour | Stops a no-Qloo plan misses | Fan-heat cells | Dossier sections citing their Qloo request | Time |
|---|---|---|---|---|---|---|---|---|---|---|
| Men I Trust | artist | 31 | 4 | 8 | 0 | 8 of 10 | 3 of 10 | 4,035 | 15 of 15 | 68.3 s |
| Mark Normand | person | 30 | 4 | 8 | 0 | 9 of 10 | 7 of 10 | 10,873 | 15 of 15 | 65.0 s |
| Last Podcast on the Left | podcast | 29 | 4 | 7 | 0 | 5 of 5 | 5 of 5 | 7,789 | 15 of 15 | 52.0 s |
| Tycho | artist | 31 | 4 | 8 | 0 | 4 of 5 | 2 of 5 | 7,788 | 15 of 15 | 61.4 s |
| Watchhouse | artist | 31 | 4 | 8 | 0 | 5 of 5 | 1 of 5 | 5,875 | 15 of 15 | 50.8 s |

- **0 rejected parameters** across 152 Qloo requests: the validator refuses a bad request before it is sent.
- **75 of 75 dossier sections** (room, opener, sponsor, after-show, crowd brief) carry the exact Qloo request behind them.
- **18 of 35 stops** across the five acts differ from the plan the same model makes without Qloo.
- Median time for a full plan: 61.4 s (demo answers are served from the Qloo cache warmed at boot).

## 2. Ask Tourbook, three requests per act

| Act | Request | Answer | Qloo requests | Checks | Time |
|---|---|---|---|---|---|
| Men I Trust | Swap the weakest stop for somewhere in the South | − New York, + Washington | 1 | 5/5 | 13.2 s |
| Men I Trust | Swap the weakest stop | the tour holds | 0 | 3/3 | 11.8 s |
| Men I Trust | Drop New York | − New York | 0 | 4/4 | 20.5 s |
| Mark Normand | Swap the weakest stop for somewhere in the South | − Los Angeles, + Louisville | 1 | 5/5 | 16.7 s |
| Mark Normand | Swap the weakest stop | the tour holds | 0 | 3/3 | 8.5 s |
| Mark Normand | Drop Los Angeles | − Los Angeles | 0 | 4/4 | 27.8 s |
| Last Podcast on the Left | Swap the weakest stop for somewhere in the South | − Albuquerque, + New Orleans | 1 | 5/5 | 8.5 s |
| Last Podcast on the Left | Swap the weakest stop | the tour holds | 0 | 3/3 | 38.9 s |
| Last Podcast on the Left | Drop Albuquerque | − Albuquerque | 1 | 4/4 | 28.0 s |
| Tycho | Swap the weakest stop for somewhere in the South | − Portland, + Austin | 1 | 5/5 | 8.7 s |
| Tycho | Swap the weakest stop | the tour holds | 0 | 3/3 | 17.8 s |
| Tycho | Drop Portland | − Portland | 0 | 4/4 | 18.5 s |
| Watchhouse | Swap the weakest stop for somewhere in the South | − Denver, + Washington | 1 | 5/5 | 15.1 s |
| Watchhouse | Swap the weakest stop | the tour holds | 0 | 3/3 | 14.4 s |
| Watchhouse | Drop Nashville | − Nashville | 0 | 4/4 | 41.5 s |

- **15 of 15** requests returned a valid proposal (the server refuses anything else); **60 of 60** independent checks pass.
- Checks: tour size 3–10; every added city is a real metro scored in this plan and not already in it; removed cities were in the tour;
  a named region is respected; "Drop X" drops exactly X; rooms are checked with Qloo before a city is added; an unprompted swap only goes to a stronger city.
- Answered by: model. Median time: 16.7 s.

## 3. Limits, said plainly
- Scores rank taste, not ticket sales: no attendance forecast is made, and no real act has toured with it yet.
- The 34 candidate metros are a fixed list; a city outside it can't be proposed.
- Route length is a straight-line nearest-neighbour estimate, not a driving route.
