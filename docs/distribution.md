# Mac developer package

Expo Canvas can be installed from an npm tarball. This packages the CLI, MCP server, preview hooks and native-host source templates. It does not include a pre-signed universal Mac renderer, app projects, credentials, node_modules or native build caches. Nothing has been published to the npm registry; `private: true` still prevents accidental publication.

From the source checkout:

```sh
npm install
npm run package
npm run test:package
```

Send `.context/distribution/expo-canvas-0.1.0.tgz` to another developer. On their Mac:

```sh
npm install --global /path/to/expo-canvas-0.1.0.tgz
expo-canvas setup --app /absolute/path/to/expo-app --offline
export EXPO_CANVAS_DEVELOPMENT_TEAM=YOURTEAMID
expo-canvas open --app /absolute/path/to/expo-app --offline
```

Use a user-managed Node installation so npm does not require sudo. The setup command is read-only, exits nonzero for missing requirements, and returns each check with its next action. Repeat it after configuring signing. It checks Apple-silicon/arm64 execution, Node 22.14+, full Xcode and its first-launch setup, CocoaPods, development signing configuration, supported installed Expo SDK, direct app dependencies and Bun when required. No tools are installed automatically and no Apple agreements are accepted. A missing signing identity is a manual check because Xcode may create one during provisioning. Passing setup does not guarantee signing permissions, native-module compatibility, service access or rendered pixels.

A fresh linked-host launch performs the same checks before dependency installation and compilation. `canvas_environment` exposes them through the existing loopback runtime to MCP. A cached host can reopen without repeating the cold-build checklist. A native first-run welcome UI is not included in this package: the current native window itself requires a built, signed renderer. A future standalone Mac launcher can display the same report before building that renderer.

For an agent, configure the installed executable (use an absolute path when the agent does not inherit your shell PATH):

```json
{
  "mcpServers": {
    "expo-canvas": {
      "command": "expo-canvas",
      "args": ["mcp", "--app", "/absolute/path/to/expo-app", "--offline"]
    }
  }
}
```

MCP startup maps source; `canvas_studio_open` explicitly executes the app. Source-only mapping and MCP do not need Xcode. Native previews require an Apple-silicon Mac, compatible macOS/Xcode, CocoaPods, app dependencies, a usable development signing team and network access for initial dependency downloads. The automatic linked native path supports Expo 56/57. The authored SDK 54 host requires a separate host dependency install/build; the npm smoke test does not certify that build path. SDK 57 full native reload remains a known crash risk.

## Distribution boundaries

The current renderer is an iOS target compiled for Xcode's “Designed for iPad” Mac destination, signed for development, launched with local runtime arguments and dependent on Metro. Copying the wrapped `.app` or placing it in a DMG does not turn it into a standalone Mac product.

Apple lists iPhone/iPad apps on Apple-silicon Macs as an App Store distribution path, and documents TestFlight and development/ad-hoc export for testing. Developer ID/notarization is the direct-distribution route for macOS apps; it must not be assumed to make this development-signed iOS wrapper universally installable. See [Apple's distribution comparison](https://developer.apple.com/macos/distribution/) and [running iOS apps on Mac](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos).

A no-Xcode download would need a supported distribution strategy for the actual iOS renderer, bundled or managed Node/Metro, writable per-user build/cache locations, first-run project selection and checks, and an update strategy. A Catalyst renderer would need separate verification of native control fidelity and native module compatibility; it cannot be assumed equivalent to the current iOS runtime. No browser renderer is part of this proposal.

For now, the npm tarball is the concrete developer distribution path: recipients build/sign the native host locally. Public npm publication additionally needs a chosen package name/scope, registry ownership and release metadata/license decisions. No account configuration or publication is performed by packaging. npm documents the tarball workflow in [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/).
