# Compatibility regression

Run `npm test`, `npm run check` and `npm run test:compat` after changing mapping or the preview host. The corpus in `tests/compatibility/apps.json` is the source of truth for repository URLs, pinned revisions, expected maps and native capture targets. Keep downloaded apps and generated previews in gitignored `.context/`; do not commit exported copies or app-specific adapters.

| App / source | Pinned revision | Static coverage | Native experiment |
| --- | --- | --- | --- |
| [Clarity — Nathan Schroeder](https://github.com/SchroederNathan/clarity) | `297e699ea03902d4f3172aa7b1f3ddbc2ef8900c` | 15 routes, 19 designs, five onboarding steps | `.context/clarity-design` (SDK 57, offline) |
| [Hot Chocolate — Expo](https://github.com/expo/hot-chocolate) | `1806f3b8fca27ddd23d554484db779525adde3f3` | Six canonical routes, shared details deduplicated | `.context/hot-chocolate-six-screen-proof` (SDK 56) |
| [Expo Workout](https://github.com/zvadaadam/expo-workout-app) | `dd3d800470495363d79cc685d65daf4547e41860` | 18 routes | Source-only; no native target at this revision |

The static command fetches missing pinned commits into `.context/compatibility/repos`, archives source into temporary directories, and never checks out or edits an app's working tree. It tests repeatable maps, stable re-import IDs/metadata, required and forbidden links, non-overlapping arrangement and onboarding flow order. It needs Git access to each repository on a cold run; a failed fetch fails the suite. No app dependency installation is needed for static tests.

External contributors use `npm run test:compat:public`, which selects entries marked `access: public` (Hot Chocolate and Clarity) and reports Workout as not selected. It does not silently skip failed public fetches. The full `npm run test:compat` retains all three maintainer regressions. Public Swift fixtures are checked into `tests/fixtures/swift` and exercised by `npm test` on a Mac with Xcode. The optional private Swift corpus uses `CANVAS_TEST_BETTERMIND=/path/to/pinned/checkout npm run test:compat:swift`; it checks the pinned revision and clean source without modifying that checkout.

## Fresh native test setup

Clone these repositories once into new directories and check out the exact revisions. If a checkout already exists, verify its revision and use a separate directory if needed; do not overwrite local work.

```sh
mkdir -p .context
git clone https://github.com/SchroederNathan/clarity.git .context/clarity-source
git -C .context/clarity-source checkout --detach 297e699ea03902d4f3172aa7b1f3ddbc2ef8900c
git clone https://github.com/expo/hot-chocolate.git .context/hot-chocolate-source
git -C .context/hot-chocolate-source checkout --detach 1806f3b8fca27ddd23d554484db779525adde3f3
```

Install each app's dependencies with its declared package manager and lockfile (see its README). Then check the Mac prerequisites and explicitly open the previews:

```sh
node bin/expo-canvas.mjs setup --app .context/clarity-source --offline
node bin/expo-canvas.mjs setup --app .context/hot-chocolate-source
node bin/expo-canvas.mjs open --app .context/clarity-source --project .context/clarity-design --offline
node bin/expo-canvas.mjs open --app .context/hot-chocolate-source --project .context/hot-chocolate-six-screen-proof
```

The first native build requires Xcode/signing setup and app dependencies. The open commands remain running while their canvas is open; use separate terminals for each app and the tests. On subsequent runs, reopen the generated projects with `open --project <path>`.

```sh
npm run test:compat:native
```

The native command deliberately requires existing opened projects. It does not build, close another session, install credentials or silently skip configured apps. It inspects nine representative frames across Clarity and Hot Chocolate through actual MCP, checking screen errors and saving PNGs plus a report under `.context/compatibility`. Workout still runs its static checks, with native coverage explicitly reported as not configured. Its former 25-design SDK 54 export was deliberately removed; it is not required by the product. `designs/native-studio` remains a small authored SDK 54 example, separate from these upstream-app tests.

Review the images: an image can be technically valid while the app is missing content or native fidelity. Results/Word detail in Clarity need session data; RevenueCat owns the unavailable subscription screen. Those frames stay in the flow and are not counted as crashes. Run the host TypeScript check with `npm run check:studio`; generated matched hosts have their own `tsconfig.json` and installed TypeScript binary.

Also exercise the changed interaction in the native window. For error recovery, use a temporary project-side component with a throwing button, verify only that frame shows an error, inspect another frame, then click Retry and verify readiness returns. Undo the temporary edit afterward. Do not modify the linked app. Full native reload after component-export replacement currently exposes a separate SDK 57 Fabric teardown crash; restart the canvas if encountered and report it instead of counting the run as a clean reload test.

To add an app, pin a commit, record its routes/alias root, coverage counts and a few source-supported required/forbidden edges in the corpus. Add representative native screen keys and a separate project path. Static and native checks are complementary; neither claims exhaustive runtime state coverage.

## Private Swift regression

`tests/compatibility/swift-apps.json` records BetterMind at `5f92173576d9e80b83b61a80c08cce77c4cb7ed2`, using the user-provided local checkout. Run `npm run test:compat:swift` on a Mac with that clean pinned checkout. This opt-in test never fetches, checks out, or edits it. It checks 310 Swift input files, 68 recognized destinations, 86 links, 71 state frames, 144 preview declarations, representative flow edges, stable re-import, the Xcode build strategy, five isolated preview candidates and 59 conservative startup blockers, then 63 application-context candidates and provider provenance. The corpus is separate from the portable Expo regression because this private source is not available on every machine.

Open it with `node bin/expo-canvas.mjs open --app /path/to/bettermind-ios --project .context/bettermind-xcode-canvas --swift-context application`. The derived target retains the 22 package products and Metal resources, and omits its widget and upload phases. Setup requires signing and the optional Metal toolchain. Application context executes real service initialization; it does not supply a signed-in user or guarantee populated states. See [Swift build adapters](swift-xcode-builds.md) for measured results and remaining limits.

## Recorded cleanup verification · September 10, 2026

57 tests, runtime and SDK 54 host TypeScript checks, all three pinned static regressions, and the isolated npm package installation test passed. The configured native suite captured all nine frames across Clarity and Hot Chocolate; their images were reviewed. Hot Chocolate's list and details were populated. Clarity retained its subscription/session-state placeholders and an in-app speech-unavailable message; its Home carousel cards still lack text. These are visible limitations, not proof of full fidelity or a process crash.

## Native architecture cleanup · September 11, 2026

110 tests and both TypeScript checks pass. Native unit coverage now compiles the shared UIKit shell and Swift renderer under both Swift 6 default isolation modes, decodes sessions produced by the TypeScript store, and exercises stale reads, selection ordering, malformed messages, cancellation, reconnects and viewport geometry. The public two-app corpus, full three-app corpus, configured private Swift regression and isolated npm installation checks pass. The new public CI workflow has been validated locally; a hosted Actions run is still pending publication of the branch.

Fresh native builds and MCP captures cover six Clarity states, three Hot Chocolate states, two composed SceneLab pages and one authored Expo screen. Images were inspected. Hot Chocolate remains populated; Clarity still has sparse Home cards, service/data placeholders and its speech-unavailable UI. SceneLab retains its parent gradient, Metal rendering and independent page states. Clicking its native Continue button moved focus to the second frame while the first stayed pinned. A Swift reset was acknowledged without changing document history or the other page's state. Captures and logs for this pass are local under `.context/verification/cleanup-*` and `.context/cleanup-*`.

One initial watcher test timed out while native compilers were busy. It passed on its own and in subsequent complete suite runs; the timeout was not weakened. No signed hosted build or second-Mac installation is claimed by these checks.

## Recorded limitations

Prior verification captured twelve frames including the now-removed authored Workout export. Current configured native coverage is nine frames across two upstream apps; do not count the historical Workout captures as current drop-in coverage. A previous native run hit a Hot Chocolate inspection timeout and one startup abort before a successful reopen/retry. The SDK 57 full-reload crash above remains unresolved. Passing captures do not establish native lifecycle stability or exhaustive visual fidelity.

BetterMind’s application-context native run captured all 75 mapped frames: 66 mounted factories and 9 explicit requirements. Three mounted previews remained blank/background-only and several others had incomplete state or layout; the default isolated context still has 12 candidates. The source corpus test alone is not native rendering proof. See [Swift build adapters](swift-xcode-builds.md).

## Application-context verification · September 11, 2026

92 unit tests, TypeScript checks, the three pinned Expo source maps and the private Swift checks pass. Both Swift contexts preserve stable re-import; application context resolves 66 BetterMind factory candidates. Native evidence covers all 75 BetterMind frames, three ContextLab frames, five RecipeLab frames and nine Expo regression captures. Images were reviewed, with blank/incomplete states reported separately in [Swift build adapters](swift-xcode-builds.md). The first stale Hot Chocolate capture timed out; after rebuilding/reopening the matched hosts, the complete native suite passed. This does not erase the lifecycle and visual limitations recorded above.


### Parent composition regression

The Swift corpus also checks 31 composed state frames, distinct identities for repeated child components and stable context re-import. SceneLab verifies real parent styling, Metal output and blocked mail/SwiftUI external actions natively. Earlier 75-frame verification above describes the prior child-preview implementation. The current evidence is in `.context/verification/bettermind-composition-final/` and `.context/verification/scene-lab-final/`; candidate and mounted counts must be reported separately from visual completeness.

The composition pass has 95 passing unit tests and passing TypeScript, three-app Expo source-map and private Swift regressions. All 71 BetterMind captures and both SceneLab state captures were inspected. The first Expo native run passed six Clarity captures and timed out on Hot Chocolate's location frame; the existing Hot Chocolate session was reopened for a fresh retry. See `.context/composition-native-initial.log` and `.context/composition-native-retry.log` for that distinction.

The retry passed all nine Expo native captures (six Clarity, three Hot Chocolate); images were reviewed. Clarity still displays its disclosed subscription/session requirements and sparse Home cards. Workout remains source-only. These checks do not certify arbitrary Swift side effects, complete app data, or pointer-driven Swift navigation.

### Component and image-fixture regression

The new read-only Swift preview catalog exposes app-authored component previews and bundled assets. Selected components stay out of generated navigation. Regression tests cover selection/re-import, image-fixture preservation, animation hints, asset namespaces, bounded Kingfisher rewriting and frame-local screen bounds. BetterMind native evidence includes five component previews, independent local image choices, timed orb captures and corrected remote-message layout. An independent SceneLab shows 402- and 320-point bounds simultaneously. Fresh OpenDevs native validation uses `.context/deus-media-regression` with no source overrides, covering workspace, settings, changes and code-diff views. See [native preview catalog](native-preview-catalog.md) for commands and limitations.

Final component/media validation: 98 unit tests, TypeScript checks, all three Expo source regressions and the private Swift regression pass. After explicitly opening the configured Expo experiments, all nine native captures passed (six Clarity, three Hot Chocolate) and were reviewed. The initial native attempt found those hosts stopped; that result is retained in `.context/media-native-before-open.log`, with the completed run in `.context/media-native-compat-final.log`. Clarity's disclosed service/session limitations remain. OpenDevs' five representative final captures were reviewed in `.context/verification/deus-media-final/`; this is not exhaustive validation of its 57 frames.
