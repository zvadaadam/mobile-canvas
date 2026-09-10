# Mac packaging investigation

September 10, 2026. Original investigation of the merged implementation. Subsequent npm setup, writable paths and native acceptance work is recorded in [distribution](distribution.md); remaining items below are proposals, not claims that a standalone installer exists. The current renderer and product model remain unchanged.

## Recommendation

Ship a developer package first: one versioned npm installation, a deterministic setup report, local native compilation, and the existing native canvas. Validate it on a second Apple-silicon Mac before calling it distributable. Then investigate a downloadable Mac bootstrap for installation and first-run guidance. That bootstrap would still need the user's Xcode/signing for app-specific iOS renderers.

Do not promise a no-Xcode download that renders arbitrary Expo apps. Two independent problems must be solved: distribution of the actual iOS renderer, and compiling the native dependencies of each app. A DMG or bundled Node solves neither by itself. No browser canvas, remote build service or renderer replacement is proposed.

## Baseline before the npm implementation

The local tarball contains CLI/MCP/runtime source, preview hooks and native source templates. The installed executable, MCP handshake, a synthetic two-route import and environment report passed outside this checkout with production-only dependencies. This does **not** verify native compilation from the installed package, first installation on another Mac, Gatekeeper, provisioning or upgrade behavior.

Implementation at the start of this investigation (historical):

| Part | Location / behavior | Packaging implication |
| --- | --- | --- |
| Node runtime and CLI/MCP | `src/runtime`, `bin/expo-canvas.mjs`; tsx loads TypeScript | Recipient needs compatible Node today; tsx and TypeScript must remain production dependencies unless the runtime is compiled differently. |
| Experiment document and source overrides | `~/.expo-canvas/apps/<app-path-hash>` by default, or explicit project path | Durable user work; never treat as disposable build cache. |
| Matched native host | `<project>/.expo-canvas/native-host` | Installs the app's dependencies and contains generated native build inputs. |
| Signed iOS renderer | `<project>/.expo-canvas/native-build` | Built locally with Xcode, development signing and the app's native modules. |
| Metro | One launched process per open canvas project | Required while editing; it is not eliminated by shipping an app icon. |
| SDK 54 authored host | Dependencies/build live under the Canvas installation today | Needs separation from immutable installation files. |
| Capture fallback | `src/runtime/studio.ts` compiles Swift into installation-local `.context/native-studio/capture` | Also needs a writable per-user cache, even for linked apps. |

`build.ts` uses a Debug iOS build with `platform=macOS,variant=Designed for iPad` and `SKIP_BUNDLING=1`. Its wrapped `.app` is a local development artifact, not a separately verified public macOS distribution.

Measured disk usage on this machine (rounded, `du`, not download sizes):

| Artifact | Size |
| --- | --- |
| npm tarball, 85 files | 283,201 bytes compressed |
| Root npm dependencies | 65 MB |
| Hot Chocolate generated host + native build directory | 1.9 + 2.4 GB |
| Clarity generated host + native build directory | 1.9 + 3.3 GB |
| Compiled wrapped renderers, already included in the above directories | Hot Chocolate 137 MB; Clarity 159 MB |

The large directories include dependencies, Pods and build intermediates, not just the runnable app. Filesystem sharing can affect physical storage. These measurements justify explicit cache management, not a universal size estimate.

Prior local timing evidence in [drop-in verification](drop-in.md): Hot Chocolate reached readiness after 187.4 seconds in one fresh experiment and 248.1 seconds in another; warm readiness was 6.1 seconds. One warm run's native content did not finish drawing until a capture at 19.4 seconds. Clarity's recorded warm readiness was 7.94 seconds. These runs used existing Xcode, signing and download caches. None measures a genuinely fresh Mac. Readiness receipts are not time-to-complete-pixels.

## The two hard constraints

### Native dependencies

