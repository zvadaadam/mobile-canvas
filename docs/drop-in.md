# Drop-in native app previews

Historical workout captures below refer to the former curated export, which has since been removed. For current reproducible test sources and coverage, use [the compatibility corpus](compatibility.md).

`open --app` and `mcp --app` discover Expo Router screens deterministically and prepare a separate linked experiment. Opening the canvas renders the app's actual source, providers, native stacks, tabs and controls. No agent needs to write screen wrappers, mock databases or app-specific `lib/` shims. The implementation supports Expo SDK 56 and 57 apps with installed dependencies; the authored Expo 54 host remains available for existing projects.

```sh
node /absolute/expo-canvas/bin/mobile-canvas.mjs open --app /absolute/app --screen today
```

The experiment defaults to `~/.expo-canvas/apps/<hash-of-canonical-app-path>`. Use `--project /separate/experiment` to choose another location. The source app stays in place and is never modified. Import and MCP startup only inspect source and generate project files; `open` or `canvas_studio_open` explicitly starts native execution.

## Native execution

The product prepares `.expo-canvas/native-host` inside the experiment, installs the app's exact installed top-level dependency versions using its Bun/npm lockfile, preserves declared Bun package patches, and builds the common Swift canvas against its SDK. Local Expo modules are copied as native build inputs; application TSX remains linked in place. The build has its own bundle identifier and sandbox, uses the existing development signing team, and is cached until native inputs change. The first build takes several minutes and requires compatible Xcode (SDK 57 requires Xcode 26.4 or later).

Each mounted frame owns an independent React Native factory and JavaScript runtime. This isolates Expo Router's store and application module singletons such as mutable theme tokens. A generated lazy route context feeds the real `ExpoRoot`; the route and `props.params` supply its initial URL. A memoized root prevents canvas status updates from remounting app providers. Matched-host bundle requests use ordinary HTTP responses after launcher preflight, avoiding intermittent multipart-reader cancellations when many runtimes start together.

Frame-scoped dimensions keep app layout independent of the canvas window. Two additional product-level preview adaptations apply: the Babel transform makes imported Expo Router `Stack.Protected`/`Tabs.Protected` groups visible, and the real Expo SQLite module uses a separate default directory per frame. Actual app migrations and bundled data run; no mock records or backend are invented. The source app's compiled build is unaffected by these adaptations.

## Stable screens and route examples

One source route has one canvas frame. Shared Expo Router groups such as `(flavours,locations)` are retained in `route.contexts`, with all incoming links pointing to one canonical screen ID. Names distinguish dynamic detail frames from their lists. Authored variants remain separate.

Each frame stays on its assigned route. Native tab presses and router navigation focus the destination canvas frame. Clicking a record carries its real route parameters into that destination as an undoable props edit; the origin frame stays unchanged. Local control state is not copied between isolated databases.

The preview transform observes concrete hrefs as app UI renders. The runtime sorts the available examples by source screen key, href and file, fills missing `props.params`, and records `props.routeExample`. Selection is deterministic for the observed set; network-dependent availability is not deterministic. Examples are normal inspectable, undoable project changes. Undo is respected during the current studio session; Reset state or reopening can retry unresolved discovery. The observer never clicks controls or invokes their press handlers, and no LLM runs in this path.

## MCP

```json
{
  "mcpServers": {
    "expo-canvas": {
      "command": "node",
      "args": ["/absolute/expo-canvas/bin/mobile-canvas.mjs", "mcp", "--app", "/absolute/app"]
    }
  }
}
```

`canvas_route_map` is the sitemap: stable IDs/keys, original route files, navigator contexts, current params and example provenance, notes and content links. `canvas_read_route_source` reads the actual app TSX or its active project override. Pass a sitemap ID to `canvas_studio_open` or `canvas_studio_control` to reveal that frame. Source edits in the experiment hot reload; introducing a new resolver override requires one reopen. `canvas_studio_open` builds/opens the native window. Verify runtime errors with `canvas_studio_state` and actual pixels with `canvas_studio_capture`. This is a stdio MCP adapter controlling the native canvas, not a browser UI.

