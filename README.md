# Ash & Iron

A browser RTS for solo skirmishes or 1v1 multiplayer with the blue Human Kingdoms and the red Orcish Horde. Both players start with six combat units, three workers, 300 gold, 180 wood, 120 stone and a headquarters on Ashford Crossing, a 176 × 80 map mirrored by rotation. Destroy the opposing headquarters to win. New matches use the expanded map. Saved matches on the original 88 × 40 map continue there.

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

## Heroes

The Town Hall recruits Aldren the Warden or Nera the Pathfinder. The Great Hall recruits Gorak Ironhand or Vesha Emberbow. Each side can field or train one hero at a time. The vanguard defends at melee range, while the pathfinder scouts and attacks at range. Either costs 225 gold and one population slot.

Your hero gains XP from nearby enemy defeats, including allied kills. Select your hero to see XP and combat stats. **Find hero** in the headquarters menu centers the camera on your hero. Heroes can reach level 5, with 14 more max HP and 2 more damage per level. Recruiting the same hero again retains its match XP. Solo checkpoints and multiplayer reconnect preserve XP within the match.

The headquarters supports 10 population. A completed Farm or Boar Farm adds ten. Total population capacity grows with every farm. Workers and most troops use one slot. Knights and Ogres use two. If a farm is destroyed, fielded units stay in play and production waits for enough capacity.

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click a troop or drag a box. Shift adds to selection. | Tap a troop or drag a box with one finger. |
| Move or attack | Right-click the ground or an enemy. | With troops selected, tap the ground or an enemy. |
| Attack-move | Press **A** or select **Attack move**, then choose a destination. | Select **Attack move**, then tap a destination. |
| Pan and zoom | Arrow keys, minimap and mouse wheel. | Two-finger pan, pinch and minimap. Landscape gives the widest view. |
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

The browser test uses Chromium desktop against a landscape touch profile. The default profile is Android Chrome on Chromium. The WebKit variant uses iPhone 14 viewport and touch settings on Linux. Test profiles are emulation. [Architecture and engine decision](docs/architecture.md).

## Current scope

The skirmish includes five combat unit types per faction, attack-move, A* navigation around obstacles, formations, projectile and damage effects, minimap, room codes, reconnects, and headquarters victory. Original voxel-inspired terrain, props, faction buildings and unit sprites are drawn with Canvas, and the lobby uses an original generated diorama illustration. Sound effects are synthesized with Web Audio.

Upgrades and other maps are planned.

## Batch production and restart recovery

Each tap on a unit adds one to its building’s training queue, pays its cost and reserves farm capacity. **Cancel last** removes the last unspawned unit and refunds its cost. If the building is destroyed, its reserved capacity is released and its gold is lost. Select an unfinished foundation to cancel it and recover the unbuilt fraction of its cost.

For multiplayer saves, set `MATCH_SAVE_FILE` to a writable file on durable storage, owned by the game server. Create its parent directory before starting. The server writes a versioned checkpoint every five seconds and flushes on graceful shutdown. An abrupt interruption can roll the game back to the latest checkpoint. Seats reconnect with their original tokens. The default Render deployment does not configure durable storage.

Run `node scripts/benchmark.mjs` for the headless simulation load fixture and `node scripts/ai-league.mjs . 100 normal,normal` to compare computer opponents. The first positional argument accepts a checkout directory, so the same league can run against an earlier revision.
