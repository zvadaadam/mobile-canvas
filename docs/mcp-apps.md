# Embedded review with MCP Apps

Mobile Canvas can show a screen map and native screenshots inside an MCP Apps-compatible client. The native iOS renderer continues running on your Mac; the embedded HTML is a review interface over the same project/runtime. It does not replace UIKit or SwiftUI with web components.

This feature is currently in the source checkout. The published 0.1.0 archive predates it.

## Local setup

From the Mobile Canvas checkout:

```sh
npm ci
npm ci --prefix apps/mcp-app
npm run build:mcp-app
```

Configure a compatible desktop client's local MCP server:

```json
{
  "mcpServers": {
    "mobile-canvas": {
      "command": "node",
      "args": ["/absolute/mobile-canvas/bin/mobile-canvas.mjs", "mcp", "--app", "/absolute/your-app"]
    }
  }
}
```

Use the absolute Node executable path if the client does not inherit your terminal PATH. Existing Canvas projects use `--project /absolute/experiment` instead of `--app`. Add `--offline` for the supported disconnected Expo preview. Native prerequisites still apply; run setup first as described in [installation](distribution.md).

Ask the agent to **show the Mobile Canvas review**, or call `canvas_view`. A compatible client loads the UI from the local MCP server. Clients without Apps support still get a text summary and retain the existing tools.

Claude Desktop documents local stdio MCP Apps in its [getting-started guide](https://claude.com/docs/connectors/building/mcp-apps/getting-started). VS Code also documents [MCP Apps support](https://code.visualstudio.com/api/extension-guides/ai/mcp). Availability and configuration depend on the installed client; plain MCP tool support does not establish UI support.

A remote client whose MCP connection runs in the cloud cannot directly call this Mac's loopback server. That needs a separate bridge or authenticated remote deployment. This implementation uses local stdio and does not open a public endpoint or create a tunnel. A local server also does not make a cloud-based model local: tool data supplied to that agent is subject to its host/provider's handling.

## Review a screen

1. Open the embedded review. The list includes all authored and imported frames; the flow uses existing content-navigation links and arrangement. Missing previews stay in the map.
2. Choose **Open native canvas** to explicitly build/run the renderer. Loading the embedded map does not run the app.
3. Select a screen. If a native host already exists, selection requests a fresh inspection; otherwise open it first. The native window may come forward so the capture reflects actual current rendering.
4. Read the native image, source path, notes and destinations. **Inspect screen** takes another capture. The timestamp and dimensions identify the image; an earlier capture is labeled after the project's sequence or code version changes.
5. Click a destination to inspect it. Use **Flow map**, search or **Expand** to navigate the review. Expansion depends on the host's supported display modes.

The screenshot is not an interactive iOS surface: use the native canvas for text input, gestures, sheets and animation. The existing CLI/MCP editing tools still own source edits, fixtures, undo and apply. This review adds no second editor or project store.

The map follows source-derived links, not exhaustive runtime reachability. Capturing a blank or unavailable screen is not proof that its state works. The existing Expo/Swift service, frame-count, reload and build limitations still apply; see [the agent workflow](agent-workflow.md).

## Implementation boundary

`src/runtime/mcp-app.ts` adds the review tools/resource over `CanvasClient`. `src/shared/mcp-app.ts` describes the small view projection. `apps/mcp-app` owns the HTML, styles, UI behavior and separate browser SDK dependency graph. The native renderers and source adapters do not change.

`canvas_view` declares `ui://mobile-canvas/review.html`, served as `text/html;profile=mcp-app`. It returns an ordinary text fallback plus structured view data. `canvas_app_action` is marked visible to the app only, for metadata refresh, explicit native open and inspection. The host enforces that visibility. The server still validates identity and forwards native actions through the existing runtime; UI visibility is not authorization to bypass those checks.

Fresh PNG data travels in the inspection result's `_meta`; the embedded UI never fetches capture files from a filesystem URL. Selection uses `updateModelContext` to tell a supporting agent host which screen the person chose, without requesting another model turn. Existing `canvas_inspect_screen` still returns image content when the agent itself needs to see pixels. Do not assume a UI-only image has automatically been seen by the model.

The resource bundles its JS/CSS and declares no external connection/resource domains. It uses the host bridge for tool calls, escapes app text through DOM text APIs, requests no device permissions, and has no direct access to the runtime's HTTP endpoint. Project mutations retain workspace/sequence and source-hash checks; a stale action fails and asks for refresh. Metadata polling pauses when hidden and never starts a renderer or captures automatically.

The UI pins Apps SDK 2.0.0. Runtime registration uses Apps SDK 1.7.5 with the existing MCP SDK 1.30.0; these remain in separate dependency graphs. Upstream explicitly documents that the [1.x and 2.x wire protocols interoperate](https://github.com/modelcontextprotocol/ext-apps#readme). The UI build emits one HTML file and the bundled dependencies' full license notices. `prepack` builds it from a checkout; an installed archive reuses its packaged HTML.

The approach follows the current [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx): a tool-linked resource, host-controlled sandbox, bridge-mediated actions and graceful text fallback. It does not use legacy remote-DOM rendering.

## Reproduce validation

```sh
npm run check
npm run check:mcp-app
npm test
npm run test:package
```

The tests exercise a real MCP client/server connection, UI resource delivery, text-only compatibility, authored frame coverage, stale identity rejection, missing-host capture errors, and installed-package inputs. They do not establish visual correctness in a commercial client.

The local browser/native trial used upstream basic-host at `6d9bdc7babf275b759225aa722cbf5510c4c6021`. It displayed Hot Chocolate's 6-frame map and Clarity's 19-frame map, then inspected real native captures of Flavours, Flavours Detail, Locations Detail, Clarity's first onboarding step and its home screen. It also exercised fullscreen, theme changes, a narrow pane, search, stale-capture labeling after an experiment edit, stale-action rejection and renderer shutdown. The test edit was undone; the original apps were untouched. These five inspected states do not establish complete coverage or service fidelity. Claude Desktop, VS Code and Swift captures have not been visually tested through this embedded UI.

For a native end-to-end trial, build the [official basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) and point its `SERVERS` at this development transport:

```sh
node --import tsx scripts/mcp-app-dev-server.ts \
  --project /absolute/existing-experiment \
  --port 43182 --origin http://localhost:43180
```

This development script binds only to `127.0.0.1`, restricts browser origins and reuses or owns the experiment's runtime. It is not an additional published transport. Configure basic-host's host and sandbox ports independently; its example client also contains a sandbox URL that must match your chosen sandbox port. Do not reuse a port occupied by another development server. If placing the reference checkout inside a dot directory, its sandbox `sendFile` needs to allow that development path.

In the host, call `canvas_view`, open native, select a screen and inspect the actual returned image. Verify unavailable states, stale captures after an experiment edit, narrow layout and host theme changes. Stop only the test-owned processes afterward. Packaging success alone does not validate these pixels.
