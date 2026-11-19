# Ash & Iron mobile builds

## Architecture review

The browser build uses Vite to package Phaser, the UI, the maps and the solo worker. The worker runs the same TypeScript match engine and AI used on the server. Solo and Practice do not need a server. Audio is synthesized with Web Audio and the terrain, sprites and cover art are local.

A native WebView needs a stable local origin for saves and asset loading. The browser derives its WebSocket and invite URLs from the current page. Inside Capacitor those URLs need an explicit HTTPS backend, and the backend must recognize the packaged app origins. The local frontend and the network backend have separate build settings.

The operating system can suspend a WebView during a match. Solo must retain its checkpoints and pause state, while multiplayer must reconnect with its existing seat token. The native back gesture and system bars also need handling at the platform boundary.

## Requirements

| Platform | Tools |
| --- | --- |
| Browser | Node.js 22.12 or newer and npm. Playwright is optional for local browser testing. |
| Android | JDK 21, Android Studio Otter 2025.2.1 or later, Android SDK Platform 36, Build Tools 35.0.0 and Platform Tools. Set `ANDROID_HOME` to the SDK path. The app supports Android API 24 and later. |
| iOS | A Mac with Xcode 26 or later, the iOS simulator runtime and Xcode command-line tools. Capacitor 8 targets iOS 15 and later. Xcode resolves the Capacitor Swift package on its first build. |

Run `npm ci` from the repository root. The native projects use Capacitor 8.6.2 and the app ID `com.ashandiron.game`. They package the files built into `dist/mobile`, including the solo worker and shared game assets. The native projects contain no remote start URL.

## Browser

- `npm run dev` starts the existing development servers.
- `npm run build:web` builds just the web frontend into `dist/client`.
- `npm run build && npm start` runs the existing combined production build locally, including the multiplayer server. Render uses this same build.

## Android

1. Run `npm run android:sync` to build and copy the web game into the Android project.
2. Run `npm run android:open` or open the `android/` folder in Android Studio. Let Gradle sync.
3. Choose either an emulator or a phone with USB debugging enabled. Run the `app` configuration from Android Studio, or use `npm run android:run` to pick a target from the terminal.
4. To produce a debug APK, run `npm run build:android`. Install it on a connected phone with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. Alternatively transfer the APK to the phone and let Android install the file, when prompted.

The APK uses Android's normal debug signing. GitHub Actions publishes the debug APK under **Ash-and-Iron-Android-debug** in the mobile workflow's Artifacts section. The Gradle wrapper is versioned with the native project. Built APKs and copied web files are ignored. Android requires the same signing certificate to install over an existing app. If you switch between CI and local debug builds, uninstalling the old build may be necessary and will remove its local solo save.

## iOS

1. Install Xcode and an iOS simulator runtime. If needed, select the full Xcode install with `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`.
2. Run `npm ci` and `npm run build:ios` on the Mac. This produces an unsigned simulator app under `ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`.
3. Run `npm run ios:open` and choose an iPhone simulator in Xcode, then press Run. If you want to rebuild assets only, use `npm run ios:sync`. You can also run `npm run ios:run` to choose a target with the Capacitor CLI.
4. For a physical iPhone, connect and trust it, enable Developer Mode, and select it in Xcode. Set your Apple team in **App → Signing & Capabilities** and enable automatic signing. For personal testing you may need a bundle ID unique to your Apple account. TestFlight and App Store distribution require an Apple Developer Program membership and distribution signing.

The native projects request portrait orientation. Verify safe areas on phones with a display cutout and on Android with both gesture and three-button navigation. Android 16 can override portrait requests on large screens. The existing mobile web layout still prompts for portrait, and a landscape layout remains future work.

## Multiplayer and environments

Mobile builds default to `https://ash-and-iron.onrender.com`. Set `VITE_MOBILE_SERVER_URL` in `.env.mobile.local` to use a different HTTPS origin, then rebuild and sync. The value is public in the compiled app. Use an HTTPS staging server, a development endpoint with a trusted TLS certificate, or the existing production hostname. The mobile client derives the WSS address at `/socket` and shares the backend's browser lobby URL when copying a room invite.

The server in this branch accepts both packaged app origins, `https://app.ashandiron.localhost` and `capacitor://app.ashandiron.localhost`. It retains the existing same-origin and `ALLOWED_ORIGINS` rules for browser and custom installations. If testing against an older server build, include both app origins in its existing `ALLOWED_ORIGINS` list or use a server built from this branch. Preserve any other origins already configured. The production Render service and its settings are outside this change.

All clients use the same match protocol and seat-recovery tokens. While a mobile app is inactive it closes its socket. On return it reconnects with its seat token within the server's normal grace period. Closing or force-stopping the app may end the session, just as closing a browser tab can.

## Offline play, saves, and updating the apps

Solo and Practice run from packaged files. Solo checkpoints keep the existing version 1 format, with browser storage isolated to the stable app origin. The phone and browser each have a separate local save. App upgrades can retain a checkpoint if the app ID and local origin stay the same. Clearing app data or uninstalling can remove the checkpoint. An abrupt process kill can lose progress since the last checkpoint. Backgrounding requests a checkpoint and pauses the simulation independently of the in-match pause button.

Worker execution remains the default. If WKWebView reports an error before the worker starts, iOS loads the same solo runtime on the UI thread. Benchmark large armies on affected devices if this fallback is used. The app resumes previously unlocked audio when possible and retries after the next user gesture if the OS blocks resume.

After updating the shared source, run the usual web build, then the sync or build command for each native platform. Reinstall a new APK or rerun from Xcode to get the updated bundle on the device.

## Validation

Local checks use `npm run check`, `npm test`, `npm run build`, `npm run test:browser` and `MOBILE_BROWSER=webkit npm run test:browser`. The browser offline test loads the web files, blocks the game socket, and verifies that solo can pause, resume and reopen from a checkpoint. WebSocket integration tests use both packaged origin headers and exercise match start, snapshot delivery and seat recovery. They also check that unrelated and opaque origins remain rejected.

The mobile workflow builds a debug APK and runs the native Android WebView solo smoke test in airplane mode. It builds the iOS simulator app and uses XCUITest to tap through solo, pause, resume and relaunch against an unreachable multiplayer endpoint. Physical-device testing still needs to cover Android and iPhone touch gestures, backgrounding and process restart, speaker and mute behavior, and complete cross-platform matches against a backend that accepts the app origins.

For performance, run `BENCH_COUNTS=25,50,100,250,500 BENCH_CASES=move,combat,bridge node scripts/benchmark-armies.mjs` for reproducible simulation timings. To compare native and browser frame rate, memory and touch latency, repeat the same scenarios on the same hardware using Android Studio's profiler or Xcode Instruments and Web Inspector. The Node timings measure engine ticks and snapshot work rather than WebView rendering.

Store submission also needs the final signing and store metadata, privacy declarations, and device testing on both platforms.
