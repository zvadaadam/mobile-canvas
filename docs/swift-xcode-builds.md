# Swift native build adapters

Swift uses the same local runtime, transactions, canvas, inspector and capture protocol as Expo. Framework-specific work stays below `ProjectAdapter`; Expo resolves a matching React Native host, while Swift compiles a native preview registry. Neither introduces another human editor.

## Boundaries

| Layer | Responsibility |
| --- | --- |
| `project.ts` | Read Xcode target membership, input paths, packages and build requirements without executing the app. |
| `Scan.swift`, `flow.ts` | Discover declarations and source-backed navigation, including extension-defined page switches. |
| `recipes.ts`, `projection.ts`, `state.ts`, `providers.ts` | Choose existing preview/local state and report missing construction or startup dependencies. |
| `compile.ts` | Transform preview factories and source projections once, for either build strategy. Preserve the original app type; remove its entry point and separate delegate adaptors from Canvas lifecycle. |
| `standalone.ts` | Generate a lightweight target for simple apps using system frameworks. |
| `xcode-build.ts` | Derive an isolated target retaining the original package graph, compiler flags, source membership, resources and Metal inputs. |
| `build.ts` | Fingerprint, prepare inputs, invoke Xcode, package the native host and record the build receipt. |
| `SwiftRenderer.swift` | Mount factories in independent native frames and report readiness or missing state. The canvas shell is shared with Expo. |

The Xcode strategy copies inputs only into the experiment's `.expo-canvas/swift-host/inputs`. The original checkout remains unchanged. SDK framework references stay SDK references. The derived target uses an independent bundle identity, Canvas lifecycle and iOS-on-Mac destination; it retains app fonts and Info.plist permission descriptions. Original entitlements, embedded widgets and Crashlytics symbol uploads are omitted and disclosed. Unknown script phases, local packages, bridging headers and unsupported target dependencies remain build-integration blockers. This is not arbitrary Xcode workspace support.

## Building is separate from preparing state

Linking Firebase or RevenueCat does not initialize app services. Swift offers two persisted contexts:

- **Isolated** (default): runs preview factories without the original `App` initializer. `state.ts` conservatively traces app-local services configured during startup and leaves those destinations visible with `app-startup` requirements.
- **Application** (`--swift-context application`): runs the original zero-argument SwiftUI `App` initializer once, then retains it. This enables its existing service configuration. Canvas still owns the window and delegate lifecycle: it does not evaluate the original `App.body`, invoke delegate callbacks or automatically copy scene environment modifiers. This is real service execution, not offline mode. `--offline` cannot be combined with it.

Switch an existing experiment with `open --project <canvas> --swift-context application` (or `isolated`). The choice and rebuilt factory metadata form one undoable transaction and survive re-import. Mapping itself never executes the initializer; explicit open does. The inspector, screen metadata, MCP map and build receipt expose the context.

`providers.ts` resolves typed environment requirements through visible view composition. If a preview omits a provider, Canvas may reuse one unique, accessible constructor already written in another app preview. It records the expression and source file. Ambiguous constructors remain requirements. This is bounded syntax analysis, not complete Swift name or modifier-scope resolution; an authored sample can still be unsuitable for a particular state.

On iOS-on-Mac, the generated host adapts zero-argument `CMMotionManager` construction in CoreMotion source files to a retained, inert native manager. Motion capability queries return unavailable and updates do not start. This avoids the observed virtual motion-device cleanup crash; motion-driven views remain at their own neutral values. It is disclosed in preview metadata and the inspector. Other sensors, arbitrary construction paths and physical-device behavior are not verified by this test.

Swift frames share process-wide services. Arbitrary Swift navigation is not pinned, and a fatal native error can terminate the shared host. Service initialization can perform network work; this is not a sandbox. Startup analysis may over-report inactive references, and a mounted factory may still be blank, loading or incomplete. Neither context invents backend records or a signed-in user.

## BetterMind verification

Pinned source: `5f92173576d9e80b83b61a80c08cce77c4cb7ed2`. The ordinary app first built successfully through its original Xcode project after installing the optional Metal compiler. The derived Canvas target then compiled its 310 Swift inputs, real package graph and shader, installed, and launched on the Mac.

The initial isolated run exposed an unconfigured Firestore dependency; only 12 previews could run independently. Application context fixed service initialization. Native testing then exposed a missing `PaywallStore`, a hidden macOS crash-restoration prompt and a CoreMotion virtual-device cleanup abort. The shared provider resolver, fresh host launch and motion capability adapter address those reproduced failures.

