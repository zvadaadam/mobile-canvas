# Expo Canvas

A native macOS canvas for designing Expo apps with real code. Screens run side by side as live iOS surfaces: arrange them, click through native controls, follow the app flow between frames, and let a coding agent iterate through the CLI or MCP.

The experimental [npm developer package](docs/distribution.md) can be built with `npm run package` and verified with `npm run test:package`. `expo-canvas setup --app /path/to/app` reports Mac build prerequisites before launch. Native execution still needs Apple silicon, Xcode and development signing; this is not a standalone Mac installer.

![Expo Canvas showing the Expo Workout app as a flow of live screens](docs/native-studio.png)

The canvas is an Expo SDK 54 app that runs directly on an Apple-silicon Mac, so screens use actual UIKit, SwiftUI and Liquid Glass. No Simulator, browser or Electron shell is involved. The screens inside the frames are ordinary React Native code; the shell around them is thin Swift.

## Open a project

```sh
npm start -- --project designs/native-studio                 # opens the canvas and waits for its screens
npm start -- --project designs/native-studio --screen focus  # fits and centers one whole screen
```

In the window:

- **Click a screen** to fit and center the whole frame; click again to use its real controls. Sheets open inside their frame, and `navigate(key)` focuses the destination frame while the others keep running.
- **Drag a screen's name** to move it. Drag the background to pan; **Pan** also lets you drag over screens. Trackpad scrolling and pinch work, as do `⌘+`, `⌘−`, `⌘0`, `⇧⌘1` (fit all) and `⇧⌘2` (fit selection).
- **Flow** draws each screen's navigation links as connectors: forward edges solid, return edges dashed, the selected frame's edges blue, and a live navigation pulses the edge it took. **Arrange** lays the frames out by that flow in one undoable step.
- **Inspector** edits a screen's name, position, fixture props and context, shows its source, resets its mock state or duplicates it as a new state. **Undo** and **Redo** share one history with agent edits.
- **Agent** shows the exact MCP configuration and CLI command for this project.

## Setup

Node 22.14+, Xcode, CocoaPods and an Apple development team are required. The native host has its own dependencies and is built once:

```sh
npm ci
npm ci --prefix apps/native-host
npm run studio:build -- --team YOUR_TEAM_ID
```

`studio:build -- --incremental` rebuilds after Swift or asset changes without repeating prebuild and Pods. See [the native canvas](docs/native-canvas-host.md) for what the host links and how it composes frames.

## Agents

```sh
node bin/expo-canvas.mjs init --project designs/my-app --name "My app"
node bin/expo-canvas.mjs screen add --project designs/my-app --key home --name Home
node bin/expo-canvas.mjs open --project designs/my-app --screen home
node bin/expo-canvas.mjs mcp --project designs/my-app
```

An agent reads the project, writes ordinary TSX under `screens/`, `components/` and `lib/`, changes fixture props and geometry in one undoable batch, opens the canvas, checks readiness and calls `canvas_inspect_screen` for a native image and screen metadata. The canvas follows that inspection with a temporary blue ring and label. Screens carry `notes` (purpose, states, interactions) and `links` (where they navigate), which is what the Flow connectors and Arrange use. [The agent guide](docs/agents.md) has the contract; [architecture](docs/architecture.md) explains the runtime.

## Existing apps

`import --link` brings an existing Expo app onto the canvas without copying it: the app's own source runs in place, its JavaScript packages serve it, native modules come from the host, and the project holds only the files the experiment overrides or adds, each mapped by app path in `expo-canvas.json`. `diff` shows what the experiment changed versus the app; `apply --files` copies chosen files back, and only when asked.

```sh
node bin/expo-canvas.mjs import --project designs/my-experiment --from /path/to/app --link
node bin/expo-canvas.mjs diff --project designs/my-experiment
node bin/expo-canvas.mjs apply --project designs/my-experiment --files lib/screens/week/index.tsx
```

Existing-app tests fetch pinned [Hot Chocolate](https://github.com/expo/hot-chocolate), [Clarity](https://github.com/SchroederNathan/clarity) and [Workout](https://github.com/zvadaadam/expo-workout-app) revisions into gitignored `.context/`. No exported workout project is bundled. `designs/native-studio` is a small three-screen example built directly for the canvas. See [compatibility setup](docs/compatibility.md) for clone and preview commands.

## Verify

```sh
npm run check          # runtime, CLI, MCP
npm run check:studio   # the native host's TypeScript
npm test               # transactions, import, review, arrange, studio protocol
npm run test:compat    # pinned Clarity, Hot Chocolate and Workout maps
```

[Validation](docs/validation.md) records what was observed on a real Mac and what is still unverified. The [compatibility workflow](docs/compatibility.md) adds native MCP captures for Hot Chocolate and Clarity. Known limits: up to 32 frames per project; linked previews isolate their JavaScript runtimes; exact iPhone fidelity is not established. SDK 57 can still crash during a full native reload after changing a component export.

## Map an existing app without adapters

`node bin/expo-canvas.mjs open --app /absolute/app` deterministically creates a linked route map and renders the actual Expo 56 or 57 app in a separate native host. Use `mcp --app /absolute/app` for automatic MCP setup. No agent-authored wrappers, fixtures or app-specific shims are needed; real detail parameters are discovered from rendered links, and unresolved examples are explicitly labeled. Shared routes get one frame; navigation moves canvas focus while each origin stays on its route. The first native build takes several minutes and is cached. `map --app` remains source-only discovery. See [setup, verification and limitations](docs/drop-in.md).

Add `--offline` for an explicit design preview without Clerk/Convex credentials. Supported service integrations are disconnected, local app data and native controls remain real, and public icons can replace missing Hugeicons Pro packs. Service-owned UI and screens requiring session records remain limited; the canvas and MCP disclose the preview environment.
