# Mobile Canvas

Read `goal.md` and `docs/architecture.md` before changing the product model.

## Product

- This is a local canvas for designing real Expo interfaces. Actual native iOS controls and Liquid Glass are essential in the design view. The screens must run in a real iOS runtime; the Swift shell around them is thin (arranging frames, inspector, capture). Never propose an Electron or browser canvas, and never substitute web imitations for native controls.
- The native canvas window owns screen arrangement, context, fixture editing, history and agent connection. CLI and MCP adapt the same loopback runtime. An optional embedded MCP App may review the sitemap and real native captures; native interaction and editing stay in the Mac window. No agent chat, no hidden generation loop, no accounts, media generation or cloud storage.
- Ordinary Expo TSX is the source of truth. Preview props and shared components let agents compare states without production services. Each screen carries `notes` (purpose, mock states, interactions, destinations) and `links`; preserve both through moves, metadata edits and undo.
- Screen `links` are the app's flow on the canvas: keep them to navigation a component performs from its content (not tabs or back), so the Flow connectors, navigation pulses and Arrange describe the real app. The user wants a visible hierarchy, not lines everywhere: forward edges solid, backward edges dashed, variants in their own band.
- Existing-codebase exploration is a primary use case. Prefer `import --link`: the app's source runs in place and `lib/` holds only overrides keyed by app path; the user does not want the codebase replicated. Never modify the original app during an experiment; `apply` carries chosen files back only on the person's explicit request. Design directions are scoped objects the app's primitives read, never global swaps.
- Existing-app regressions come from pinned GitHub URLs in `tests/compatibility/apps.json`: Expo Hot Chocolate (`https://github.com/expo/hot-chocolate`) and Nathan Schroeder’s Clarity (`https://github.com/SchroederNathan/clarity`) are the native drop-in references; Expo Workout remains a source-only mapping regression. Clone/fetch apps into gitignored `.context/`, never check exported app projects or app-specific adapters into `designs/`. See `docs/compatibility.md` for pinned checkout and native setup commands. The former `designs/workout` export was deliberately removed; do not recreate it.

## Engineering

- Runtime code lives in `src/runtime`, shared contracts in `src/shared`, language analysis in `src/runtime/adapters/{expo,swift}`, and the shared Swift shell in `packages/native-canvas`. `apps/native-host` owns the Expo renderer/template, `apps/linked-host` the linked Expo integration, `apps/swift-host` the Swift renderer, and `packages/preview` the React preview hooks. Everything is TypeScript except what must not be: the `bin` entry, CommonJS Metro/plugin code, and native Swift code.
- The native app, CLI and MCP share one runtime and one typed command executor. Mutations carry `workspaceId` and `sequence`; one batch is one undoable transaction; source writes check the prior hash. Keep the runtime loopback-only, and never run project code merely because a project was opened; `open` and `studio open` are the explicit steps.
- `apps/native-host` pins Expo 54 / React Native 0.81 / `@expo/ui` 0.2.0-beta.9 for the installed Xcode. Adding a native module means editing its `package.json` and a full `studio:build`; Swift and asset changes need only `--incremental`, then stop and reopen the canvas.
- Metro resolution for a project: `resolver.aliases` and `resolver.modules` apply only to the project's (or linked app's) own code, packages keep their real dependencies, and a bare import that would fall through to another SDK fails with a clear error. Metro caches resolutions per origin directory, so a shim that wraps the module it replaces lives alone in its directory and imports the bare name, or imports a subpath. Never `export *` from `react-native`; forward lazily. Changing the resolver needs a canvas reopen; studio state reports `resolverCurrent`.
- Global module singletons are the main leak between frames: theme tokens, `useWindowDimensions`, routers. Scope them per frame. Device chrome and safe-area `insets` are authored per screen; the host applies insets natively, the project draws the chrome.
- Captures render inside the host and fall back to ScreenCaptureKit; never assume a capture path works without checking the returned image. Native popups need an obvious close action usable with a Mac pointer. The launcher must tolerate slow runtime answers or it kills the host.
- Run the runtime and open the canvas yourself when changing the host or resolver, and verify pixels as well as receipts. Do not kill unrelated simulators, Metro servers or agents. Nothing is committed unless the user asks.

## Look

- The canvas follows Expo's light interface: the Mobile Canvas text wordmark and bundled Inter Medium, neutral surfaces with hairline borders, a black primary pill, blue only for selection and focus. Frame names sit above the frames and stay readable at every zoom; borders stay one screen pixel. Keep authored mobile app styling independent of the canvas chrome. See `docs/design-system.md`.

## Compatibility regression

- When changing route discovery, pager/guard analysis, arrangement, the resolver or native host, run `npm test`, `npm run check` and `npm run test:compat` against the pinned three-app corpus. See `docs/compatibility.md`.
- For host/resolver changes, also run `npm run test:compat:native` after explicitly opening the listed native experiments, inspect the returned images, and report missing states or unavailable services separately from crashes. Captures passing is not complete visual-fidelity proof.
- External contributors can run `npm run test:compat:public` without private repository access; maintainers still run the full three-app corpus above. Private Swift regression reads its checkout from `CANVAS_TEST_BETTERMIND`; repository-owned Swift fixtures are part of `npm test`.
