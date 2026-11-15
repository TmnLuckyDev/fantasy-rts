# Engine and architecture

## Decision

Ash & Iron uses Phaser 3.90, TypeScript, Vite, Node 22 and the `ws` WebSocket library.

[Unity 6 documents](https://docs.unity.com/en-us/engine/6000.0/manual/platform-specific/webgl/intro/browsercompatibility) support for iOS Safari 15+ and Android Chrome 58+. Desktop Web support requires WebGL 2 and WebAssembly. Older mobile browser versions can have performance or startup issues. Unity's [web networking documentation](https://docs.unity.com/en-us/engine/6000.0/manual/platform-specific/webgl/develop/networking) also describes browser limitations on .NET IP socket APIs. A Unity implementation is viable with adequate device testing and a browser-compatible transport.

[Phaser targets desktop and mobile browsers](https://phaser.io/oss/docs/phaser/getting-started/what-is-phaser), supports Canvas and WebGL, and lets this game use browser Pointer Events for touch and DOM elements for the HUD. Phaser lets us share map, unit and message types between the browser and server. These advantages fit the mobile 2D prototype and preserve the engine choice in the repository's initial README. The initial README proposed Colyseus. For a two-seat, single-process prototype, the implementation uses a small `ws` room layer.

## Client and server

- `src/shared/` defines the map, faction and unit data, and wire message shapes. The map stores tiles and base positions in a map definition that the simulation consumes.
- `src/server/match.ts` owns unit positions, hit points, cooldowns, projectiles, path requests and the outcome. It advances in fixed 50 ms steps. Orders are applied by the server to the owning faction's units.
- `src/server/navigation.ts` calculates A* routes and checks terrain and headquarters footprints. Units use local steering to avoid one another when following those routes.
- `src/server/rooms.ts` manages seats, lobby readiness, match lifetimes and reconnection tokens. It sends faction-specific snapshots at 10 Hz. Each match is separate from its network sessions, so later spectator support can subscribe without granting command rights. A larger roster of players would also need team ownership and room-capacity changes.
- `src/server/index.ts` serves the Vite build and handles WebSocket upgrades, message limits and liveness checks. `validate.ts` parses inbound messages before gameplay ownership and bounds checks.
- `src/client/` handles input, connection state, sprite rendering and the interface. Sprite positions blend toward the latest snapshot. The client issues orders and displays server results.
- `tests/` covers the rules, real WebSocket exchange and browser match flow. CI runs checks on GitHub-hosted runners.

The server tracks unexplored, explored and currently visible tiles for each faction. Snapshots include its sight mask, its own stockpile and population, and entities and effects it can see. The client uses the same mask on the battlefield and minimap. Static terrain is defined in the shared map, and the server validates attack targets, construction sites and gathering orders against faction sight. Rooms require one live process. A future multi-process deployment will need room routing and a single owner for each simulation.
