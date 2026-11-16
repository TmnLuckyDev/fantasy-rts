# Large-army performance

Baseline is main at `946af35` with PR #10's A* heap and Orc stats and PR #11's overlapping sight and snapshot changes. The measurements are from this task's local Node runner. They are comparative workloads, not limits for a Render deployment.

## Reproduce

```sh
node --expose-gc scripts/benchmark-armies.mjs
node scripts/benchmark-multiplayer.mjs
npm run build
npm run test:browser -- tests/massive.spec.ts
MOBILE_BROWSER=webkit npm run test:browser -- tests/massive.spec.ts
```

Set `BENCH_SOURCE` to a checkout of the baseline. Use `BENCH_DELTA=0` on the baseline WebSocket run. Build that checkout separately before a browser baseline. `BENCH_COUNTS`, `BENCH_CASES`, `BENCH_TICKS` and `BENCH_FRAMES` allow smaller or longer runs. The browser fixture seeds a local real server through the normal match checkpoint and opens two real browser clients. It prints JSON lines beginning with `ASH_BROWSER_BENCH`.

[Baseline](baseline.jsonl) and [optimized](optimized.jsonl) contain 120 ticks each of idle, move, combat, bridge, AI and spawn/despawn churn per army size. Combat mixes ranged and melee units. The churn scenario injects one new unit and removes another per faction periodically as a synthetic workload. It does not measure a long live session with sustained internal production. Timings include both faction views and full JSON encoding every other tick for a comparable simulation measurement. Phase timings are instrumented and can overlap. For example, walk is included in approach and defender calls may be included in fight. Heap samples are taken immediately before the loop, at the end of the loop, and after eviction of garbage by a forced GC. They are not peak memory.

## Tick duration

All values are milliseconds. The server targets 20 ticks per second, giving a 50 ms tick budget.

| Troops | Move max before → after | Open combat p95 before → after | Bridge combat p95 before → after | Bridge max before → after |
| ---: | ---: | ---: | ---: | ---: |
| 200 | 55.82 → 7.45 | 2.77 → 1.24 | 2.90 → 3.90 | 23.67 → 11.93 |
| 500 | 81.42 → 6.58 | 6.28 → 2.56 | 13.16 → 6.22 | 61.39 → 13.90 |
| 1,000 | 193.74 → 12.91 | 19.05 → 6.85 | 42.17 → 16.91 | 146.12 → 24.60 |
| 1,500 | 285.64 → 12.80 | 36.14 → 12.07 | 98.16 → 35.06 | 233.41 → 61.22 |
| 2,000 | 453.18 → 24.48 | 48.57 → 15.53 | 165.19 → 58.73 | 323.95 → 88.71 |

At 1,000 units AI scenario p95 went from 16.45 to 3.92 ms and synthetic churn p95 from 22.73 to 7.03 ms. Churn still had a 54.85 ms outlier. Total AI decision time was a few milliseconds per 120 ticks and was not a main bottleneck. Object and Map allocation, defense, fog and overlapping movement costs are visible in the phase data. At 1,000 units in combat total GC time was 32.63 → 20.94 ms. Absolute post-GC heap was 8.46 → 13.40 MB, with unequal starting heaps of 8.17 and 13.34 MB. Heap growth within that sample after GC was 0.28 → 0.05 MB. These samples cannot establish that a long-running match has no leaks.

## Network

[Raw measurements](multiplayer.json) cover two genuine loopback WebSocket clients on the game server, each starting with 500 units and sending an attack-move for its full army. Both clients processed 80 snapshots and reported ranged attacks. The aggregate application payload fell from approximately 1.74 to 0.42 MB/s. The worst interval between snapshots fell from approximately 395 to 109 ms. Tick 158 arrived after approximately 8.19 seconds before and 7.92 seconds after, a short-run effective cadence of about 19.3 and 19.9 Hz. LAN loopback does not measure mobile or internet jitter.

## Implementation

- `src/server/navigation.ts` and `match.ts` use a collision-checked direct route when available. Detours share per-faction, per-radius walkability grids and queue up to 48 A* requests per tick. A new order clears any pending detour for its units. Walkability caches are rebuilt when hostile footprints change. Direct paths and the queued timing can change the paths and battle outcomes without changing unit stats or attack rules.
- `match.ts` separates spatial queries by faction and uses squared distance for range and defense gates. Friendly units and buildings remain passable and hostile buildings remain obstacles. The command cap covers a full 1,000-unit stress-test army and is not a population limit.
- `src/server/visibility.ts` adds and removes unique changed sight footprints, reference-counts each tile and caches encoding while its shade is unchanged. Recipient filtering happens before delta production.
- `src/server/rooms.ts`, `src/shared/snapshot-delta.ts` and `src/client/network.ts` negotiate compact changes, keep a base tied to the last sent frame under backpressure, and use full snapshots for new or resumed connections. A mismatched base reconnects using the existing session token. The broadcast cadence remains 10 Hz.
- `src/client/battle.ts` replaces per-frame selection ellipse tessellation with pooled ring sprites, avoids redundant property changes, simplifies health bar backgrounds and skips effect drawing outside the camera. Browser timing is reported separately from server tick timings.

## Test limits

Two assertions already fail on the unchanged baseline. PR #10 gives the Orc blade 95 HP against the Human blade's 94 despite an assertion that Orc HP is never higher, and average polearm duel margin is 12.5 points against a 10-point assertion. The balance values and assertions are preserved. See the PR and CI logs for the latest browser runs. Physical desktop/phone, browser CPU profiling, long-session leak certification and Render load measurements are outside these local measurements.
