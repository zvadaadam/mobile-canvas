# Architecture

## One project, one runtime

`src/runtime/project.ts` owns the strict `expo-canvas.json` document and the command executor; `src/shared/model.ts` defines its public contract. The native canvas, the CLI and the stdio MCP server call the same loopback HTTP service (`src/runtime/server.ts`). A project-local PID lease prevents two runtimes from mutating a project independently, and the runtime is discovered through the explicit project directory, never through global last-opened state.

Opening project data generates an import registry and starts source watchers; it does not execute native code. `open` and `studio open` explicitly launch the signed iOS-on-Mac host and its Metro through `src/runtime/host/launch.ts`, which preflights the bundle so dependency failures surface as errors before a window appears and which tolerates slow runtime answers rather than ending the session. `studio open --screen` records a screen to reveal; once the host reports its first layout, the runtime sends it a focus command that centers and fits the whole frame, accounting for the inspector and title.

## Authoring model

The document holds an ordered list of screen IDs and a normalized map of screen records. A screen is a component source/export plus props, canvas geometry, optional device safe-area `insets`, notes and navigation `links`. The document may also carry `resolver` (import aliases and module substitutions Metro applies to project code) and `origin` (an imported app's path, mode, commit and, for copies, per-file source hashes). IDs survive renaming and reloads; semantic keys are unique and support navigation from components.

An agent command carries `workspaceId`, `sequence`, `requestId`, a label and a bounded list of typed operations. `screen.create` assigns IDs and returns a key-to-ID map; `source.write` requires the SHA-256 from the source read, or null for a new file; `resolver.update` edits aliases and module mappings. Stale writes fail and are never rebased. Replaying an identical request within the session returns its receipt.

All operations are validated before a write-ahead journal is persisted; source files are written atomically and the manifest last; an interrupted journal replays on open. Undo and redo restore the complete source-and-screen transaction and refuse to overwrite external source changes. Source reads reject symlinks and traversal, and bytes and file counts are bounded. Project code runs with Metro's ordinary local privileges once explicitly started; this is a trusted local development environment.

`src/runtime/arrange.ts` computes the flow layout (`/api/arrange`): the unlinked screen that reaches the most of the app is the entry, each linked screen sits one row below the nearest screen that opens it, columns follow the parents, rows are centered, and design variants (same source as a linked screen, linked from nowhere) form a band below. The host's Arrange button, the CLI and MCP apply it as one transaction.

## Existing apps

`src/runtime/import.ts` plans an import: it resolves the app's `@/` alias from its tsconfig, lists Expo Router routes, walks the source and classifies every bare specifier as `host` (the native host serves it), `app` (a JavaScript-only package of the linked app), `project` (copied) or `missing`. In linked mode nothing is copied: `origin.mode` is `linked`, the alias points at the app's own source root, and `resolver.modules` keys that are app paths override or add files in place. Without `--link` the source is copied into `lib/` with provenance.

`src/runtime/origin.ts` reviews the experiment against the app: `originDiff` returns unified diffs for overrides and added files with the app path each would land on, marking `lib/canvas/` and `lib/shims/` as canvas-only; `originApply` copies chosen files to those paths, refuses a file whose origin changed since import unless forced, and never deletes. `doctor` reads that review to list `diverged`, `added` and `canvasOnly` files.

`src/runtime/frames.ts` provides deterministic static route analysis. `import` with `link: true, map: true` creates native metadata cards, inferred content links and initial arrangement in the import transaction. `--app` chooses a separate project by canonical app path and bootstraps it through the same loopback import endpoint for CLI and MCP. No app source executes during mapping. With `preview: true`, import instead generates lazy route entries and records `appPreview` in the document; CLI/MCP `--app` enables this for Expo 56 and 57. Source-only mapping keeps the explicit metadata cards. See [drop-in mapping](drop-in.md).

## Native rendering

`apps/native-host` is the multi-screen Expo 54 host: one shared React host, one Fabric surface per screen, one clipped `UIWindow` per frame in the same scene, direct pointer input, and CLI/MCP readiness, control and capture. [The native canvas](native-canvas-host.md) records tested behavior and fidelity limits.

`apps/native-host/metro.config.cjs` resolves project code against the host's installed packages and the project's own `node_modules`, applies the project's aliases and substitutions to project files only, and rejects a bare import that would resolve into another SDK. For a linked app it also watches the app directory, applies app-path overrides after resolution (so relative imports are overridden too) and as a fallback for files the app lacks, and lets the app's JavaScript-only packages resolve from its own `node_modules` while refusing its native ones. Because Metro caches resolutions per origin directory, a shim that wraps the module it replaces lives alone in its directory or imports a subpath.

`src/runtime/host/matched.ts` prepares a separate, cached Expo 56 or 57 host for linked app previews. It preserves Bun/npm lockfiles and declared Bun patches while installing matching dependencies and compiles the same Swift shell with one React Native factory per frame. `apps/linked-host` supplies the actual Expo Router root, generated route context resolution, protected-route preview transform, and real SQLite storage isolation. The original app source remains linked and receives no writes; native local modules are copied only as build inputs.

Explicit `--offline` / import `offline: true` records a design environment in `appPreview`. Reusable host adapters disconnect supported Clerk, Convex, RevenueCat and Observe integrations while retaining the app's components and local data. Authentication settles signed out; no user records, purchases or backend results are invented. Public Hugeicons stroke icons can replace declared Pro packs, with the difference disclosed in screen receipts. The window title and MCP state identify design preview. External JavaScript fetch/XHR requests are rejected; native modules are not a network sandbox. MMKV 4 factories use frame-specific IDs. Expo font registration is serialized and shared in the generated dependency so one root cannot unregister a font another is measuring; changing an already loaded font's bytes requires reopening the host.

`packages/preview` exposes disposable mock state and navigation by screen key to components; the host gives each mounted screen its own provider.

## Human canvas

`CanvasController` (in `apps/native-host/native/CanvasHost.swift`) arranges and selects frames, exposes history, creation and screen navigation, and manages the inspector in the same window. Each frame is a body view with a name above it; the name selects and drags, and fonts and borders are counter-scaled so they read the same at every zoom. Flow connectors are drawn on the board beneath the frames from each screen's `links`, with the selected frame's edges highlighted and a live navigation pulsed. Frame windows are clipped to the canvas viewport so they cannot cover the toolbar or inspector. A status bar reports readiness from the runtime's receipts.

`CanvasInspector` edits name, position, props and context through the canonical transaction endpoint, and reads source, duplicates fixtures, resets a frame and shows the exact CLI/MCP setup. Drafts keep their original identity; a concurrent agent edit cannot silently overwrite a human draft.

## Boundaries

- `src/shared`: schema and types; no filesystem or process imports.
- `src/runtime`: files, executor, HTTP, CLI, MCP, import and review, host launch and build.
- `apps/native-host`: the Expo 54 iOS-on-Mac host, its Swift shell, Metro config and capture fallback.
- `packages/preview`: component-facing mock state and navigation hooks.
- `designs/*`: portable authored projects, not host implementation.

The repository has no accounts, credentials, paid generation, cloud synchronization, generic graphics nodes or workflow graph.

### Linked route identity and examples

A linked frame owns one source route, with shared navigator contexts recorded as aliases in `props.route.contexts`. Preview-only Babel instrumentation observes concrete links during rendering; the runtime selects available examples deterministically and fills missing params through the canonical command executor, preserving undo and authored parameters. Missing examples have a visible waiting state.

The matched host adapts Expo Router’s action handler: it computes the proposed navigation state using the real router, resolves its URL, and sends a canvas navigation request before a changed route is committed. The destination frame receives requested params through a transaction and is focused by the Swift host; the source remains on its assigned route. Native tabs receive their normal state/provenance update so their selection returns to the assigned tab. Local state controls remain native. `canvas_route_map` exposes the sitemap and `canvas_read_route_source` reads original TSX or its active override without writing to the app.

Screen focus uses a 220 ms interruptible viewport animation (instant for keyboard commands and Reduce Motion). Native frame windows reuse their clip masks and update geometry only when it changes; document polling reconciles layout only after a document sequence change. New React roots mount after camera motion settles. `canvas_inspect_screen` uses the same focus command, waits for the host to settle and a current screen receipt, then requests an authored-size 2× native frame image. Its ephemeral presence is included in host reports: a dashed blue ring and label while capturing, then a brief “Captured for agent” fade. Inspection carries identity checks, never edits document history, and fails if human focus moves elsewhere.

## Visual steps and preview coverage

A route is not necessarily one design. `src/runtime/pagers.ts` recognizes a deliberately narrow finite pager: an ordered literal list, imported page registry, selected/visited index state, matching ref/animation initializers and a forward transition. It emits stable `route.step` frames without evaluating app code. The linked preview transform seeds those hook slots per frame and redirects the pager transition to canvas focus before it changes local state. Ordinary fields and native controls stay interactive. No app-specific source or fixture is generated. Unrecognized state machines remain unsplit; this is not exhaustive state exploration.

Arrange places each recognized sequence in its own horizontal band between its detected incoming screens and its completion destination. Flow links include each page's detected content destinations and the next step; Back controls are not edges. Source evidence accompanies inferred links. A `canGoBack` / `back` / fallback `replace` branch is excluded from content flow. `src/runtime/guards.ts` additionally recognizes finite Boolean `Stack.Protected` gates with literal screen names. It records conditional forward eligibility changes and observes the relevant values in the native preview, so an onboarding completion can focus Home while its source frame stays pinned. Initial observations never navigate; changed scalar inputs allow repeated completion. Unsupported expressions, ambiguous entries and explicit initial-route policies are left unresolved. This is not proof that authentication or a service action succeeds offline.

`canvas_route_map` separates visual-frame, source-route and pinned-step counts and explains coverage limits. `canvas_read_route_source` and the native View source action read the selected step component when one exists. The inspector preserves generated route metadata but omits it from editable preview props.

The linked bundle observes returns from default function declarations in mapped route files. A null/boolean output gets a `needs-state` receipt and an explanatory canvas placeholder that disappears when output becomes available. Nested callbacks are not observed. Re-exported, arrow or child components are not yet covered by this return detector. A non-null element does not establish visual or data completeness. The footer reports running frames and detected missing state/parameters, not that every screen is fully populated. Design preview explicitly identifies isolated local data and disconnected services; parameters do not transfer another frame's provider state.

## Preview failures and compatibility

Unavailable service UI and detected missing route state use a centered, muted native card with decorative translucent shapes. Those shapes are generic placeholders, not an inferred image of the app. Frames retain their identity, context and flow links.

In isolated linked runtimes, an uncaught JavaScript interaction error is reported on its frame and replaced by a retryable preview error card. Render boundaries use the same card. A frame error makes studio state `degraded`, with `screenErrorCount`, while healthy frames remain inspectable; host/launcher failures remain session errors. The shared Expo 54 runtime cannot safely attribute a global exception to a frame, so global interception is limited to isolated runtimes. Disconnected speech emits asynchronous error/end events instead of throwing from Resume.

`tests/compatibility/apps.json` pins Clarity, Hot Chocolate and Workout revisions. `npm run test:compat` tests deterministic mapping, stable re-import, required/forbidden edges, unique frames and arrangement. `npm run test:compat:native` also inspects opened Hot Chocolate and Clarity native experiments through actual MCP and saves captures for visual review. Workout is source-only; the curated SDK 54 export was removed. Test apps and generated projects stay under gitignored `.context/`, with upstream URLs and revisions in the corpus. See [compatibility workflow](compatibility.md). Launchers reserve Metro ports across concurrent canvas processes, including IPv4/IPv6 availability checks.

Known native recovery limitation: the SDK 57 multi-runtime host can crash in Fabric scheduler teardown when Fast Refresh falls back to a full reload. This reproduced while replacing and undoing a component export. Frame Retry works; it is distinct from full native reload. Reopen the canvas after this process-level failure. A JS boundary cannot contain a native segmentation fault.

## Developer packaging and prerequisite checks

`npm run package` produces a local npm tarball with an explicit file allowlist: runtime/CLI/MCP source, preview hooks and native host templates/assets. Runtime TypeScript and tsx dependencies install with production dependencies. Experiments, captures, generated native projects and credentials are excluded. `npm run test:package` installs that tarball into a fresh prefix outside the checkout and verifies the executable, actual MCP transport, source-only mapping and environment checks. It does not certify a native build on another Mac.

`src/runtime/environment.ts` owns read-only prerequisite diagnostics. `expo-canvas setup` works before a project exists; `canvas_environment` calls the same report through `/api/environment` for an opened project. A cold linked-host launch checks requirements before installing/building. Checks never install software, accept agreements or configure accounts. Manual provisioning and render validation remain explicit. This is the prerequisite adapter for a future first-run UI, not a separate human application; the native canvas remains the human surface. See [distribution](distribution.md).
