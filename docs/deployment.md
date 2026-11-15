# HTTPS multiplayer preview

This branch contains one Node web service for the client, the simulation, and the same-origin `/socket` endpoint. When the page runs over HTTPS, the browser connects over WSS.

## Deploy the free preview

1. Open the [Render deployment page for the first-playable branch](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FTmnLuckyDev%2Ffantasy-rts%2Ftree%2Ffeat%2Ffirst-playable-rts).
2. Sign in to Render, review the single service in `render.yaml`, and confirm its plan is **Free**. The deployment requires a Render account. The repository needs no secrets.
3. When the service is live, open its HTTPS URL on both devices. Use `/healthz` to check that the Node web process is responding. The game lobby should display **Online**.
4. Use a room code or **Copy invite** to join the same match. Keep the service at one instance so both players share the same authoritative simulation.

Render handles TLS termination and [incoming WSS connections](https://render.com/docs/websocket). The [free instance may sleep when idle](https://render.com/docs/free) and take around a minute to wake up. The first open may show a startup screen. An instance restart clears in-memory matches.

When deploying manually, choose a Node web service from this repository on the branch to test. Set the build command to `npm ci --include=dev && npm run build && npm prune --omit=dev`, the start command to `npm start`, and the health check path to `/healthz`. Read `.env.example` for optional environment settings. The server binds to the platform's `PORT` and uses the same origin by default.

## Physical-device check

Use an iPhone on Safari in landscape and a desktop browser. Repeat with Android Chrome.

- Create the room on desktop, use the code on the phone, and ready both seats.
- Tap an individual troop and issue a move on the phone. Confirm movement on the phone. Repeat with desktop mouse selection and right-click. Compare movement across clients once the troops are in sight of both factions.
- Drag with one finger to box-select, drag with two fingers to pan and pinch to zoom. Tap the minimap to center the camera.
- Reload the phone page during the match. Verify it returns to the same seat with the same explored terrain.
- Verify the opposite base starts hidden on the map and minimap. Scout it, then retreat and check that terrain remains dimmed and enemy units disappear.
- Attack enemy troops, then destroy the opposing headquarters. Verify that the two screens show complementary results.
