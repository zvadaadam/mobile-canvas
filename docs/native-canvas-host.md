# The native canvas

`apps/native-host` runs real Expo/React Native code as an iOS app directly on an Apple-silicon Mac and shows a project's screens as live frames in one window. It launches no CoreSimulator device, Simulator window, framebuffer stream or input bridge. This is a development build, not a packaged product, and not a claim of pixel-identical iPhone rendering.

## What runs

The host pins Expo **54.0.37**, React Native **0.81.5**, React **19.1.0**, `@expo/ui` **0.2.0-beta.9** and `expo-glass-effect` **0.1.10**. It builds with the installed Xcode 26.1.1 and uses actual iOS 26 UIKit, SwiftUI and Liquid Glass on macOS. Beyond Expo UI and glass it links expo-image 3.0.11, expo-symbols 1.0.8, expo-haptics 15.0.8, expo-blur 15.0.8, expo-linear-gradient 15.0.8, react-native-reanimated 4.1.7 with react-native-worklets 0.5.1, react-native-svg 15.12.1, react-native-gesture-handler 2.28.0 and react-native-safe-area-context 5.6.0, so imported application code runs without replacing those imports.

Ordinary TSX, component exports, fixture props, screen context and navigation links remain canonical project data. A project opens without executing its code; `open` and `studio open` start Metro and the signed host for that project.

### Build

Install the root dependencies first, with Xcode selected and CocoaPods on `PATH`. The host has its own lockfile:

```sh
npm ci --prefix apps/native-host
npm run studio:build -- --team YOUR_TEAM_ID
npm run check:studio
npm start -- --project designs/native-studio
```

`YOUR_TEAM_ID` is an existing ten-character Apple development team. The build (`src/runtime/host/build.ts`) runs Expo prebuild and CocoaPods, then compiles and signs for the Mac's **Designed for iPad** destination, and stores the team choice, logs, build metadata and the wrapped application under ignored `.context/native-studio/`. After the first complete build, `npm run studio:build -- --incremental` copies the Swift sources and assets over the generated project and recompiles without prebuild or Pods. Adding a native module means editing the host's `package.json` and running the full build. Stop and reopen the canvas to load a new binary; project TSX edits refresh live.

Metro reads its configuration from `metro.config.cjs`, not from the host's `tsconfig.json`: the tsconfig `paths` exist only so the type check finds React's types for `packages/preview`, and `experiments.tsconfigPaths` is off in `app.json`.

## Composition

One shared Expo React host owns several Fabric surfaces registered as `ExpoCanvasScreen`. Expo's normal root delegate recreates the app root and asserts on a second surface, so the host uses Expo's exported `ExpoReactRootViewFactory.superView` path to reach React Native's multi-surface factory.

Each frame gets its own `UIWindow` in the same `UIWindowScene`, positioned over the frame's body on the canvas, scaled with the zoom and masked to the visible viewport so it cannot cover the toolbar or inspector. Its unscaled bounds equal the authored width and height; compact horizontal traits and the authored `insets` (as `additionalSafeAreaInsets`) belong to the host, so real scroll views and safe-area hooks inset exactly as inside a phone's navigation and tab bars while the project draws that chrome. Native controls receive ordinary pointer events directly.

The window boundary matters: a child view controller alone let a SwiftUI sheet cover the whole canvas, while a per-frame window confines the sheet and its glass backdrop to that screen and leaves neighboring windows interactive.

The canvas clears Expo's splash-screen loading view on each Fabric surface and restores its automatic hiding. `expo-splash-screen` customizes every root but keeps one singleton reference: otherwise earlier frames retain permanent white overlays while their React trees report ready. Canvas placeholders and receipts own loading feedback for these multiple roots.

A frame exists for every authored screen (up to 32). Its React root mounts the first time it comes within 160 points of the viewport, or when it is selected, and stays mounted so its state survives scrolling away. Readiness is judged over mounted frames; screen receipts arrive once a second plus immediately on state or navigation changes, use a bounded request timeout so a stalled connection can retry, and carry recent console warnings and errors because the on-screen LogBox banner is disabled.