The equivalent explicit import is `canvas_import` with `link: true, map: true, preview: true`, or `import --link --map --preview`. The import is one undoable transaction. Enabling preview upgrades untouched generated metadata cards; authored source, IDs, notes, links and placement survive. Subsequent imports add missing routes and consolidate untouched copies emitted by older shared-group maps. Authored variants and context are preserved; consolidation and incoming-link rewrites are undoable.

## Limits

- Install the source app's dependencies first, including any authenticated registry packages. Native preparation and `canvas_doctor` identify missing direct dependencies and registry-configured package names without exposing credentials. A route map can succeed while native preparation is blocked; map generation is not proof that the app UI rendered.
- Automatic examples require concrete local destinations rendered by the app. `Link href` and simple zero-argument `onPress={() => router.push(...)}` / `navigate` / `replace` handlers are observed without invoking handlers. Complex callbacks, event-dependent destinations and arbitrary function calls are not evaluated. Unresolved frames show “Waiting for a route example”; `studio.waitingCount` reports them. Explicit `props.params` win; `autoParams: false` lets an authored missing-record state render. Native readiness still precedes all pixels settling.
- Protected navigation groups are exposed for design. Authentication and service requirements still execute normally. Router actions are intercepted before committing a different route to a frame; unmatched destinations remain pinned and report `navigationIssue`. Local controls and in-screen sheets still work. The adapter uses the SDK 56/57 Expo Router navigation internals; custom navigators and new SDKs need verification.
- SQLite defaults are isolated; arbitrary explicit storage paths, external services and native process-wide state are not generally virtualized. Native OS features unavailable on iOS-on-Mac, such as Live Activities, can report their normal unsupported-device errors.
- The generated host uses its own Expo configuration. It does not copy app credentials, entitlements or arbitrary config plugins. Apps requiring those may need additional product support. App deployment clients (`expo-dev-client`, `expo-updates`) are excluded because the canvas owns startup and reload.
- Twenty isolated runtimes used approximately 2.4 GiB RSS in the workout test. The host still caps projects at 32 frames; scheduling and resource optimization remain future work.
- Static links describe possible content navigation, not every runtime branch. General conflict-aware route removal/refresh remains future work beyond shared-context consolidation.

For source-only discovery on other SDKs, `map --app` or `canvas_import` with `link: true, map: true` creates explicitly labeled metadata cards without executing app code.

## Workout verification · September 10, 2026

The unmodified app at `/path/to/expo-workout-app` produced 20 routes and 31 static content links without using `designs/workout`. A separate Expo 57 host built under Xcode 26.6 and rendered the real screens, native navigation, exercise library and bundled workout plans. Starting Lower Body opened its real native workout sheet with exercises and set controls. A clean reopen reported all 20 frames current with no startup console errors. Record-specific frames correctly displayed missing-record states until given parameters.

All 29 automated tests and the runtime, authored-host and generated Expo 57 host TypeScript checks passed. Actual MCP `--app` bootstrap and capture were exercised. The existing Expo 54 host also rebuilt, reopened `designs/workout`, and its pixels were inspected. Local evidence: `.context/workout-live-verified.png`, `.context/workout-live-interaction.png`, `.context/workout-live-final-state.json`. The tested project is `.context/workout-live`; `.context/workout-live-mcp.json` points MCP at that already-built experiment.

## Hot Chocolate verification · September 10, 2026

The unmodified `expo/hot-chocolate` repository at commit `1806f3b8fca27ddd23d554484db779525adde3f3` uses Expo 56.0.0, React Native 0.85.3 and a Bun patch for Expo UI 56.0.10. This test added SDK 56 support, lockfile/patch preservation, shared route-group expansion and matching-host capture fallback. The first attempt exposed a real native ABI mismatch from updating a transitive Expo dependency; preserving the source lockfile fixed it. All 32 shared installed native package versions then matched the source app. Dependency changes also invalidate the generated CocoaPods snapshot and successful-build cache.

