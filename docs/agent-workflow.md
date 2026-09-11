# Mobile Canvas agent workflow

Mobile Canvas puts an app's screens beside each other in one native Mac window. Choose a screen by stable ID, inspect its image and source, and compare changes without repeatedly navigating through a Simulator. Screens run real iOS UI. The map is inferred from source; it is a guide to exploration, not proof that every state or navigation edge is covered.

These instructions ship with the installed CLI/MCP version. `mobile-canvas skills get core --full` or `canvas_read_skill {"name":"core","full":true}` adds the editing reference.

## Start with the right project

From an Expo app root, `mobile-canvas setup --json` checks prerequisites without installing. `setup --install` explicitly installs app dependencies; `open` explicitly builds and runs native project code. Apple silicon, arm64 Node 22.14+, compatible Xcode, CocoaPods and local signing are needed for Expo native rendering. Read setup's missing/manual checks; do not treat a successful npm installation as native readiness.

For an MCP client, configure `mobile-canvas mcp --app /absolute/path/to/app`. It prepares a separate linked experiment and starts or attaches to its loopback runtime. MCP startup maps source; `canvas_studio_open` launches native code. Use `--project /absolute/path/to/experiment` to reconnect to a specific Canvas project. The native window's Agent panel provides its exact configuration.

For CLI work, explicit paths make the experiment easy to find:

```sh
mobile-canvas map --app /path/to/app --project /path/to/experiment
mobile-canvas read --project /path/to/experiment
mobile-canvas open --app /path/to/app --project /path/to/experiment
```

Keep the experiment outside the original app. `map` is source-only discovery, so its cards are not native screen previews. `open --app` upgrades an untouched source map to supported native previews. A first build can take several minutes; later opens reuse it. Keep a terminal-owned `open` process running.

## Read the map, then look at pixels

1. Call `canvas_read` for all frames, selection, history, code version and current `project.workspaceId` / `project.sequence`. Call `canvas_route_map` for linked routes, IDs, source paths, params, notes, links and coverage limitations. Authored frames are in `canvas_read`; an empty route map does not mean the authored project has no screens.
2. Choose an existing screen ID based on the task. Read its `notes`, route examples and blockers. Content-navigation links describe forward flow; tab/back chrome is intentionally excluded. Recognized onboarding steps appear as related states. Do not add duplicate detail screens for each record just to make the map look complete.
3. Check `canvas_environment`, then call `canvas_studio_open` with current `workspaceId`, `sequence` and optionally `screen` (the screen ID). This step runs the app's code. Allow the build to finish; read `canvas_studio_state` for progress, errors, host identity and current screen receipts.
4. Call `canvas_inspect_screen` with current `workspaceId`, `sequence`, `hostId` from studio state, and `screenId`. It focuses the frame, waits for current rendering, and returns an image plus source, props, notes, links and runtime metadata. **Actually inspect the returned image.** A registered factory, a route count or a ready receipt cannot establish that a screen is populated or visually correct.
5. Use `canvas_studio_capture` with the same identity and host ID for an overview of the visible canvas. Use the environment's native pointer tools when you need to exercise a control or watch motion. A still screenshot cannot prove an animation works. Mobile Canvas does not provide browser DOM selectors or a complete native interaction driver.

Inspection moves the human's shared viewport and shows a temporary agent ring. Human focus changes can interrupt it. Refresh identity after edits or navigation, and retry only when the reported cause has been resolved. Stop inspecting if the person is actively moving away from the frame.

CLI equivalents for focus and an overview image:

```sh
mobile-canvas studio status --project /path/to/experiment
mobile-canvas studio focus home --project /path/to/experiment
mobile-canvas studio capture --project /path/to/experiment
```

`read` returns the screen records; `studio focus` accepts their key or ID. Capture prints JSON including the saved PNG path; open that image with your image tool. MCP additionally supplies a structured sitemap, linked source reads and per-screen image blocks directly. Consult `mobile-canvas --help` for the installed CLI commands.

## Edit and compare

Read source before writing. Use `canvas_read_route_source` for linked TSX/Swift and `canvas_read_source` for experiment files. Keep the original app untouched while exploring: write an experiment override and its app-path mapping in a `canvas_batch` (`resolver.update` for Expo, `native.override` for Swift). Preserve notes and links when editing geometry or props. One batch is one undoable transaction; mutations use the latest workspace/sequence and source writes require the prior hash. On a conflict, read the current state and reconcile instead of forcing a stale write.

For implementation and fixture examples, load the full editing reference. Use frame-scoped props and state when comparing variants. `canvas_arrange` organizes frames from their links in one undo step. Review changes with `canvas_origin_diff`; `canvas_origin_apply` writes selected files back only when the user asks for that action.

Ordinary Expo TSX edits refresh through Metro. Resolver or native dependency changes need reopen/rebuild, and Swift source changes require native rebuild/relaunch. Check the affected screen's current code version and inspect fresh pixels after editing. A full native reload can crash the SDK 57 host after an export change; stop and reopen that project's canvas, retain logs if it repeats, and report the failure rather than treating it as verified.

## Interpret incomplete previews honestly

| Observation | Meaning and next step |
| --- | --- |
| Static map / metadata card | Source was discovered without rendering. Use explicit native open on a supported app. |
| `waiting-for-link` / missing params | A dynamic route lacks a real example. Inspect its source/list screen and available rendered links. Use an app-owned example; do not invent IDs. |
| Empty detail despite valid params | Frames isolate state; a route ID does not transfer another frame's provider state or session record. Inspect the data dependency and disclose what is missing. |
| Offline service unavailable | `--offline` disconnects supported Clerk, Convex, purchases and telemetry integrations. It does not synthesize remote records, authentication UI or purchases, and downloads still need internet. |
| Swift unavailable / build issue | Read the structured blocker and preview provenance. Existing `#Preview` factories and bounded source recipes can help, but arbitrary constructors, Xcode graphs and state machines are unsupported. Keep unavailable destinations in the flow. |
| Native capture error or blank pixels | Check host connection, screen receipts, logs, window visibility and capture permissions. A mounted receipt is not visual evidence. Native sheets may require compositor capture. |

Linked Expo previews support SDK 56/57; authored previews use SDK 54, with up to 32 frames. Swift supports up to 128 frames experimentally. Recognized Expo routes are pinned so navigation focuses another frame; ordinary Swift navigation can still change its local view. Swift globals/services are not generally isolated, and application context can execute real app initialization. Do not describe Swift isolated context as a service sandbox.

The map misses arbitrary runtime redirects, backend records and unrecognized local states. Camera/device services, exact iPhone fidelity, broader app compatibility and full native reload reliability remain limited. Report what was mapped, what you actually saw, what interactions you tested and what remains unavailable separately. Preserve original source and visible blockers while investigating.