## The window

The toolbar holds the wordmark and project name, **New screen**, undo and redo, the **Screens** menu, pan, flow, arrange and fit, the zoom controls, the inspector toggle and **Agent**. Each frame shows its name above it; the name selects on click and drags the frame, and its font and the frame's border are counter-scaled so they keep one screen size at any zoom. Selection turns the name and border blue and shows the frame's dimensions. Flow connectors are drawn beneath the frames from each screen's `links`. The status bar reports readiness from the runtime's receipts with a colored dot; the inspector edits a screen's name, position, props and context through the same transaction endpoint agents use, and can show source, reset one frame's mock state or duplicate the frame.

Shortcuts: `⌘+`, `⌘−` and `⌘0` zoom, `⇧⌘1` fits all screens, `⇧⌘I` toggles the inspector. Dragging the background pans; the pan toggle also allows dragging over screens. `⇧⌘2` fits the selected frame.

Opening with `--screen <key>` (MCP `canvas_studio_open` with `screen`) makes the runtime send a focus command once the host has laid out its frames; the host then fits that whole frame inside the viewport. A first pointer click on an unselected frame focuses it; subsequent clicks interact with native content.

## Agent evidence and lifecycle

`canvas_studio_state` separates host connection from screen readiness: `ready` requires current, fresh, error-free receipts for every mounted frame. Commands return acceptance; later `acknowledged` values prove the host consumed them. All mutations keep the workspace and sequence checks, source writes keep prior hashes, and host UUIDs reject receipts from older sessions.

The launcher (`src/runtime/host/launch.ts`) preflights the Metro bundle so dependency failures become visible errors before an empty window opens, owns only its Metro processes and the verified native PID, and tolerates slow runtime answers (four seconds, five misses) because one busy runtime answer must not end the session. Reopening brings the existing window forward. A scoped ProcessInfo activity keeps the canvas out of App Nap while allowing normal idle sleep.

`studio capture` first asks the host to render itself: it draws its window and every mounted frame window with UIKit's snapshot API and posts the PNG to the runtime (a sandboxed iOS-on-Mac app cannot write into the project). That path is independent of screen-recording permission and of which Space the window sits on, and reports `method: "host"`. Natively presented SwiftUI sheets live in separate compositor windows and are not part of that image, so ScreenCaptureKit (`capture.swift`, compiled on demand) remains the fallback and the way to inspect a presented sheet. A capture shows the current viewport, not every offscreen frame. Native computer tools provide pointer and keyboard interaction; there is no synthetic touch MCP tool.

## Proven versus remaining

Verified on this Mac: 25 concurrently authored frames of a linked app with lazy mounting; native switches, stepped sliders, buttons, moving backdrops under Liquid Glass, contained sheets, neighboring input during presentation, pan, zoom and clipping, frame moves and undo, navigation focus with flow pulses, arrange, per-frame theme scoping, current source and fixture edits with undo, and image capture through MCP. See [validation](validation.md).

Still to establish:

- A same-fixture comparison with an actual iPhone runtime: controls, text, safe areas, keyboards, navigation and tab bars, glass. Direct iOS-on-Mac execution is native, but Apple documents platform-specific behavior; exact iPhone fidelity is **not verified**.
- Arbitrary app compatibility. Global `Dimensions`, module singletons, keyboard and lifecycle remain host-wide; projects scope theme tokens and `useWindowDimensions` per frame in shims. Native tabs, navigation bars and Expo Router presentations have no host equivalent.
- Multiple concurrent modal types, text input focus, rotation, very large boards, multi-monitor captures, and measured input-to-paint latency and resource use.
- Packaging, distribution, project-specific native dependencies and Android.

## References

- [Apple: running iOS apps on Macs](https://developer.apple.com/videos/play/wwdc2020/10114/)
- [Expo SDK 54](https://expo.dev/changelog/sdk-54)
- [React Native root-view factory](https://github.com/facebook/react-native/blob/v0.81.5/packages/react-native/Libraries/AppDelegate/RCTRootViewFactory.mm)