After those product fixes, a fresh `open --app .context/hot-chocolate-source --project .context/hot-chocolate-dropin` generated eight route contexts from six source files, with four content links and no resolver overrides. `(flavours,locations)` contributes separate detail contexts under each tab. The app source and lockfile remained unchanged; no app-specific shims or fixture records were authored.

Observed on this Apple-silicon Mac with Xcode 26.6 (existing signing, tools and global download caches): clone 0.99 seconds; source `bun install --frozen-lockfile` 6.05 seconds; a fresh project mapped in approximately 1 second and reached runtime readiness after 187.4 seconds, including native build. Cached reopen reached readiness in 6.1 seconds. A second cached run still showed two blank native views at 14.7 seconds and had their content by the next capture at 19.4 seconds. These are single-machine observations, not guarantees; runtime readiness currently precedes full native drawing. Apple map tiles completed when the window was brought into the foreground, so capture and background rendering still need care.

Native interaction checks passed: open Campfire Cocoa, toggle its favourite star, follow its café link, open the store picker and change Main Street to 4th Ave (address updates), select a map marker to open its glass bottom sheet, and close that sheet with the pointer. All four main screens render; the four parameterized detail contexts display genuine missing-record states until supplied IDs or reached through navigation. No frame-rate benchmark or iPhone fidelity comparison was performed. Eight runtimes used about 2.3 GiB RSS shortly after startup, falling later in the session.

All 31 automated tests and runtime, authored-host and generated SDK 56 host TypeScript checks passed. Actual MCP route-map and capture calls passed; the final state had eight current frames and no reported console errors. Evidence: `.context/hot-chocolate-final-map.png`, `.context/hot-chocolate-map-sheet.png`, `.context/hot-chocolate-flavour-detail.png`, `.context/hot-chocolate-benchmark.json`, `.context/hot-chocolate-visual-timing.json`. The tested project is `.context/hot-chocolate-dropin`; `.context/hot-chocolate-mcp.json` connects to it.

## Stable-map follow-up · September 10, 2026

Hot Chocolate now has six frames and three actual content-navigation edges: Flavours → Flavour Detail, Flavour Detail → Location Detail, and Locations → Location Detail. The location’s flavour rows expand in place in the app; they are not navigation links. Both shared detail routes retain their two navigator contexts. The existing eight-frame experiment was consolidated while preserving the surviving IDs.

Native verification: tab selection focused Locations while the source frame remained the Flavours list; choosing Raspberry Zing updated the single Flavour Detail to ID 2 while the list stayed at `/`. Both detail sources populated from observed app links with no manual IDs. An About-wrapper TSX edit visibly hot reloaded without reopening and was then restored. Evidence: `.context/hot-chocolate-hmr-verified.png`.

A completely fresh `open --app .context/hot-chocolate-source --project .context/hot-chocolate-six-screen-proof` then generated six frames and populated both detail examples automatically. All six were current with zero waiting examples after 248.1 seconds from runtime creation, including the fresh native build (other native canvases and checks were running). No intervention or manually chosen IDs were used. Evidence: `.context/hot-chocolate-six-screen-proof.json`.

The shared-context interaction was also verified: Locations → À La Mode updated/focused the single Location Detail to ID 2, while the Locations source remained at `/locations`. All 38 tests and runtime, legacy Expo 54 host and generated Expo 56 host TypeScript checks passed. Actual MCP sitemap and original-route source reads passed. Final evidence: `.context/hot-chocolate-six-screen-final.png`, `.context/hot-chocolate-six-screen-final-state.json`, `.context/hot-chocolate-sitemap-verified.json`. The verified native window is left open on `.context/hot-chocolate-six-screen-proof`; `.context/hot-chocolate-mcp.json` now points to that project. The earlier `.context/hot-chocolate-dropin` project also has the six-screen map and its temporary hot-reload test edit was restored. The source repository remains clean.

