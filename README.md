# Ash & Iron

A browser RTS for solo skirmishes or 1v1 multiplayer with the blue Human Kingdoms and the red Orcish Horde. Both players start with six combat units, three workers, 300 gold, 180 wood, 120 stone and a headquarters on Ashford Crossing, an 88 × 40 map mirrored by rotation. Destroy the opposing headquarters to win.

## Play

Open the game in your browser and choose a faction.

- **Play vs Computer** starts a solo skirmish immediately. The computer gathers, builds, trains and attacks with the opposing faction.
- **Create room** starts a multiplayer lobby. Share the invite or five-character code, then both select **Ready**.

During a match:

1. Select **Workers**, then right-click or tap a mine for gold, trees for wood, or a marked quarry for stone. Workers carry each load back to their hall and repeat the trip.
2. Select a worker, choose **Build** and place a structure on visible, open ground. Buildings use wood and stone, and walls use stone. The worker walks to the site and constructs it. If the builder leaves, assign a worker to the unfinished site to resume.
3. Select a completed production building, then **Train**. Training costs gold and reserves population. Walls block ground movement. Completed towers fire at nearby enemies.
4. Scout across either bridge to find the enemy headquarters and destroy it. Terrain stays on the map after exploration. Enemy troops and buildings disappear when they leave your sight.

| Human structure | Orc structure | Training |
| --- | --- | --- |
| Town Hall | Great Hall | Peasant / Peon |
| Barracks | War Barracks | Footman and Pikeman / Grunt and Cleaver |
| Archery Range | Hunting Grounds | Archer and Crossbowman / Spearman and Axe Thrower |
| Stables | Ogre Den | Knight / Ogre |

Nearby troops counterattack when an allied unit or building is hit. They break off if the attacker retreats beyond the defended area. An explicit move or attack order takes priority.

The headquarters supports 10 population. A completed Farm or Boar Farm adds five, up to 30. Workers and most troops use one slot. Knights and Ogres use two. If a farm is destroyed, fielded units stay in play and production waits for enough capacity.

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click a troop or drag a box. Shift adds to selection. | Tap a troop or drag a box with one finger. |
| Move or attack | Right-click the ground or an enemy. | With troops selected, tap the ground or an enemy. |
| Attack-move | Press **A** or select **Attack move**, then choose a destination. | Select **Attack move**, then tap a destination. |
| Pan and zoom | Arrow keys, minimap and mouse wheel. | Two-finger pan, pinch and minimap. Landscape gives the widest view. |
| Other orders | **Q** selects all troops, **S** stops them, **H** centers on your base. | **All troops**, **Stop** and **Base** on the command bar. |

Reloading the same tab can recover a lost seat within 45 seconds. Multiplayer matches continue during a reconnect. Solo matches pause while the player's connection is lost. Leaving a multiplayer match forfeits it. Leaving a solo match closes it. Rooms live in server memory and are cleared when the process restarts.

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
