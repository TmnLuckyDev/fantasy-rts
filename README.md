# Ash & Iron

A browser RTS for solo skirmishes or 1v1 multiplayer with the blue Human Kingdoms and the red Orcish Horde. Under the default rules, both players start with six combat units, three workers, 300 gold, 180 wood, 120 stone and a headquarters. Destroy the opposing headquarters to win. Ashford Crossing Expanded remains the default battlefield.

## Play

Open the game in your browser and choose a faction.

- **Play vs Computer** starts a solo skirmish immediately. The computer gathers, builds, trains and attacks with the opposing faction.
- **Create room** starts a multiplayer lobby. Share the invite or five-character code, then both select **Ready**.

During a match:

1. Select a worker or use **Idle worker** to cycle through workers without orders. Use **Mine gold**, **Chop wood** or **Quarry stone** to go to the closest explored source, or target a source directly. Workers carry each load back to their hall and repeat the trip.
2. Select a worker, select **Build**, choose a building and place it on visible, open ground. Buildings use wood and stone, and walls use stone. The worker walks to the site and constructs it. If the builder leaves, assign a worker to the unfinished site to resume.
3. Select a completed production building to see the available units and train them directly. Training costs gold and reserves population. Enemy walls and other enemy buildings block ground movement. Units can pass through one another and through their own buildings. Completed towers fire at nearby enemies.
4. Scout across one of four bridges to find the enemy headquarters and destroy it. Terrain stays on the map after exploration. Enemy troops and buildings disappear when they leave your sight.

| Human structure | Orc structure | Training |
| --- | --- | --- |
| Town Hall | Great Hall | Peasant / Peon |
| Barracks | War Barracks | Footman and Pikeman / Grunt and Cleaver |
| Archery Range | Hunting Grounds | Archer and Crossbowman / Spearman and Axe Thrower |
| Stables | Ogre Den | Knight / Ogre |

**Queues** lists construction, training and research progress. Blacksmiths and War Forges can research +2 troop damage and +1 troop armor for their faction.

Nearby troops counterattack when an allied unit or building is hit. They break off if the attacker retreats beyond the defended area. An explicit move or attack order takes priority.

Select a completed building and choose **Repair** to send the closest idle worker. You can also select workers and right-click or tap a damaged friendly building. Each repair step restores up to 20 HP for 1 wood and 1 stone. Walls use 1 stone per step. A worker stops when the building is fully repaired or materials run out. Choose **Demolish** to remove another completed building after confirming. Demolition has no refund. Your headquarters is protected from demolition.

## Battlefield shortcuts

- The troop bar follows your live army. Tap a type or **All troops** to select it. Tap the active group again to center the camera. Groups include reinforcements automatically and **All troops** excludes workers.
- **Recruit** orders units from your finished production buildings. The server distributes them by existing workload, then applies the normal cost and population rules. Completion times are estimates. **Queues** still shows each building's work.
- Attack alerts show where your forces took damage. Tap the alert or its minimap ping to focus the camera. Nearby alerts merge and attacks on headquarters take priority. The **Sound** button also mutes alert audio.
- Select troops, open the formation button and choose **Line**, **Compact** or **Spread**. The next move or attack uses that formation. Melee ranks face the target with ranged ranks behind. Units take individual routes through chokepoints and form up at the destination when terrain permits.

## Battlefields

| Battlefield | Size | Terrain |
| --- | --- | --- |
| Ashford Crossing Classic | 88 × 40 | A central river and two bridges |
| Ashford Crossing Expanded | 176 × 80 | A wider map with four bridges |
| Pinewatch Vale | 112 × 64 | Forest pockets and broad, open lanes |
| Ironbreak Pass | 144 × 72 | A central ridge with three passages |
| Twinmere Basin | 160 × 88 | Lakes, a central river and three crossings |

## Scouting and explored construction

