# Expo and Swift native adapters

Historical architecture proposal, 2026-09-10. The coupling table and implementation stages below describe the starting point, not the current tree. Experimental Swift support has since shipped; read [current architecture](architecture.md#experimental-swift-adapter), [the contributor map](../CONTRIBUTING.md) and [verified Swift build limits](swift-xcode-builds.md) for current behavior.

## Recommendation

Keep one native canvas, one document model and one loopback runtime. Extract two boundaries from the current implementation: a project adapter for discovery/build preparation, and a native frame renderer for mounting content. Ship Expo and Swift adapters inside the product first; do not start with a plugin marketplace or dynamically loaded native plugins.

Use the existing UIKit/iOS-on-Mac shell for both. SwiftUI frames use `UIHostingController`; UIKit frames retain their own view controllers. Expo frames keep their real React Native surfaces and native modules. Ordinary TSX or Swift remains the source of truth. No conversion between the two languages, browser replicas, or application-specific adapters checked into Canvas.

The work is an incremental architectural extraction followed by a new Swift build/import path, not a rewrite of the canvas. Rendering is the smaller problem. Reliable construction, source mapping, navigation, native dependency graphs, rebuilds and honest coverage are the larger problems.

Initial scope is SwiftUI and programmatic UIKit **iOS apps running on an Apple-silicon Mac**. Native AppKit/macOS apps, arbitrary storyboards, extensions and unrelated applications mixed into one binary are separate work. A native project must actually be compatible with iOS-on-Mac; an iOS simulator build is not evidence of that compatibility.

## Evidence from the current code

| Location | Existing coupling | Required boundary |
| --- | --- | --- |
| `src/shared/model.ts` | Sources only match `.ts`/`.tsx`; exports assume JS identifiers; `appPreview` embeds Expo SDKs | Versioned language/source/entry metadata; keep transactions and stable IDs |
| `src/runtime/project.ts` | TS-only scanning/watching, starter creation, TS registry generation, Expo import calls | Core owns journal, hashes and history; adapter owns analysis, templates and generated registry |
| `src/runtime/origin.ts` | Linked overrides live inside Metro resolver mappings | Language-independent source overrides, with Metro mappings derived by Expo |
| `src/runtime/studio.ts` | Hard-coded SDK/host paths, route example processing, `routePreview` readiness | Generic session/build/readiness envelope; adapter-specific observations |
| `src/runtime/host/matched.ts` | Expo package installation, local modules, prebuild, native fingerprint | Preserve as Expo implementation behind build planning |
| `src/runtime/host/launch.ts` | Metro and native launch supervised together | Shared session ownership; adapter supplies launch processes |
| `CanvasHost.swift` | AppDelegate, controller constructor and frames retain React factories; mount takes `UIView` | Separate React entry point and renderer from UIKit shell; mount controllers |
| `CanvasInspector.swift` | Mostly shared UI, but preview metadata describes Expo routes | Common coverage/fixture metadata with adapter-specific detail |
| `src/runtime/mcp.ts` | Tool descriptions and sitemap filter assume generated TSX routes | Adapter-neutral screen catalog, source evidence and capabilities |
| `src/runtime/environment.ts`, `project-context.ts` | Expo root detection; CocoaPods check for every native project | Project-specific prerequisites and explicit target selection |

The drawing, viewport, sidebar, undo model, flow layout and visible agent presence are reusable. The source registry and render-freshness logic need real changes; simply swapping the React root for a SwiftUI view would leave those wrong.

## Expo with Swift modules is still an Expo project

A React Native screen that calls an Expo module or hosts its native view should keep running through the Expo adapter. The build must compile/link that module and preserve its app context, event delivery, configuration, resources and native lifecycle. Calling an `ExpoView` constructor from a standalone Swift renderer does not recreate that context.

The current matched host copies `modules/`, hashes its files and rebuilds when preparation runs. It preserves supported npm/Bun dependency inputs, but it uses a selected config-plugin list and a generated host configuration. It is not a faithful importer of every custom `ios/` project, app delegate change, config plugin, autolinking search path or entitlement. Current native module detection also happens during host preparation; it is not an automatic native-source rebuild watcher while the canvas is open.

The shared build planner should make these differences explicit:

- JS/TS edits follow Metro/Fast Refresh when possible.
- Swift/Objective-C/C++ implementation edits trigger native compilation and relaunch.
- Native dependency, podspec, module registration, project configuration or plugin changes may require dependency resolution/project regeneration before compilation.
- Workspace packages, local native directories and resolved autolinking inputs must join the fingerprint. Looking only under `modules/` misses other supported layouts.
- Native code modified in a package must really build from source when that package otherwise uses precompiled artifacts.
- Generated Expo projects and maintained custom Xcode projects need distinct preparation strategies. Never run prebuild over a person's maintained native project to make it fit the generated-host path.

Expo documents native module discovery through autolinking, including custom local module directories and search paths. It also distinguishes native changes from JS iteration: native changes require another build. These are build concerns shared with the Swift adapter, not reasons to reimplement Expo modules. [Expo autolinking](https://docs.expo.dev/modules/autolinking/), [custom native code](https://docs.expo.dev/workflow/customizing/), [precompiled modules](https://docs.expo.dev/guides/prebuilt-expo-modules/), [continuous native generation](https://docs.expo.dev/workflow/continuous-native-generation/).

## Two adapter boundaries

### Alternatives considered

| Approach | Assessment |
| --- | --- |
| Extract the current UIKit shell and compile it into each compatible preview host | Recommended: preserves native interaction/capture and current product behavior; a native rebuild restarts the shell too |
| Rewrite the canvas as a separate AppKit process | Does not remove app construction or build problems; embedding interactive iOS content across processes would require a separate, unproven architecture |
| Control or embed Xcode's preview canvas | Useful as a manual reference, but the documented preview authoring workflow is not a supported remote canvas service on which to base this product |
| Load arbitrary application binaries/frameworks into one persistent host | Swift access, symbols, signing, dependencies, runtime metadata and safe unloading make this unsuitable as the first design; compiled-in factories are simpler to validate |
| Reimplement Swift screens in TSX or capture static screenshots | Loses source fidelity or live interaction and does not meet the native canvas requirement |

### Project adapter: Node orchestration plus language-specific analysis

Start with an internal TypeScript interface along these lines; names below are proposals, not existing APIs:

```ts
interface ProjectAdapter {
  id: 'expo' | 'swift-ios';
  detect(input: ProjectLocation): Promise<ProjectCandidate[]>;
  discover(input: DiscoveryInput): Promise<ScreenCatalog>;
  planBuild(input: BuildInput): Promise<BuildPlan>;
  prepare(input: BuildPlan, signal: AbortSignal): Promise<BuildArtifact>;
  classifyChanges(input: ChangeSet): UpdatePlan;
}
```

`detect` and source-only `discover` read files without evaluating application config, expanding arbitrary macros, running package plugins or executing app code. Discovery can report incomplete build context. Package resolution, config execution and Xcode preparation belong to the explicit execution path after `open`, or an explicitly requested installation/build step.

The core validates adapter output and writes the document through the existing command executor. An adapter does not mutate the document itself, bypass prior hashes, apply changes to the original app, or own an independent undo stack. Source adapters contribute watched inputs, a generated entry registry and provenance; they do not get unrestricted source-write authority via the public protocol.

Build artifacts describe the executable, target/runtime, fingerprints, dependencies and launch requirements. Common process supervision owns cancellation, logs and child-process cleanup. Expo contributes a Metro process; Swift need not. Keep transport and capture outside language adapters where possible.

Avoid a large abstract plugin API before both implementations exist. Introduce only the contract needed to move the current Expo code intact; refine it against the first Swift slice.

### Native frame renderer: a controller with an explicit lifetime

Use a Swift `@MainActor` boundary. A renderer creates a frame instance exposing a retained `UIViewController`, fixture update/reset behavior and disposal. The instance retains its React factory, Swift model graph or UIKit controller as appropriate. The shell owns frame windows, clipping, safe areas, viewport, titles, selection and capture.

The controller must participate in real containment and presentation. The current code wraps a React `UIView` in a generic controller. SwiftUI requires retaining its hosting controller and installing it directly or as a proper child, not detaching its view. Apple specifically calls out controller hierarchy requirements for toolbars and presentations. [SwiftUI/UIKit integration](https://developer.apple.com/videos/play/wwdc2022/10072/).

A frame context supplies stable identity, fixture input, navigation intents, diagnostics, resource context and cancellation. It must not silently replace production dependencies. A renderer advertises whether fixture edits can update in place or need a remount. Reset creates fresh supported local state and cancels owned work; it cannot promise to reset arbitrary global singletons.

Do not assume all Expo frames have private native state because they have separate JS engines. Native static variables and OS services may still be shared across those engines. Swift frames share the process too.

Suggested extraction locations:

```text
src/runtime/adapters/expo/       existing analysis and host preparation
src/runtime/adapters/swift/      Swift catalog and Xcode build preparation
apps/canvas-shell/               UIKit controller, frame windows, inspector
apps/expo-renderer/              React factories and Expo entry point
packages/swift-preview/          compiled Swift registry/context contracts
```

These are logical boundaries first. Move files only when the extraction is working; packaging and the Expo config plugin currently depend on their paths.

## Document, source and protocol evolution

Use a versioned document migration rather than silently widening version 1. Keep screen IDs, semantic keys, order, geometry, notes and links. New fields identify the adapter, entry kind and source reference. A Swift entry is a registered factory identity, not an arbitrary string to evaluate as Swift. Keep compiler symbol identities as supporting evidence; explicit persisted screen IDs remain the identity across rename/rebuild.

Separate three concepts currently mixed in Expo props:

1. Source provenance: original file, active override, symbol/preview anchor and source hash.
2. Fixture: JSON input with a declared schema, or a named compiled fixture factory.
3. Discovery evidence: route/step/presentation, inferred destinations and unresolved requirements.

The existing `props` dictionary can remain the transport for editable JSON fixture values. Swift decodes into a known `Decodable` type; closures, bindings, services and model objects are constructed by compiled factories. Do not claim that JSON can instantiate arbitrary Swift types or that reflection can recover their intended initializers.

Source access keeps bounded reads/writes and canonical path checks. Add `.swift` within validated project-owned source roots; never accept arbitrary filesystem paths through `source.write`. Represent linked app files separately from writable experiment files. Native resources are watched build inputs, but editing arbitrary binary assets need not become part of the first source-write API. Language-neutral override mappings replace the accidental dependency on `resolver.modules`; the Expo adapter derives its resolver from them. Generated factories and transformed files are build artifacts, not apply-back changes.

Version 1 Expo documents must migrate without changing notes, links, fixtures or source bytes. Old clients must reject unsupported versions rather than stripping unknown fields. Test transaction replay, journal recovery, external-edit conflicts and undo across the new schema before exposing Swift writes.

Extend the host handshake with protocol version, adapter version, artifact/build identity and capabilities. Existing tools should keep their names when their intent is already generic. Generalize `canvas_route_map` to include Swift screens and view states, retaining Expo route information where meaningful. Generalize screen-source lookup; retain the route-specific tool as a compatible alias or clearly limited operation.

## Swift discovery and construction

Use a pinned SwiftSyntax-based helper for parsing and source-preserving transformations, invoked by Node. Pin/test parser versions with supported Swift toolchains. SwiftSyntax supplies a syntax tree, not automatic type resolution or a complete semantic navigation graph. Compiler validation establishes whether a proposed entry is actually constructible. Index/SourceKit integration can improve symbol resolution later. [SwiftSyntax](https://github.com/swiftlang/swift-syntax).

A catalog entry has independent discovery, construction and runtime statuses. Finding a `View` declaration does not make it a screen, and discovering a screen does not mean it can run offline.

| Input | Initial policy |
| --- | --- |
| Explicit Canvas preview registration | Strongest identity, fixture and navigation contract; compile the declared factory |
| Simple existing `#Preview` or `PreviewProvider` | Reuse supported factory expressions with original lexical/build context; report unsupported macro/local-state forms |
| View/controller with supported initializer | Generate a factory only for known supplied/default inputs; compiler-check it |
| Navigation destination or sheet closure | Record a candidate and its requirements; mount only when construction context can be preserved |
| Arbitrary state, services, opaque builders or macros | Keep source/evidence and an unavailable entry; do not invent values |

`#Preview` is useful source material, not a public API for embedding or controlling Xcode's live preview engine. Its declarations may depend on private names, lexical context, traits and `@Previewable` state. A separate generated file cannot necessarily access them. Initial support should be narrow and explicit, with unsupported forms reported rather than naively copying closure text. [Apple's preview workflow](https://developer.apple.com/videos/play/wwdc2023/10252/).

No-agent import means deterministic recognition and deterministic diagnostics for supported forms. It does not mean every application already exposes previewable dependency construction. Optional hand-authored registrations are an escape hatch, not something to silently generate with invented fixture data and call automatic support. Record provenance as existing preview, generated supported entry, or explicitly authored fixture.

## Build the real app context in a separate target

For a suitable Swift Xcode app, generate a preview target/project under the experiment/cache directory. Read its selected target's sources, settings, dependencies and resources. Exclude the production `@main` entry and install Canvas's entry point. Compile app sources and generated factories in the same module initially so ordinary `internal` declarations remain usable. Do not require users to turn all screens into public Swift packages.

Preserve asset catalogs and generated asset symbols, localization, resource bundles, compiler flags, Swift concurrency mode, deployment target and required framework links. Private declarations still obey Swift access control. A generated same-file derivative may eventually support some private preview factories with exact source mapping, but broad access-control rewriting is not an initial strategy.

Two supported build strategies can share the adapter:

- **Library/SwiftPM UI target:** link the existing library and resources with explicit preview factories. Respect the package's public access boundary and any build plugin requirements.
- **Xcode application target:** derive a separate target from a declared subset of project constructs; preserve compilation context, replace app startup and isolate generated outputs.

Do not attempt a universal `.pbxproj` copier that silently drops build phases. Unknown custom scripts, bridging headers, generated source pipelines or unsupported dependencies produce a build-plan issue. Add support with fixtures. Resolve package dependencies into the generated workspace; do not update the app's lockfiles. Where build tools cannot reliably consume linked inputs without touching them, use private build copies with a manifest mapping every input back to its origin. Such compiler staging is not an exported design copy and is never eligible for apply-back by default.

Use a separate bundle identity and least-required preview entitlements. Do not copy production keychain groups, push registration or associated-domain behavior automatically. Local modules may still require initialization previously performed by the app delegate; expose those requirements rather than running the entire production startup routine behind the user's back.

One compiled app-derived host owns a compatible native dependency graph. Rendering TSX and an explicitly registered Swift view from that same graph is plausible after both renderers work. Mixing arbitrary independent Expo/Swift applications or incompatible module versions on one board is not initial scope. Separate processes would complicate native view embedding, interaction and capture; it is not a free isolation feature.

## DEUS / paris-v5 as the first Swift reference

Inspected `/path/to/opendevs-mobile` at HEAD `19605b0f05c83edd834884400751bf4520f6014d`, with pre-existing local changes, including `WorkspaceReviewDemo.swift` and stores. Findings describe that working tree, not an immutable regression fixture. No source files in that app were changed for this investigation.

- Native SwiftUI app in `ios/DEUS.xcodeproj`; its npm/EAS files are delivery configuration. A dependency-free package.json must not cause Expo misclassification.
- Swift 6, iOS 17 deployment target, UIKit/SwiftUI plus Apple system frameworks. `DEUSCore` is compiled directly into the app module as well as exposed through its own Swift package.
- Explicit Xcode file references and asset-generated color symbols mean compiling a few view files without the project context would be misleading.
- `DEUSApp` creates the coordinator. `RootView` reads shared authentication/storage and begins account/source work in `.task`. Using the root as every frame would duplicate startup and still hide signed-in screens.
- `RootView` exposes project/workspace navigation and several sheets. They provide map evidence, but destinations depend on the selected source and records.
- `WelcomeView(onSignIn:)` is a good simple entry. Its callback destination must be explicitly resolved or marked unresolved; do not silently no-op it and claim pinned navigation works.
- `WorkspaceReviewDemo` and `ToolTimelineDemo` are useful existing debug entries. The former already uses local workspace/dictation data, but its `ReviewDemoSource` is private. Rendering the parent demo is easier than independently constructing every destination. Opening the demo alone does not prove full-workspace offline coverage.
- `WorkspaceScreen` owns a model, starts lifecycle work and presents sheets. Its `WorkspaceSource` protocol offers a real injection seam, but constructing a conforming fixture remains explicit work.
- Existing `#Preview` declarations were found for a few components, not a complete screen catalog. Authentication, pairing, keychain, WebKit and hardware features cannot be assumed available or isolated.

First product slice: Welcome, one existing local demo and an independently instantiated UIKit control example. Next: a populated actual workspace, a sheet as its own design, and navigation from one pinned frame to another. The workspace step needs a reviewable fixture/registration path, not a hidden DEUS-specific adapter in the product.

Before adding this app to the persistent corpus, obtain a reproducible revision containing the intended demos or record explicit test-only fixture patches separately. Keep the checkout and generated builds gitignored, consistent with the existing three-app corpus.

## Navigation and visual-state coverage

Reuse the core intent: a source frame proposes a destination; the runtime resolves a stable screen, validates fixture input, updates the destination transactionally when necessary and focuses it. The source keeps its assigned design. Only deliberate foreground interaction may move the camera; background mount effects must not steal focus.

Expo keeps its existing router interception. Swift initially supports explicit navigation callbacks and supported bindings through a preview context. A controlled `NavigationStack` path can participate when its owner cooperates. An arbitrary `NavigationLink(destination:)`, private `@State` sheet Boolean or custom router cannot be universally intercepted through one public SwiftUI hook. Source transformation may support specific patterns later, with provenance and tests; global swizzling/introspection is not the foundation.

Represent capability per entry: pinned navigation supported, local navigation only, or unresolved. If pinning is unsupported, keep the mapped frame stable by disabling that transition in design mode with an explanation; do not let an agent receive the wrong screen under the old identity. A future explicit interactive-session mode could allow ordinary navigation, but it must not masquerade as a pinned map.

Keep navigation evidence distinct from authored `links`: inferred edges have source anchors and unresolved conditions. Promote only supported content navigation into the flow. Tabs and Back do not become a web of flow lines. Named finite steps and explicitly previewed sheets are variants; do not enumerate every Boolean combination. A sheet should preserve meaningful presenting context and native backdrop when shown as a separate design, rather than flattening its body and calling it equivalent.

## Rebuild and freshness contract

| Change | Intended action |
| --- | --- |
| Layout, selection, notes, links | No app rebuild |
| JSON fixture | In-place update or targeted remount as declared by the renderer |
| Expo TSX implementation | Metro refresh; report native fallback/full reload separately |
| Swift view or native module implementation | Incremental Xcode build, then relaunch the matching host |
| Source membership, native dependencies, flags, plugins, entitlements | Recompute plan; resolve/regenerate only when required; build and relaunch |
| App assets/fonts | Adapter classifies; compile native assets or reload supported runtime assets |

A source watcher debounces edits and allows at most one build per target/cache. New edits supersede pending work; an older completed build must never replace a newer requested generation. Use immutable build input snapshots/manifests so edits during compilation cannot produce a mixed-generation artifact. Stable DerivedData caches can reuse compiler work while staging outputs under build IDs. Include toolchain/SDK, architecture, selected target, adapter/schema versions, native dependency/lock contents, configuration, generated code, resources and source hashes in invalidation. Cache decisions must not rely only on timestamps.

Keep the last successful host running while compiling. Show “Building” or an error with its source location; label old rendered content as stale. A failed build must not destroy the usable prior preview. After success, restart the host and restore camera, selection, fixture inputs and declared serializable preview state. Since the shell is inside the same app process, this baseline restart also restarts the window; restore it promptly but do not promise a seamless persistent window. Splitting the shell into a separate process would be a much larger embedding architecture.

Do not promise arbitrary Swift `@State`, tasks, models, connections or first-responder state survive a rebuild. A future hot-code replacement strategy can be evaluated separately; depend on supported compiler/build behavior first, not private Xcode preview injection APIs.

Current `codeVersion` is tied to TS sources/metadata and must not be reused as if it proves native freshness. Track desired source generation, built artifact generation, fixture revision and mounted frame generation separately. Host session identity also changes on restart. `canvas_inspect_screen` waits for the requested generation to mount and settle, then returns capture evidence for that generation; it fails or explicitly returns stale status if only the previous build exists. Include the build/native-module fingerprint so changing Swift in an Expo module cannot accidentally yield a “current” screenshot of the old binary.

## Isolation, errors and honest availability

Each frame gets a fresh dependency graph where the declared factory supports it: preview state, disposable storage namespace, tasks and navigation context. Environment injection only helps if application code uses that environment. It cannot replace arbitrary `.shared` references. A separate app bundle isolates some production storage access, but frames within it still share process-global resources unless designed otherwise.

Offline behavior is adapter/dependency-specific. Disabling JS fetch does not disable Swift URLSession, WebKit, sockets or native SDK networking. Do not describe this as a sandbox. Known disconnected services can retain their local UI and expose unavailability, but never fabricate a successful account, purchase or backend operation.

Distinguish discovered, needs fixture, unsupported build, building, stale, mounted, unavailable service and failed. “Mounted” proves a live view exists, not that every expected detail is present. Missing content stays visible in the catalog and flow with source context.

Swift thrown construction errors can become per-frame diagnostics. A `fatalError`, unsafe native crash or memory corruption can terminate the entire host; a React error boundary or Swift `do/catch` does not contain it. Recover via the external runtime, preserve the document, avoid restart loops and let the user omit the suspected frame on retry. Do not market in-process frames as crash-isolated.

Capture should operate on the retained frame controller/window and its relevant presentation hierarchy. The existing screen capture draws the root view; that may omit a presented native sheet. Verify sheet capture, keyboard scope, safe areas, glass/backdrop and pointer dismissal as dedicated cases. Keep unsupported capture surfaces explicit; returning an unrelated canvas screenshot is not a substitute for the requested frame image.

## Commands, packaging and setup

Keep the product's existing executable for this work. Proposed normal usage remains `mobile-canvas setup` and `mobile-canvas open` from the app root. Automatic detection finds Expo or supported Xcode/SwiftPM candidates; a persisted explicit project/scheme choice resolves ambiguity. Finding an `ios/` directory in an Expo app must not automatically switch it to the standalone Swift adapter. Do not recursively choose an arbitrary Xcode target from a monorepo.

The same npm distribution can carry the Node runtime, Swift shell source/templates and a pinned analyzer helper. Node is a tool prerequisite, not an app dependency. Install does not need to compile the imported app. Build caches and generated projects remain outside the immutable npm package.

Setup is adapter-specific: full Xcode and signing for the chosen iOS-on-Mac build, CocoaPods only where the selected graph uses it, SwiftPM resolution where needed, npm/Bun for Expo as applicable. The standalone DEUS Swift path should not demand Expo or CocoaPods merely because its EAS delivery has an empty Podfile. Reuse the current team detection/choice. Nothing here requires notarizing or publishing a release during development.

Report actual cold install/build, warm open, Swift rebuild and JS refresh durations. Compilation, dependency download and simulator-independent Mac launch have different costs; do not promise a universal one-command completion time.

## Implementation stages and exit criteria

1. **Extract the native mounting boundary using Expo only.** Move Expo startup/factories out of the shell. Preserve lazy mounting, UIKit containment, safe areas, focus, capture and failure reporting. Run unit/type checks, all three mappings and both native reference apps; compare pixels and interaction. No Swift import feature yet.
2. **Extract project/build responsibilities using Expo only.** Keep current entrypoints and behavior; move TS registries, routing observations and build plans behind the adapter. Add native-input watching and generation-aware readiness. Verify a real Swift edit in an Expo local module triggers a rebuild and updated capture; no-change reopen must reuse the build.
3. **Add the versioned source/catalog model.** Test old-document migration, source override provenance, hash checks, journal recovery and undo. Generalize MCP source/catalog/capability reporting; unknown adapters fail explicitly. Never migrate by stripping unknown props.
4. **Build the first Swift host.** Use a generated target, real resources and compiled entries for the limited DEUS slice. Verify two live frames with independent state, UIKit controls, SwiftUI sheets, safe areas and capture. Record original tree hashes before/after. A build pass alone does not pass this stage.
5. **Add supported Swift discovery and fixtures.** Validate stable re-import and source anchors, simple previews, explicit registrations, unknown constructors and private declarations. Prove a populated Workspace frame and pinned navigation without changes to production code. Report everything that required authored fixture work separately.
6. **Harden iteration and distribution.** Test stale capture rejection, failed builds preserving last good content, edits during builds, cancellation, process crash recovery, installed read-only package, paths with spaces and fresh-Mac prerequisites. Add the reproducible Swift fixture and an Expo native-module mutation fixture to the ongoing corpus.

Do not gate the first usable Swift slice on universal automatic navigation, a plugin registry, remote view streaming, arbitrary native library unloading, or full Swift state restoration.

## Verification performed for this proposal

Read the runtime contracts, source store, source overrides, MCP catalog/capture path, native shell mounting, Expo matched host and build preparation. Inspected DEUS sources/project configuration and its existing local demos. Consulted the primary sources linked above.

An isolated compile probe is saved in `.context/swift-adapter-spike/FrameRenderer.swift`. It validates a shared `@MainActor` controller factory, typed JSON decoding, SwiftUI and UIKit implementations, and child-controller containment under Swift 6. Command used on this Mac:

```sh
xcrun swiftc -typecheck -swift-version 6 -target arm64-apple-ios17.0 \
  -sdk /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk \
  .context/swift-adapter-spike/FrameRenderer.swift
```

Result: passed using Xcode 26.6 / iPhoneOS SDK 26.5. This is a compiler feasibility check only. It does not launch an app, link DEUS, test iOS-on-Mac compatibility, validate native pixels or prove lifecycle cleanup. No production adapter was added, no inspected app source was edited, and no runtime/host behavior changed in this proposal.