## Clarity compatibility test · September 10, 2026

### Design preview without service credentials

```sh
node bin/mobile-canvas.mjs open --app /absolute/app --offline
```

The explicit `--offline` option (also on `mcp --app`, or `canvas_import` with `preview: true, offline: true`) saves a separate design environment. The app's original components, layouts, bundled data and native controls still run. Supported Clerk authentication settles signed out, Convex queries remain disconnected, and RevenueCat exposes no active entitlements or offerings. Auth actions, backend writes and purchases fail explicitly. RevenueCat-owned subscription UI has an unavailable-service placeholder. Observe telemetry is disconnected. Missing Hugeicons Pro packs use the public stroke icon package; filled Pro styling differs. These are reusable host integrations, with no writes to the app and no app-specific fixtures.

The canvas title, MCP sitemap and screen receipts disclose this environment. External JavaScript fetch/XHR is disabled; this is not a sandbox for arbitrary native networking. A route that depends on an existing record or an in-memory result still needs that state. Canvas does not infer or fabricate a completed practice session. Unsupported native dependencies still need to be installed. The normal app environment remains available in a separate project without `--offline`.

Speech recognition is also disconnected in design preview: mounting a practice screen cannot request microphone access or start recording. The original app displays its permission-denied state. This is a screen-design environment, not a test of recording or backend behavior.

### Verified design environment

`.context/clarity-design` builds and opens natively without service keys or private registry access. Actual MCP checks verify 15 canonical routes, 21 links, all 15 original TSX reads and stable re-import. Captures were inspected for every route. Sign-in, onboarding, Home, Practice, Analytics, Settings, the passage editor and saved-feedback UI render; Analytics/feedback use their real empty states. The app's paywall renders its unavailable-offerings state. A real click on an Epic Speech card supplies the detail frame's `epic-speech` parameter, and the real bundled passage renders with recording disabled. Tab navigation focuses Practice while Home remains on `/`.

Four limitations remain visible: Results and Word detail return no UI without their in-memory session result; Manage subscription is a disclosed RevenueCat placeholder; Dev seed stays unavailable as authored; passage carousel cards currently lose their text beneath their effect layers. The exact carousel rendering cause remains unresolved. No claim of complete visual fidelity is made. Public icon styling differs from the private Pro icons.

Host fixes serialize shared native font registration, keep preview windows' native appearance active so Liquid Glass does not gray out, and ignore background-route redirects that would steal canvas focus after a reload. Source reload was tested through a temporary project-side marker, captured without reopening the host, then undone. No app-specific overrides or fixtures remain. The linked app's tracked source stays clean. All 46 tests and the runtime and host TypeScript checks pass; the Expo 54 Workout reference rebuilt and its populated Today screen was captured again.

Evidence: `.context/clarity-design-compatibility.json`, `.context/clarity-design-captures.json`, `.context/clarity-design-*.png`, `.context/clarity-reload-proof.png`, `.context/design-reference-today.png`. The `ready` receipt means the current route mounted, not that its service/data requirements are satisfied; inspect the image and metadata together.

A cached stop/reopen reached 15 current route receipts in 7.94 seconds (`.context/clarity-design-warm.json`). The initial native build took several minutes. This warm measurement reuses the generated host and the passage parameter discovered by the earlier real click; it does not claim a fresh clone populates that detail automatically.

### Original app environment

Cloned `SchroederNathan/clarity` at `297e699ea03902d4f3172aa7b1f3ddbc2ef8900c` into `.context/clarity-source` and ran the ordinary drop-in command against `.context/clarity-dropin`. The fresh checkout initially had no installed dependencies. `bun install --frozen-lockfile` installed the public packages, including Expo 57.0.21, but returned HTTP 401 for `@hugeicons-pro/core-solid-rounded` and `@hugeicons-pro/core-stroke-rounded`. The native host cannot build the real app until those licensed packages are installed. No substitutes, app overrides or fixture records were authored; tracked source remains clean.