Train a **Scout** from your Town Hall or Great Hall for 85 gold. Scouts are fast, lightly armored and have a large sight radius. Select one or more scouts and tap **Explore** to automatically seek unexplored walkable terrain. Issue a normal movement or Stop command to cancel exploration. Scouts are included in the troop bar.

Use **Production** to switch between Recruit, Upgrades and Queues. A tap outside closes the panel. Select a visible gold mine or stone quarry to see its remaining stock. With workers selected, **Gather here** sends them to that deposit.

Workers can place buildings on terrain already explored, even when it is currently under fog of war. Completely unexplored tiles remain unavailable. Building collision footprints are smaller than the artwork, allowing closer construction while preserving the original headquarters footprint. Placement outlines show the actual reduced footprint.

## Match settings and results

Use **Match settings** before creating an online room or starting a new solo match. The online host can also edit the settings in the lobby. Both players can review the final rules before readying up. A change in the lobby clears both ready states. Solo saves retain the settings they started with.

- Select a battlefield and set the number of gold mines, stone quarries and tree tiles per side.
- **Random starting positions** is on by default. Each new match selects a clear start on the Human side and mirrors it for the Orcs at the other end of the map. Each resource type enabled in the rules has a reachable source within 4.5 tiles of both headquarters. Turn random starts off for fixed positions. Checkpoints retain the original terrain and starting positions.
- Set stock and active workers per source separately for gold, stone and wood. Leave either field blank for unlimited. Excess workers wait for a slot, and spent sources remain on the terrain but can no longer be harvested.
- Set starting gold, wood and stone for both sides. Leave the time field blank for an unlimited match. For timed matches, the clock advances with the simulation and pauses with the match.
- At the time limit, the score is one point per banked gold, wood or stone and 100 points per surviving soldier or hero. Ties draw. The loss of a headquarters still decides the game if it occurs by the last tick.
- The results show resources delivered, troops trained, buildings completed and razed, enemy units killed, losses, surviving army and score for both sides. The totals exclude starting units and resources. Old saves begin counting activity from the update.

## Heroes

The Town Hall recruits Aldren the Warden or Nera the Pathfinder. The Great Hall recruits Gorak Ironhand or Vesha Emberbow. Each side can field or train one hero at a time. The vanguard defends at melee range, while the pathfinder scouts and attacks at range. Either costs 225 gold and one population slot.

Your hero gains XP from nearby enemy defeats, including allied kills. Select your hero to see XP and combat stats. **Find hero** in the headquarters menu centers the camera on your hero. Heroes can reach level 5, with 14 more max HP and 2 more damage per level. Recruiting the same hero again retains its match XP. Solo checkpoints and multiplayer reconnect preserve XP within the match.

The headquarters supports 10 population. A completed Farm or Boar Farm adds ten. Total population capacity grows with every farm. Workers and most troops use one slot. Knights and Ogres use two. If a farm is destroyed, fielded units stay in play and production waits for enough capacity.

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click a troop or drag a box. Shift adds to selection. | Tap a troop or drag a box with one finger. |
| Move or attack | Right-click the ground or an enemy. | With troops selected, tap the ground or an enemy. |
| Attack-move | Press **A** or select **Attack move**, then choose a destination. | Select **Attack move**, then tap a destination. |
| Pan and zoom | Arrow keys, minimap and mouse wheel. | Two-finger pan, pinch and tap or drag on the minimap. Play in portrait. |
| Other orders | **Q** selects all troops, **S** stops them, **H** centers on your base. | **All troops**, **Stop** and **Base** on the command bar. |

Solo matches run in the browser and save progress on that device. Reload the same tab to resume or use **Resume solo match** in the lobby. Switching away from the tab pauses the match. Multiplayer matches pause until disconnected players return. Multiplayer rooms live in server memory and are cleared when the process restarts. **Leave** ends a solo match and forfeits a multiplayer match.

## Preview and development

### Browser-only access

