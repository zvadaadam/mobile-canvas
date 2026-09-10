# Compatibility regression

Run `npm test`, `npm run check` and `npm run test:compat` after changing mapping or the preview host. The corpus in `tests/compatibility/apps.json` is the source of truth for repository URLs, pinned revisions, expected maps and native capture targets. Keep downloaded apps and generated previews in gitignored `.context/`; do not commit exported copies or app-specific adapters.

| App / source | Pinned revision | Static coverage | Native experiment |
| --- | --- | --- | --- |
| [Clarity — Nathan Schroeder](https://github.com/SchroederNathan/clarity) | `297e699ea03902d4f3172aa7b1f3ddbc2ef8900c` | 15 routes, 19 designs, five onboarding steps | `.context/clarity-design` (SDK 57, offline) |
| [Hot Chocolate — Expo](https://github.com/expo/hot-chocolate) | `1806f3b8fca27ddd23d554484db779525adde3f3` | Six canonical routes, shared details deduplicated | `.context/hot-chocolate-six-screen-proof` (SDK 56) |
| [Expo Workout](https://github.com/zvadaadam/expo-workout-app) | `dd3d800470495363d79cc685d65daf4547e41860` | 18 routes | Source-only; no native target at this revision |

The static command fetches missing pinned commits into `.context/compatibility/repos`, archives source into temporary directories, and never checks out or edits an app's working tree. It tests repeatable maps, stable re-import IDs/metadata, required and forbidden links, non-overlapping arrangement and onboarding flow order. It needs Git access to each repository on a cold run; a failed fetch fails the suite. No app dependency installation is needed for static tests.

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

## Latest cleanup verification · September 10, 2026

57 tests, runtime and SDK 54 host TypeScript checks, all three pinned static regressions, and the isolated npm package installation test passed. The configured native suite captured all nine frames across Clarity and Hot Chocolate; their images were reviewed. Hot Chocolate's list and details were populated. Clarity retained its subscription/session-state placeholders and an in-app speech-unavailable message; its Home carousel cards still lack text. These are visible limitations, not proof of full fidelity or a process crash.

## Recorded limitations

Prior verification captured twelve frames including the now-removed authored Workout export. Current configured native coverage is nine frames across two upstream apps; do not count the historical Workout captures as current drop-in coverage. A previous native run hit a Hot Chocolate inspection timeout and one startup abort before a successful reopen/retry. The SDK 57 full-reload crash above remains unresolved. Passing captures do not establish native lifecycle stability or exhaustive visual fidelity.