JS edits can load through Metro into an existing native binary. A missing Swift/Objective-C/C++ module cannot be supplied by a JS bundle. Expo documents this distinction in its [development builds FAQ](https://docs.expo.dev/develop/development-builds/faq/).

Hot Chocolate and Clarity already need different SDK/React Native versions and native dependency sets. `matched.ts` installs matching dependencies, preserves supported lockfiles/patches, copies local native modules and builds a target. A prebuilt renderer could accelerate a **declared compatible dependency set**; it could not honestly support arbitrary new native modules. Prebuilt hosts would also still need a valid distribution method.

The current importer does not reproduce every app's native build configuration. It uses a selected plugin list, and its package-manager handling is principally npm/Bun. Monorepos, workspace/file dependencies, other lockfiles, unusual config plugins, capabilities and private native SDKs need compatibility work. Packaging must disclose those limits rather than turning a route-map success into a native-support promise.

### Apple's distribution paths

Apple lists iPhone/iPad apps on Mac under App Store distribution, while Developer ID is its outside-store macOS distribution route. Apple separately documents TestFlight and development/ad-hoc export for testing iOS apps on Mac. See [distribution comparison](https://developer.apple.com/macos/distribution/) and [iOS apps on Mac](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos).

Therefore we cannot assume that notarizing an outer launcher or putting today's development-signed iOS wrapper in a DMG makes the renderer installable for arbitrary recipients. Registered testing can be evaluated separately; it is not our verified general distribution path.

A genuine macOS bootstrap can use Developer ID and notarization. Its helper executables and hardened-runtime configuration also need validation; signing the outer bundle is not sufficient evidence that a bundled Node toolchain works. See [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Catalyst is not a packaging switch for this product. Apple documents that its UI idiom affects controls, sizing and behavior; even the iPad idiom requires target-specific consideration. Our requirement is the actual iOS preview runtime, so a Catalyst renderer is outside this plan rather than an assumed equivalent. See [Catalyst UI idioms](https://developer.apple.com/documentation/uikit/choosing-a-user-interface-idiom-for-your-mac-app).

## Distribution options

| Option | What recipients get | Remaining prerequisites | Assessment |
| --- | --- | --- | --- |
| Local npm tarball | CLI, MCP and host templates | Node, Xcode, Pods, signing, app dependencies | Existing proof; next step is installed-package native verification. |
| Published npm package | Same runtime, simpler versioned install | Same native prerequisites | Recommended developer release after the verification gates below. Not published yet. |
| Signed Mac download that guides local setup | Native installation/first-run entry point; optionally bundled Node | Xcode, signing and app-specific native compilation remain | Useful second stage. Window handoff and distribution must be prototyped. |
| Prebuilt iOS renderer via supported testing/store delivery | Fixed native dependency combinations | Compatible app dependency set; local Metro/runtime integration | Limited coverage and unproven delivery/integration here; not a universal solution. |

A Homebrew entry would change installation convenience, not native capability. Bundling Node could remove a Node setup step; it would not bundle a compatible Xcode toolchain or arbitrary app modules. EAS/cloud builds are not part of the local-only product plan.

## Original implementation roadmap

### 1. Separate installed code from writable state

Implemented for the developer tarball; see [current distribution instructions](distribution.md). The original acceptance scope below also includes future upgrade testing.

Introduce explicit paths for immutable installation assets, durable projects, caches and logs. Keep existing user projects where they are; do not migrate them silently. A sensible Mac layout is durable settings under `~/Library/Application Support/Expo Canvas`, disposable generated builds under `~/Library/Caches/Expo Canvas`, and diagnostic logs under `~/Library/Logs/Expo Canvas`. These are proposed paths, not implemented changes.

Update `paths.ts`, SDK 54 build/launch paths and the capture fallback. Carry settings across package upgrades without storing signing configuration in npm's installation/cache directory. Support multiple installed runtime versions and existing sessions; updates must not delete code used by running hosts.

Acceptance: install into a read-only prefix, open a linked app, exercise native and fallback capture, upgrade the package and reopen the same project without losing notes, props, overrides or history.

### 2. Make host reuse explainable and safe

The current fingerprint covers dependencies, selected config, native sources and assets, but not all toolchain/signing changes. Add relevant Xcode/SDK/toolchain, target, signing configuration and host/protocol-version inputs. Keep rebuild reasons visible. Use build locks and transactional completion so cancellation/concurrent opens cannot publish a half-built cache.

Initially keep per-project host isolation. Cross-project binary reuse is a separate optimization: current bundle IDs and some inputs depend on project paths, and sharing them can affect sandbox/storage isolation. Do not optimize away per-frame data isolation.

Expose build-cache size and a safe cleanup operation. Never delete authored source, fixture props, undo history or active-session resources with cache cleanup.

### 3. Finish prerequisites and cold-start reporting

The terminal checklist, saved signing team and explicit frozen installs are now implemented. The broader diagnostics below remain future work.

Reuse `inspectEnvironment` through CLI/MCP and eventually the native setup view. Add disk space, installed macOS vs supported SDK requirements, package-manager version/lockfile handling, usable SDK/platform components and actionable provisioning results. Do not print tokens or signing identity details.

Show explicit phases: checking requirements → mapping routes → installing host dependencies → preparing native project → compiling → signing → starting Metro → rendering frames. Use named stages and elapsed time, not fabricated percentages. Classify failures with a next action and log location. Support cancel/retry without altering the source app.

`--offline` means supported services are disconnected for design preview. It does not mean that a first dependency installation/build needs no network.

### 4. Verify the installed native path on real machines

Use the actual tarball executable, an empty Canvas cache and fresh generated projects. Do not reuse a workspace-built renderer as proof of installation. Run Hot Chocolate and Clarity at the pinned commits in `tests/compatibility/apps.json`, with Workout explicitly source-only.

Required scenarios: cold setup, warm reopen, path with spaces, launching without an interactive shell PATH, missing Xcode/license/team, package installation failure, canceled build, package upgrade, cache removal, two concurrent projects, native capture and ScreenCaptureKit fallback. Verify the original app's tracked source is unchanged.

Inspect the nine configured native captures and the changed interactions. Include repeated JS edits, full reload, retry and reopen; the known SDK 57 teardown crash and earlier startup abort are open stability work. Record time to visible pixels and disk consumption separately from map time and native readiness. At least one second Mac must pass; a different directory on this Mac is not equivalent.

### 5. Publish a versioned developer package

Choose an owned package scope and license/repository/release metadata; do not claim the unscoped name is available. Keep `private: true` until publication is explicitly intended. Decide the supported entry points: the current tarball excludes repository scripts and the SDK 54 host lockfile, so checkout-only `npm run studio:build`/`npm ci` instructions must not be presented as installed-package commands without fixing that path.

Keep install passive: no native builds, Apple sign-in or project execution during npm installation. Native execution stays behind `open` / `studio open`. Use versioned releases and the existing package smoke test plus native evidence. For an eventual npm CI release, evaluate [trusted publishing](https://docs.npmjs.com/trusted-publishers/) instead of adding a long-lived publication token; configuration and repository visibility determine available provenance support.

## Native onboarding without a second human product

Desired experience: choose an app folder, see compatibility and requirements, explicitly open it, watch real build progress, then work in the canvas. The agent connection, project selection and future setup/settings remain part of Canvas. No separate dashboard or agent chat.

There is a real bootstrap problem: the current human window belongs to the signed iOS renderer. If Xcode/signing are missing, that window cannot be built just to tell the user what is missing. Moving the current checklist into Swift does not resolve this.

For the npm developer release, retain explicit setup diagnostics before the first native build. A truly pre-build GUI requires a separately distributable native macOS bootstrap. A possible prototype would show a single Canvas setup window, close/hide it when the actual iOS canvas is ready, and preserve one visible human surface. A bootstrap would need to continue using the same loopback runtime and typed commands. It would **not** establish that an iOS window can be embedded in an AppKit window or that the same OS window survives the handoff. Validate lifecycle, Dock identity, focus, errors and reopening before adopting it. If a physically continuous single window is mandatory, this design remains unresolved.

Bundled Node, signed helper distribution, updates, folder access and pre-build UI are work for that bootstrap prototype. They are not required to prove the npm developer release and should not obscure its native-build acceptance gates.

## Initial suggested implementation slice (superseded)

Start with installation/cache path separation and an installed-package native test. These address concrete failures identified in the source and benefit either distribution channel. Follow with build progress/recovery and toolchain-aware invalidation. Then run the second-Mac acceptance test before publishing. Prototype the native bootstrap only after the installed runtime works independently of this checkout.

No renderer was replaced, no app source was modified, and nothing was published or signed for distribution during this investigation.