Open [Ash & Iron](https://ash-and-iron.onrender.com/) in their browsers. For a separate instance, see [deployment and the device checklist](docs/deployment.md).

### Local preview

On a development machine with Node 22.12 or newer:

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. For multiplayer, use two separate tabs or browser profiles. For a phone on the same trusted Wi-Fi network, both devices can open `http://<development-machine-LAN-IP>:3000` if the network and firewall permit it. Use the HTTPS preview for internet play.

`npm run dev` starts Vite on port 5173 and the authoritative server on port 3000 with source reloads. Vite forwards `/socket` and `/healthz` to the server. Set `RTS_API_PORT` if port 3000 is in use.

```bash
npm run check
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:browser
MOBILE_BROWSER=webkit npm run test:browser
```

The browser test uses Chromium desktop against a portrait touch profile. The default profile is Android Chrome on Chromium. The WebKit variant uses iPhone 14 viewport and touch settings on Linux. Test profiles are emulation. [Architecture and engine decision](docs/architecture.md).

## Current scope

The skirmish includes five combat unit types per faction, attack-move, A* navigation around obstacles, formations, projectile and damage effects, minimap, room codes, reconnects, and headquarters victory. Original voxel-inspired terrain, props, faction buildings and unit sprites are drawn with Canvas, and the lobby uses an original generated diorama illustration. Sound effects are synthesized with Web Audio.

Upgrades and other maps are planned.

## Batch production and restart recovery

Each tap on a unit adds one to its building’s training queue, pays its cost and reserves farm capacity. **Cancel last** removes the last unspawned unit and refunds its cost. If the building is destroyed, its reserved capacity is released and its gold is lost. Select an unfinished foundation to cancel it and recover the unbuilt fraction of its cost.

For multiplayer saves, set `MATCH_SAVE_FILE` to a writable file on durable storage, owned by the game server. Create its parent directory before starting. The server writes a versioned checkpoint every five seconds and flushes on graceful shutdown. An abrupt interruption can roll the game back to the latest checkpoint. Seats reconnect with their original tokens. The default Render deployment does not configure durable storage.

Run `node scripts/benchmark.mjs` for the headless simulation load fixture and `node scripts/ai-league.mjs . 100 normal,normal` to compare computer opponents. The first positional argument accepts a checkout directory, so the same league can run against an earlier revision.

## Quality of life load test

Node simulation on the development runner, 160 ticks per case. Tick timings include simulation and per-side snapshots. These are single-run measurements. The reference is main at `5c6b548` using its previous group placement. The feature branch uses one authoritative Line order per side. Counts are total across both sides.

| Troops | Move p95, main → Line | Combat p95, main → Line | Bridge p95, main → Line |
| ---: | ---: | ---: | ---: |
| 100 | 0.98 → 0.66 ms | 0.73 → 0.75 ms | 0.85 → 0.82 ms |
| 250 | 0.97 → 1.07 ms | 1.14 → 1.30 ms | 2.71 → 1.80 ms |
| 500 | 2.62 → 1.59 ms | 2.62 → 2.77 ms | 6.77 → 6.72 ms |
| 1,000 | 3.42 → 3.76 ms | 6.65 → 6.26 ms | 22.17 → 25.23 ms |

For 1,000 troops, issuing both Line commands measured 0.70–1.03 ms total. The slowest Line bridge tick was 67.20 ms (78.37 ms on main). Spread at 1,000 troops measured p95 of 9.58 ms moving, 11.01 ms fighting and 23.86 ms at the bridge. Its slowest combat tick was 88.85 ms. The 20 Hz simulation has a 50 ms budget per tick. These spike measurements and headless browser runs do not measure physical phone performance.

Reproduce the Line sample with `BENCH_FORMATION=line BENCH_COUNTS=100,250,500,1000 BENCH_CASES=move,combat,bridge BENCH_TICKS=160 node --expose-gc scripts/benchmark-armies.mjs`. Omit `BENCH_FORMATION` and set `BENCH_SOURCE` to a worktree at the main reference for the baseline.