Actual MCP verification passed for 15 unique source routes, 21 content-navigation links, all 15 original TSX reads, API-route exclusion and stable IDs/links after re-import. Native execution remains blocked, and no Clarity screen image or interaction is claimed as verified. The app also requires Clerk/Convex development configuration; MMKV storage, speech recognition, purchases and its provider/splash behavior still require native testing once installation is complete.

The failed launch exposed an incorrect generic “build the native host first” error. Native preparation now reports missing app packages before build work, and `canvas_doctor` includes the same dependency report. Only a missing host build manifest produces the host-build instruction. Runtime TypeScript checks and 41 tests pass, including private-package diagnostics and credential redaction. Evidence: `.context/clarity-compatibility.json`, `.context/clarity-open-verified.log`; repeat the MCP verification with `node --import tsx .context/verify-clarity.ts`. `.context/clarity-mcp.json` connects to this experiment without attempting to run its source.

After dependencies and local development configuration are available, continue with:

```sh
node bin/mobile-canvas.mjs open --app .context/clarity-source --project .context/clarity-dropin
```

### Multi-step routes and coverage follow-up

The same deterministic import now discovers Clarity's five onboarding pages: Name, Accent, Goal, Priority and Microphone. The project has **19 visual frames for 15 source routes**. Each step retains the original onboarding shell and native controls, pins its own progress, and sits in an ordered band. Continue focuses the next frame; Back focuses the previous frame. Native Goal → Priority → Goal interaction was verified without advancing either frame locally. MCP source reads resolve to each page's real TSX. No app-specific fixtures or source edits were needed.

Flow discovery now retains source evidence, assigns a step's content links to its own page, and excludes Back fallback replacements. Clarity's Word detail → Home line was such a fallback and is removed on re-import. The follow-up guard analysis now connects onboarding completion to Home and records conditional sign-in destinations for new and returning users. Unsupported state transitions remain unresolved. These are inferred content flows, not a guarantee that every runtime branch is covered.

Results and Word detail now show “This screen needs app state” instead of silent blank previews. This explains missing state; it does not supply their completed-session designs. The inspector identifies the offline environment and pinned step, hides generated route internals from editable props, and preserves that metadata on Apply. The footer reports frames running and detected missing state/parameters. Other service and visual-fidelity limitations above still apply. Automatic pager discovery supports the recognized finite pattern; arbitrary local states and backend-driven variants still require explicit preview state support.

Native evidence: `.context/clarity-steps-proof.json`, `.context/clarity-step-*.png`, `.context/clarity-design-session-results.png`. Earlier 15-frame timings describe the previous map, not this expanded one.

Follow-up validation: 50 automated tests pass, plus runtime/host TypeScript checks. The rebuilt Expo 54 Workout Today screen was captured with populated content. Hot Chocolate still maps to six canonical source frames with no spurious pager steps. The original Clarity checkout remains clean.

## Flow, unavailable previews and interaction errors · September 10 follow-up

Clarity maps to 19 visual frames and 15 source routes, with five pinned onboarding steps. Finite root-guard analysis adds conditional Sign in → Name, Sign in → Home and Microphone → Home edges. Arrange puts the onboarding band between entry and Home. Actual native completion focuses Home even when completion was already stored; it never replaces the microphone frame. Offline authentication remains disconnected, so the sign-in edges are static conditional evidence rather than a successful authentication test.

Unavailable service and missing-state cards now have centered explanations, a muted device icon and translucent decorative screen shapes. Expected disconnected speech starts emit error/end events. Unexpected interaction errors stay in the affected isolated frame with Retry; MCP can capture the failed frame and continue inspecting Home. A real native button throw and successful Retry were verified. Full native reload after changing a component export still exposes an SDK 57 Fabric teardown crash; reopening recovers the canvas. It remains a separate tracked limitation, not a handled JavaScript error.

The repeatable three-app corpus and native capture workflow are documented in [compatibility.md](compatibility.md). Missing session data, private icon differences and the Clarity carousel rendering limitation above remain unresolved.
