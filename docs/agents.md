# Agent editing reference

Start with the [bundled workflow](agent-workflow.md), served by `mobile-canvas skills get core` and MCP `canvas_read_skill`. Load this reference with `--full` / `full: true` when editing.

Point each CLI or MCP session at an explicit project. Read first, make one bounded batch, open or refresh the canvas, check readiness, look at a capture, then iterate. Do not infer success from a command receipt alone.

## The target

The canvas is an isolated Expo **54** host (React Native 0.81.5, `@expo/ui` 0.2.0-beta.9) in `apps/native-host`, running as an iOS app directly on an Apple-silicon Mac. A project holds up to 32 screens; the canvas creates a frame for each and mounts its React root when it first scrolls into view, then keeps it mounted. All mounted screens share one JavaScript runtime with per-screen mock state. It needs the locally built, development-signed host; opening a project alone does not run its code, `open` and `studio open` do.

`designs/native-studio` is a three-screen example (Still, a focus app) written directly for the canvas. Existing-app test sources and generated projects live under gitignored `.context/`; see [compatibility setup](compatibility.md). The default screen starter uses React Native `Switch`/`Pressable` and `expo-glass-effect`.

For deterministic Expo 56/57 app previews, use `mcp --app /absolute/app` or `open --app /absolute/app`. This generates live route entries and builds a separate SDK-matched host on explicit studio open, with actual providers/navigation and independent JS runtimes and default SQLite storage. Protected routes are visible. Real IDs are discovered from rendered app links into inspectable `props.params`; unavailable examples remain explicitly waiting. Frames stay on their assigned routes, and navigation focuses the destination frame. Shared route groups become one frame per source with context aliases. Use `canvas_route_map` as the sitemap and `canvas_read_route_source` to read the actual app code. `map --app` is source-only mapping. See [drop-in mapping](drop-in.md) for setup and limitations.

## MCP setup

