# Quality of Life overhaul

Baseline commit `618a3fd`. Orders and resource changes use the existing authoritative match engine in multiplayer and in the solo worker. Older saves can omit the new queue revision and income history fields.

| QoL | Improvement | Status | Previous behavior and verification |
| --- | --- | --- | --- |
| #2 | Smart Worker Assignment | Implemented | Build now works without selecting a worker. Server tests cover automatic assignment and the no-worker case. |
| #3 | Smarter Resource Assignment | Improved | Extended unlimited-stock overflow to finite mines and quarries, with worker distance and current assignments used in the decision. Server tests cover overflow and the previous finite-stock behavior. |
| #4 | Idle Worker indicator | Improved | Retains cycling and makes the count explicit. Stopped workers without another job are counted. |
| #5 | Placement errors | Implemented | Shares terrain, shoreline and occupancy validation with the server. Server and browser regressions exercise invalid placement. |
| #6 | Tower radius | Implemented | Uses race stats and completed range research. The same placement validity drives the preview color. |
| #7 | Construction progress | Improved | The existing selected-building percentage now includes a server estimate. Queued or stopped jobs have no completion estimate. |
| #8 | Repair price | Implemented | Shows the cost of a full repair, including the fortress repair pulse when applicable. Tested independently of construction cost. |
| #10 | Global queues | Improved | Groups active orders by building and shows next and total training time. Existing construction and research entries remain available. |
| #11 | Cancel one queue run | Implemented | Versioned cancellation uses the same refunds as Cancel last. Tests cover the unaffected runs, population and repeated requests. |
| #15 | Group priority | Implemented | Moves the template in the server recruitment order. Tests cover priority and restoration. |
| #16 | Replenish preview | Improved | Adds an explicit confirmation with queued units, cost, bank and free population. The server rejects stale previews. |
| #17 | Double tap or click | Implemented | Selects matching owned troops in the viewport. Desktop and portrait tests exercise the gesture. |
| #18 | Box selection filter | Implemented | Options can restrict box selection to military or workers. Single selection retains its normal behavior. |
| #20 | Group status | Improved | Extends existing roster counts with priority, missing and queued units and completion status. |
| #21 | Formation preview | Implemented | Uses the simulation's formation slots and separates land and sea. Positions are indicative before pathfinding. |
| #22 | Order markers | Improved | Extends existing move and attack markers to distinguish attack-move, gather and rally. |
| #24 | Camera framing | Improved | Replaces simple centering with trimmed bounds and bounded zoom. Templates get an explicit Frame group action. |
| #25 | Hero quick select | Implemented | HUD button shows the living hero, HP and level. A second press centers the camera. |
| #26 | Cooldown indicators | Improved | Existing countdown and disable logic now drives a graphical fill and a ready state. |
| #27 | Income per minute | Implemented | Measures actual deliveries in a 30-second rolling window and publishes once per second. Tested through deltas and restore. |
| #28 | Economy breakdown | Implemented | Groups workers by their private server task or by idle/other. |
| #29 | Minimap icons | Improved | Adds distinct hero and siege shapes, building markers, resource markers and clusters. The existing fog-filtered view is the only entity source. |
| #30 | Return after attack alert | Implemented | Stores the prior center and zoom when jumping to a ping. Portrait regression exercises return. |
| #31 | Upgrade comparison | Implemented | Shows before and after, actual cost and duration from existing research rules. |
| #32 | Missing requirements | Improved | Uses existing progression, producer lists, resources and race-localized names. |
| #33 | HP bars | Improved | Gives heroes, buildings and small selections larger bars and caps extra bars in crowds. |
| #35 | Touch targets | Improved | Preserves current styling and sets the affected portrait controls to at least 44 CSS pixels in height. |
| #36 | Overlapping units | Improved | Chooses the nearest relevant sprite hit zone, with a stable tie-break and units prioritized over buildings. |
| #38 | Graphics settings | Implemented | Low, Medium and High adjust client-only effects and animation. The selection is stored locally. |
| #39 | Solo pause | Implemented | Combines manual pause with visibility pause through the existing worker. Portrait checks cover the saved tick before and after resume. |
| #40 | Error feedback | Improved | Shows short, throttled feedback and authoritative command errors without intercepting input. |

## Performance and verification

Server p95 tick time in milliseconds, averaged over two interleaved baseline and two candidate runs. Each run used 120 ticks per case and the same initial troops.

| Units total | Move before | Move after | Combat before | Combat after |
| ---: | ---: | ---: | ---: | ---: |
| 50 | 1.41 | 1.42 | 0.65 | 0.82 |
| 100 | 1.85 | 1.61 | 0.86 | 0.84 |
| 250 | 2.54 | 2.55 | 2.73 | 3.09 |
| 500 | 5.56 | 5.61 | 5.12 | 5.52 |

The candidate adds about 39 bytes to the benchmark's full snapshot and includes unchanged income only when a full view is sent. Browser/device FPS and server tick time measure different workloads. See the PR checks for Chromium and WebKit emulation results. Physical phones were unavailable.

Reproduce with `BENCH_COUNTS=50,100,250,500 BENCH_CASES=move,combat node scripts/benchmark-armies.mjs`. Local verification ran the TypeScript check, server tests and production build. Local Playwright could not start Chromium due to a sandbox socket restriction.
