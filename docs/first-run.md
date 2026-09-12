# Try Mobile Canvas on another Mac

Start with a known app before trying your own. This makes it easier to tell a Mac setup problem from an unsupported app dependency.

## 1. Install and check the Mac

Install the [published release](distribution.md#install-the-release), then run:

```sh
mobile-canvas setup
```

Native previews need an Apple-silicon Mac, arm64 Node 22.14+, compatible full Xcode, and a valid local Apple Development signing identity. Expo builds need CocoaPods; Bun-based apps need Bun. Setup reports missing requirements and helps select a signing team. No global Expo CLI is needed.

Complete the reported manual steps in Xcode and run setup again. Package installation alone does not establish that native builds will work. [Signing and setup details](distribution.md#why-signing-needs-a-team).

The public `0.1.0` archive includes the native canvas, CLI and MCP tools. The embedded MCP App is a source preview and needs the [separate checkout instructions](mcp-apps.md). Installing `0.1.0` will not add `canvas_view`.

## 2. Open a known app

Use a new folder for this pinned Hot Chocolate checkout:

```sh
git clone https://github.com/expo/hot-chocolate.git hot-chocolate-canvas-demo
cd hot-chocolate-canvas-demo
git checkout --detach 1806f3b8fca27ddd23d554484db779525adde3f3
mobile-canvas setup --install
mobile-canvas open
```

Keep the last command running. The first launch downloads and compiles native dependencies; allow several minutes and follow the progress messages. Later launches reuse the build. Native build/cache directories can occupy several GB.

You should see six mapped frames. Select **Flavours**, inspect its populated list, then visit **Flavours Detail** and **Locations Detail**. Those detail views need a real route example; the preview discovers examples from rendered links. The flow is inferred from content navigation, so tabs and back controls do not add connector lines.

Use the screen list to focus an entire frame. Use the canvas toolbar to fit the flow or zoom in; interact with native controls in the focused frame. Stop and reopen that project's canvas to check the cached launch.

For a second regression app, use [Clarity's pinned checkout](compatibility.md#fresh-native-test-setup) with `--offline` on both setup and open. It maps 19 designs, including five onboarding steps. Session records and subscription services can remain unavailable.

## 3. Connect your agent

The native canvas's **Agent** panel provides configuration for the open experiment. Alternatively, use the [README's MCP configuration](../README.md#work-with-an-agent). Connecting MCP maps source; opening the native canvas is an explicit action.

Give a CLI agent this starting instruction:

> Read `mobile-canvas skills get core`, then use Mobile Canvas for this app. Inspect native screenshots before judging the UI. Keep the original source unchanged unless I explicitly ask you to apply an experiment.

For an MCP agent, replace the first instruction with “Read `canvas_read_skill`.” A skill installer is optional; [the agent workflow](agent-workflow.md) is bundled with the installed product.

## Prompts and expected results

### Understand an unfamiliar app

> Use Mobile Canvas to map this app. Inspect three representative screens and explain the main flows. Tell me which previews you couldn't verify. Don't change any files.

Expect screen names and source paths, actual image inspection, and a separate list of unavailable states. A route count alone is not a completed review.

### Review onboarding

> Inspect the onboarding steps in Mobile Canvas. Compare spacing, typography and button placement. Propose one small improvement in a separate experiment, capture the result, and leave the original app unchanged.

Expect a scoped proposal, experiment changes and fresh image evidence. No changes should be applied back to the linked app.

### Find why a screen is empty

> Inspect this empty screen in Mobile Canvas. Check its source, route parameters and preview status. Explain what is missing before suggesting a fix. Keep it in the flow.

Expect a distinction between a crash, missing route example, absent session record and unavailable service. The agent should not invent backend IDs to make a preview appear successful.

### Follow a connection

> Find the screen that links to this detail screen. Inspect both and explain the navigation. Use the existing sitemap rather than adding a copy for each item.

Expect stable screen IDs and content-navigation links. In linked Expo previews, navigation moves canvas focus while the source frame stays on its own route; Swift navigation is not yet fully pinned.

### Use the embedded review — source preview

> Show the Mobile Canvas review with `canvas_view`. Let me browse the screen map and inspect a screen. If this client does not support MCP Apps, use the ordinary sitemap and native inspection tools instead.

Requires a build containing the MCP App and a compatible client. The local reference-host trial covered Expo maps and native captures; commercial client and Swift embedded-capture acceptance are not established. Images in the UI do not automatically become image evidence for the agent. Touch interaction and animation stay in the native window.

## Record the trial

- Setup identifies this Mac's tools and signing configuration.
- Hot Chocolate opens with six frames; the list and representative details contain visible UI.
- Agent inspection focuses a frame and returns its native image, rather than only a readiness receipt.
- Closing and reopening the canvas reuses its build.
- Unavailable data/services are reported separately from crashes.
- `git diff --exit-code` in the sample checkout confirms tracked source stayed unchanged.

If something fails, record the app revision, installed version (`npm list -g mobile-canvas --depth=0`), macOS/Xcode versions, the setup or build error, and whether the failure occurred during installation, mapping, native opening or capture. Check logs before retrying. Share screenshots and relevant errors through an [issue](https://github.com/zvadaadam/mobile-canvas/issues), omitting credentials and private app content.

The existing validation used isolated installs and native captures on the development Mac. This checklist is for establishing what works on the second Mac; it does not assume that machine has already passed.