Use the installed executable and replace the project path (or copy the Agent panel's configuration):

```json
{
  "mcpServers": {
    "mobile-canvas": {
      "command": "mobile-canvas",
      "args": ["mcp", "--project", "/absolute/path/to/experiment"]
    }
  }
}
```

If a runtime is already serving the project, MCP attaches to it; otherwise it starts and owns one on a free loopback port. `canvas_url` returns that service endpoint. The CLI attaches or starts the same way. The **Agent** button in the canvas shows this exact configuration for the open project.

## Create screens

Call `canvas_read`, then copy its `workspaceId` and `sequence` into `canvas_create_screens`:

```json
{
  "workspaceId": "<from read>",
  "sequence": 0,
  "requestId": "create-onboarding-1",
  "label": "Explore onboarding",
  "screens": [
    {
      "key": "welcome",
      "name": "Welcome",
      "notes": "Purpose: introduce the app. States: default and compact fixture. Interactions: Continue opens preferences.",
      "links": ["preferences"],
      "code": "import { Text } from 'react-native'; export default function Welcome(){ return <Text>Welcome</Text>; }"
    },
    { "key": "welcome-alt", "name": "Welcome / alternate", "source": "screens/welcome.tsx", "props": { "compact": true } }
  ]
}
```

Default dimensions are 402 × 874 points with no safe-area insets unless `insets` is set; placement defaults to a row. The returned `created` map resolves keys to IDs. Creating a screen without code or an existing source produces the shared native starter (a switch, a pressable button and a glass surface over one observable mock state).

## Iterate source and fixtures together

`canvas_read_source` returns a file's code and hash. A `canvas_batch` may combine source edits, geometry and props edits, new screens, removals, resolver changes and renames; the whole batch is one undo entry.

```json
{
  "workspaceId": "<from latest read>",
  "sequence": 1,
  "requestId": "welcome-spacing-2",
  "label": "Explore a compact welcome",
  "operations": [
    { "type": "source.write", "path": "screens/welcome.tsx", "expectedHash": "<from source read>", "code": "<complete TSX>" },
    { "type": "screen.update", "id": "<created ID>", "patch": { "props": { "compact": true }, "x": 490, "notes": "Compare a compact first screen." } }
  ]
}
```

`source.write` accepts new files under `components/` or `lib/` with `expectedHash: null`. Direct filesystem edits are watched too, but they cannot be undone through the canvas. Syntax is checked at write time; module resolution and native behavior are checked by Metro and the host. Keep code small, use the host's installed packages, and avoid production services for a design experiment.

## Open the canvas, or one screen of it

```sh
mobile-canvas open --project designs/native-studio                # the whole flow, fitted
mobile-canvas open --project designs/native-studio --screen focus # one whole screen fitted and centered
```

`open --screen <key>` (MCP `canvas_studio_open` with `screen: <id>`) is the URL of this tool: the canvas opens, or comes forward if it is already open, and fits and centers the whole frame as soon as it has laid out. A source change refreshes the mounted frames in place through Metro, so an agent that edits a screen and reopens it with `--screen` sees the result without clicking through the app. `studio zoom <scale> --key <screen>` does the same on an open canvas, and `studio focus <screen>` fits and centers the whole screen.

## Inspect a screen together

Call `canvas_inspect_screen` with `workspaceId`, `sequence`, `hostId` (from studio state), and `screenId` (from `canvas_read` or the linked app's `canvas_route_map`). It fits the screen in the shared human viewport, waits for current rendering and camera settlement, then returns a native 2× PNG plus source, props/route, notes, links and runtime state. The canvas shows “Agent inspecting” with a dashed blue ring, then “Captured for agent” briefly before clearing. This indicates capture activity; it does not pretend to know whether an agent is still reasoning about the image.

Inspection does not edit project history. Human focus changes interrupt it, concurrent captures are rejected, and old native hosts request a rebuild/reopen. Read fresh identity and retry after changes. Use `canvas_studio_capture` without `screenId` for the whole current viewport. Presented native sheets may require the existing compositor capture fallback; a screen image covers the frame's root hierarchy.

## Mock behavior and navigation

```tsx
import { usePreviewState, usePreviewNavigation } from "@expo-canvas/preview";
import * as UI from "@expo/ui/swift-ui";

export default function Settings({ defaultEnabled = true }: { defaultEnabled?: boolean }) {
  const [enabled, setEnabled] = usePreviewState("notifications", defaultEnabled);
  const { navigate } = usePreviewNavigation();
  return (
    <UI.Host style={{ flex: 1 }}>
      <UI.VStack>
        <UI.Switch label="Notifications" value={enabled} onValueChange={setEnabled} />
        <UI.Button onPress={() => navigate("welcome")}>Continue</UI.Button>
      </UI.VStack>
    </UI.Host>
  );
}
```

Each mounted screen has its own preview state. `navigate(key)` focuses the destination frame and pulses the flow edge to it; the other frames keep running, and no state transfers. Reset clears one screen's mock state. Changing a fixture's default does not overwrite an existing state value; reset that frame when testing new defaults. Keep layout local to the frame and avoid global window-size or router assumptions; several frames share one runtime.

The installed `@expo/ui` 0.2.0-beta.9 differs from newer SDKs: `UI.Switch` takes `value`/`onValueChange`/`label`; `UI.Slider` takes `steps` counting intermediate stops; `UI.Button` takes text children with `variant="glassProminent"`; `UI.BottomSheet` takes `isOpened`, `onIsOpenedChange` and `presentationDetents`. Give a `UI.Host` explicit bounds inside React Native layout; an intrinsic-width host collapsed button labels in the Still trial. `designs/native-studio/components/still.tsx` shows the exact installed usage.

## Screen context and flow

Use `notes` for each screen's purpose, fixture states, interactions, animation intent and destinations, and `links` for the destination keys. Links draw as flow connectors (the Flow toggle): forward edges solid, return edges dashed, the selected frame's edges highlighted, a live navigation pulsed. Keep them to in-content navigation a component performs, not tab or back chrome. `canvas_arrange` (CLI `arrange`, the Arrange button) lays every frame out from those links as one undoable transaction: the unlinked screen that reaches the most of the app on top, a centered row per navigation depth, each screen under the screens that open it, and design variants (same source as a linked screen, linked from nowhere) in a band below. Geometry-only patches preserve context and props.

## Import an existing app

`mobile-canvas import --project designs/my-experiment --from /absolute/app --link` (MCP `canvas_import` with `link: true`) runs the app in place: `origin.mode` becomes `linked`, the app's `@/` alias points at its own source root, `lib/` starts empty, and the app's JavaScript-only packages resolve from its `node_modules` while native modules come from the host. To change an app file, write a project file and map it by app path in one batch:

```json
{ "type": "resolver.update", "modules": { "src/theme/colors.ts": "lib/theme/colors.ts" } }
```

The override applies wherever the app imports that file, relative imports included; a path the app does not have becomes an added file. Without `--link`, `import [--name] [--include a,b] [--exclude a,b] [--modules pkg]` copies the app's source into `lib/` with provenance, and `--modules` copies JavaScript-only packages into the project's `node_modules`.

The import report classifies every bare specifier as `host`, `app`, `project` or `missing` (with a note when a package is installed but lacks the exact subpath). For manually authored SDK 54 imports only, an app may need preview-specific integration. These are not prerequisites for the deterministic Expo 56/57 `--app` path, which owns its host adapters. Do not introduce app-specific shims merely to open a supported linked app. When building a custom authored preview:

1. Replace persistence, services and navigation with shims under `lib/shims/`, mapped through `resolver.update` (`"expo-router": "lib/shims/expo-router.tsx"`). Substitutions apply to the project's and the linked app's own code only. A shim that wraps the module it replaces must live alone in its directory and import the bare name, or import a subpath; never `export *` from `react-native`.
2. Scope anything the app keeps in a module singleton per frame: theme tokens, `useWindowDimensions`, the router.
3. Author `screens/*.tsx` frames that mount the imported screen inside the app's providers with a mock fixture, and give each screen device `insets` (for example `{ "top": 155, "bottom": 100 }` for a large-title tab screen). The host applies them as real safe areas; the project draws the status bar, navigation bar and tab bar.
4. Reopen the canvas after changing the resolver; `canvas_studio_state.resolverCurrent` and `canvas_doctor` say when.

For existing-app regression coverage, use the pinned repositories and generated linked previews in [compatibility setup](compatibility.md). The former curated workout export is no longer included.

## Swift source overrides

Before the first Swift override, `canvas_read_route_source` returns the original app path and hash. In one `canvas_batch`, write the changed Swift into a project `lib/` file with `source.write`, then associate it with the original using `native.override`:

```json
{ "type": "native.override", "appPath": "Views/Home.swift", "source": "lib/Home.swift", "expectedHash": "<current original app source hash>" }
```

The source write's hash checks the project override (null for a new file); the native override's hash checks the original app file. Once an override exists, the route-source read returns that override and its hash instead; subsequent edits need only `source.write` unless changing the mapping. Use actual paths and hashes from reads. Re-import to refresh Xcode target membership after adding source files; changing a factory or source requires native rebuild/relaunch and a fresh capture. Swift globals and services remain shared; choosing application context explicitly runs real app initialization. Use `canvas_native_preview_catalog` for existing component factories, animation evidence and local assets, and select component previews through `canvas_import.swiftPreviews`. A factory or animation hint is not proof of visible content or motion. See [Swift limits](swift-xcode-builds.md).

## Explore directions, then carry a choice back

A design direction is a scoped object the primitives read, not a global. Declare what a direction changes in a project module, scope it to the frame, and let the relevant primitives read it; the same screen source renders both directions side by side. New screens live in `lib/screens/<name>` exactly as they would in the app, with a thin `screens/<name>.tsx` frame.

`canvas_origin_diff` (CLI `diff`) returns unified diffs of every override and added file with the app path each would land on, and `candidate: false` for canvas-only code under `lib/canvas/` and `lib/shims/`; `canvas_doctor` lists the same as `diverged`, `added` and `canvasOnly`. `canvas_origin_apply` (CLI `apply --files`) copies chosen files into the app at those paths, refuses a file whose origin changed since the import unless forced, and never deletes. Use it only when the person has chosen a direction and asked for it.

## Verify

```sh
mobile-canvas studio status --project designs/native-studio
mobile-canvas studio zoom 1 --key focus --project designs/native-studio
mobile-canvas studio capture --project designs/native-studio
mobile-canvas doctor --project designs/native-studio
```

The MCP path:

1. `canvas_read`, then `canvas_studio_open` with its identity and optionally `screen`. The receipt is acceptance, not readiness.
2. Poll `canvas_studio_state` while starting. Require `connected`, `ready`, the intended `hostId`, and a current, error-free receipt for every mounted screen: `readyCount` equals `expectedCount`, each screen's `codeVersion` equals the latest read. `console` lists recent warnings and errors from the shared runtime (the on-screen LogBox banner is disabled); `mountedCount` says how many of `screenCount` frames are mounted. `host.viewport` is the part of the board the window shows, in board points, and `host.note` is the host's last diagnostic line, so an agent can tell which frames a capture will include before taking it.
3. `canvas_studio_control` with identity, `hostId` and an action: `focus`, `reset`, `fit`, or `zoom` with `scale` (0.25 to 1.5) and optional `screenId`. It returns an accepted command ID; the host's `acknowledged` value proves it was consumed.
4. `canvas_studio_capture` with identity and `hostId` returns provenance (`method` is `host` for the host's own render, `screen` for the ScreenCaptureKit fallback) and a PNG of the current viewport. Inspect the image; use the environment's native computer tools for pointer interaction. Natively presented sheets are absent from the host's own render.
5. Iterate through hash-checked `canvas_batch` calls and confirm the new `codeVersion` in every affected receipt. `canvas_history` undoes or redoes a whole transaction.

For contributors working from a source checkout, a terminal helper can call the real stdio MCP server (this script is not in the installed package):

```sh
node --import tsx scripts/mcp-call.ts designs/native-studio list
node --import tsx scripts/mcp-call.ts designs/native-studio canvas_read
node --import tsx scripts/mcp-call.ts designs/native-studio canvas_batch .context/transaction.json
```

It prints JSON for text results and saves image blocks under `.context/mcp-images/`. Stale identity failures need a fresh read, not a retry. `mountedAt` and `codeVersion` are runtime evidence, not pixel evidence; keep errors visible and judge the design from the image and from using it.