The earlier child-preview pass had **75 destinations and 105 inferred links**. All 75 frames were inspected through MCP in a single surviving host session: **66 factories mounted and 9 frames reported explicit construction/controller requirements**. All returned images were reviewed. This is a large improvement over the earlier 12, but it is not 66 complete screens:

- HomeContainer and AppFeedback returned blank images; HomeContainer has an authentication guard, and unauthenticated feedback selects a mail-controller path.
- OKTherapyConfirmation showed only its background: its existing preview supplies a fresh store without the therapy answer that its content requires.
- HomeView renders its greeting but omits session cards and the bottom control: its existing mock has records while its `didLoadSession` flag remains false, and the view skips loading a nonempty collection.
- Paywalls render layout but lack purchase offerings; some standalone onboarding previews omit parent chrome, and several pitch titles are clipped. Component previews are not complete product journeys.

The 144 source preview declarations remain inventoried; they are not 144 rendered screens. One presentation remains unresolved. No original-app files or app-specific Canvas shims were added. Evidence: `.context/verification/bettermind-app-context-all/` contains 75 PNGs, the MCP report, map and four reviewed contact sheets.

Run `npm run test:compat:swift` with the clean private checkout listed in `tests/compatibility/swift-apps.json`. It checks both contexts, provider provenance, source-map links, candidate counts and stable re-import. This static check does not launch the app.

```sh
node bin/expo-canvas.mjs open --app /path/to/app --project /path/to/separate-canvas --swift-context application
```

The first Xcode build needs signing, SDK components and package downloads. Subsequent builds reuse the experiment's package and DerivedData caches. The verification reused an already-resolved package cache; it is not a cold-install timing benchmark.

## Independent context fixture

`tests/fixtures/swift/ContextLab.swift` is an ordinary SwiftUI app with no Canvas hooks. Its native pass captured all three frames and verified the original initializer, recovery of a missing environment provider from another authored preview, and unavailable device motion. The whole-canvas capture also verifies the visible inspector disclosure. Evidence is under `.context/verification/swift-context-lab/`. This complements BetterMind and the existing asynchronous RecipeLab fixture.


## Parent composition and external actions

`scenes.ts` finds supported finite page/step/tab/pane selectors with mutable, resolvable state and an existing preview of their parent. The compiler wraps that parent's original body in `CanvasSceneSelection`, preserving backgrounds, Metal modifiers, layout, controls and lifecycle. Each frame selects one case before mounting content. Reused child types get distinct state identities and destination keys. The source case order is a layout order, not inferred forward navigation. Arrange places native scene families in grids of up to six columns. Decoration modifiers no longer contribute navigation destinations.

A supported selector change requests focus on its mapped state frame and restores the source frame's selector. This does not pin arbitrary NavigationStack paths or undo other model mutations made by the app's handler. Read-only selectors, ambiguous composition, associated-value cases and arbitrary state machines are not automatically constructed. The current native captures verify assigned cases; pointer-driven transition verification remains outstanding.

Before original app initialization, the Swift host makes MessageUI's `canSendMail()` return false, including calls from compiled packages. Its SwiftUI preview root intercepts `openURL`, returns `.discarded`, and reports only the scheme and blocked status, never addresses or URL parameters. BetterMind's unauthenticated feedback fallback now remains visible without launching the user's mail flow. This is not a full side-effect sandbox: direct UIKit URL calls, custom environment overrides, native controllers that ignore capability checks, network calls and other services remain outside this guard.

The updated pinned map has 68 named destinations and 86 inferred source edges, represented by 71 frames including repeated-component state variants. It contains 31 composed states (28 onboarding, three feedback), 63 application-context factory candidates and eight construction requirements. Isolated mode has five candidates and 59 startup blockers because full parent composition requires more services than bare child previews. These counts intentionally replace the older child-preview totals; they do not indicate that content disappeared.

`tests/fixtures/swift/SceneLab.swift` and `SceneLab.metal` form an independent ordinary app: native captures show the shared header/footer and gradient, a red circle transformed green by the real Metal shader, distinct page cases, unavailable mail capability, and a blocked `mailto` request. Evidence: `.context/verification/scene-lab-final/`. This proves that shader path, not every shader or animation.

The completed composition pass captured and reviewed all 71 BetterMind frames in one surviving host: 63 mounted factories and eight unavailable cards. Gradients, textured parent backgrounds, progress/title controls and bottom actions are visible. Feedback no longer opens mail. HomeContainer remains blank behind its authentication guard; therapy confirmation retains parent chrome but lacks its answer; HomeView omits session cards; paywall offerings are absent. Debug controls and the app-authored rating overlay remain visible. These are recorded in `.context/verification/bettermind-composition-final/visual-audit.json` alongside four reviewed contact sheets. No original-app changes were made.
