# Ash & Iron

A 1v1 browser RTS with the blue Human Kingdoms and the red Orcish Horde. Both players start with six troops and a headquarters on Ashford Crossing, a hand-designed map mirrored by rotation. Destroy the opposing headquarters to win.

## Play the first build

A game needs one running Node service. Both players open its URL, then:

1. Choose a faction and select **Create room**.
2. Send the opponent the invite link or five-character code. The opponent selects **Join** and receives the available faction.
3. Both select **Ready**. The match starts with the same map and state for both sides.
4. Move your army across either bridge and attack the enemy headquarters.

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click a troop or drag a box. Shift adds to selection. | Tap a troop, or enable **Box select** and drag across the troops. |
| Move or attack | Right-click the ground or an enemy. | With troops selected, tap the ground or an enemy. |
| Attack-move | Press **A** or select **Attack move**, then choose a destination. | Select **Attack move**, then tap a destination. |
| Pan and zoom | Arrow keys, minimap and mouse wheel. | Two-finger pan, pinch and minimap. Landscape gives the widest view. |
| Other orders | **Q** selects all troops, **S** stops them, **H** centers on your base. | **All troops**, **Stop** and **Base** on the command bar. |

Reloading the same tab can recover a lost seat within 45 seconds. The match continues while a player reconnects. Leaving a running match forfeits it. Rooms live in server memory and are cleared when the process restarts.

## Preview and development

### Browser-only access

For an internet test between separate devices, deploy the first-playable branch using the [free Render blueprint](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FTmnLuckyDev%2Ffantasy-rts%2Ftree%2Ffeat%2Ffirst-playable-rts). The account owner completes the Render review screen and chooses the **Free** plan. Render then supplies one HTTPS URL for both players. There is no phone installation. See [deployment and the device checklist](docs/deployment.md).

### Local preview

On a development machine with Node 22.12 or newer:

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:3000` in two separate tabs or browser profiles. For a phone on the same trusted Wi-Fi network, both devices can open `http://<development-machine-LAN-IP>:3000` if the network and firewall permit it. Use the HTTPS preview for internet play.

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

## First playable scope

The skirmish includes three troop types per faction, attack-move, A* navigation around obstacles, formations, projectile and damage effects, minimap, room codes, reconnects, and headquarters victory. Art uses original canvas-drawn terrain, props, buildings and sprites, plus original generated title art. Sound effects are synthesized with Web Audio.

The next milestone adds workers, gold and lumber, construction, and training. The remaining rosters, upgrades, fog of war, computer AI, and additional maps follow in later milestones.
