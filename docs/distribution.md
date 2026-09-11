# Install Mobile Canvas on a Mac

This is a local npm package for Apple-silicon Macs. It installs the CLI, MCP server and native host templates. Canvas builds and signs the iOS renderer on your Mac using Xcode. The versioned GitHub release is installable through npm; npm-registry publication is separate. There is no notarized installer or cloud build in this workflow.

## Install the release

Use a user-managed Node installation (no sudo):

```sh
npm install --global https://github.com/zvadaadam/mobile-canvas/releases/download/v0.1.0/mobile-canvas-0.1.0.tgz
mobile-canvas setup
```

The release includes `SHA256SUMS` for the downloadable archive. You do not need a source checkout or npm account to install it. To update, install the URL for the new release; `npm update -g` does not track these GitHub release URLs. Remove the executable with `npm uninstall --global mobile-canvas`; your projects and per-user caches are retained.

Maintainers can build exactly the same package locally with `npm ci` and `npm run package`. Ordinary `npm pack` and `npm publish` also prepare the required native host dependency snapshot through `prepack`. Install the release tarball rather than an arbitrary Git checkout. No package install hook builds an app or configures your Mac.

The setup checklist explains missing requirements. Native previews require Apple silicon, arm64 Node 22.14+, full compatible Xcode with its initial setup completed, CocoaPods, and development signing configured in Xcode. Bun is needed for apps using Bun lockfiles or patches. Install Expo in the app, not globally; a separate global Expo CLI is unnecessary.

Xcode, its license and your Apple account are configured by you. Setup does not accept agreements, install system tools or change accounts. It links to the tool installation guides. Setup reuses a saved team. If exactly one team has a valid local Apple Development signing identity, it selects and saves that team automatically. With multiple teams, an interactive terminal offers a numbered choice; with none, it explains Xcode account setup. Return skips the choice. `--team` remains an explicit override. `setup --json` is read-only unless you explicitly pass `--team`.

## Open an existing app

From the Expo app's root folder, install its dependencies from its lockfile and check the environment:

```sh
cd /path/to/expo-app
mobile-canvas setup --install
mobile-canvas open
```

`setup`, `open`, `map` and `mcp` detect the current Expo app root. Commands also recognize a current Canvas project root. Explicit `--app` / `--project` paths take precedence; detection does not walk to parent folders or evaluate app configuration. The command is `mobile-canvas setup`, not `expo setup`.

`--install` explicitly runs `npm ci` or `bun install --frozen-lockfile` in the app directory. It downloads dependencies into `node_modules` without asking Canvas to rewrite app source or lockfiles. Package installation can execute package lifecycle scripts, like the app's normal dependency installation. Automatic installation requires a supported lockfile; other package managers need their ordinary app setup first. Re-running `--install` is optional after dependencies are installed.

For a design preview without service credentials, add `--offline` to **both** commands:

```sh
cd /path/to/clarity
mobile-canvas setup --install --offline
mobile-canvas open --offline
```

Offline design preview disconnects supported integrations. It does not mean dependency downloads work without internet. If a package manager reports missing private packages, setup rechecks whether they are required for the selected preview. Missing required packages still block launch. Services and missing session data remain explicitly unavailable; no records are invented.

The first open prepares a separate host, installs matching dependencies, compiles/signs it, starts Metro and opens the native canvas. Subsequent opens reuse the build. The CLI reports preparation messages; detailed native logs are in the generated project's `.expo-canvas/native-build` directory. Keep the `open` terminal running, or let an MCP session own the runtime. Native app source, auth and build compatibility limitations are described in [drop-in previews](drop-in.md).

## Why signing needs a team

Canvas compiles its own iOS renderer, including the imported app's native modules, to run on this Mac. Xcode associates the local development signature and provisioning with an Apple development team. Installing Expo or signing into an Expo account does not supply that identity. A Team ID is an identifier, not a password; private keys stay in Keychain. Canvas discovers teams from public certificates matched to valid development signing identities, using the certificate's organizational-unit field rather than its display-name suffix.

The team is needed for this native build path, not for npm installation, source-only maps or MCP source inspection. This is development signing, separate from eventual notarization. See [Apple's signing workflow](https://help.apple.com/xcode/mac/current/en.lproj/dev60b6fbbc7.html).

## Where files live

- **Installed npm package:** source/templates, treated as read-only.
- **Settings:** `~/Library/Application Support/Expo Canvas/settings.json`. Stores the Team ID, not certificates or Apple account credentials. `EXPO_CANVAS_DEVELOPMENT_TEAM` overrides the saved team.
- **Shared generated files:** `~/Library/Caches/Expo Canvas` for installed authored-host builds and the capture helper. When a build lives under the macOS temporary directory, its runnable iOS wrapper is staged under `~/Library/Caches/Expo Canvas/renderers/<build-path-hash>` before launch; this also applies when tests override the main cache directory.
- **Linked app experiments:** `~/.expo-canvas/apps/<app-path-hash>` by default, with their own `.expo-canvas/native-host` and `native-build` directories. `--project` selects a separate location. These projects also hold your notes, overrides and history: do not delete the whole project as if it were a build cache.

Tests can isolate settings/cache through `EXPO_CANVAS_DATA_DIR` and `EXPO_CANVAS_CACHE_DIR`. A source checkout retains its existing SDK 54 host/build paths for development. Native dependency/build directories can occupy several GB per app.

## Create an authored project

The installed package also carries the SDK 54 authored-screen host and a frozen dependency snapshot. Build it with the installed executable:

```sh
mobile-canvas setup --team YOURTEAMID
mobile-canvas build
mobile-canvas init --project /path/to/my-design --name "My design"
mobile-canvas screen add --project /path/to/my-design --key home --name Home
mobile-canvas open --project /path/to/my-design
```

`build` downloads and compiles that host in the per-user cache. `build --incremental` rebuilds after native shell changes when a full build already exists. Linked Expo 56/57 apps instead prepare their matching host automatically during `open`.

## Connect an agent

Use the installed executable, with an absolute path if the agent doesn't inherit your terminal PATH:

```json
{
  "mcpServers": {
    "mobile-canvas": {
      "command": "mobile-canvas",
      "args": ["mcp", "--app", "/absolute/path/to/expo-app", "--offline"]
    }
  }
}
```

Read `mobile-canvas skills get core` for the installed workflow (`--full` adds editing examples). MCP exposes the same content through `canvas_read_skill` and the `mobile-canvas://skills/core` resource. See [the agent workflow](agent-workflow.md).

MCP startup maps source. `canvas_studio_open` explicitly executes it. `canvas_environment` provides the shared prerequisite report; `mobile-canvas setup --json` exposes it to scripts. Source-only maps do not require Xcode.

## Validate before sharing

```sh
npm test
npm run check
npm run test:compat
npm run test:package
npm run test:package:native
```

The slow native package test installs a tarball outside the checkout, makes its package directory read-only, uses isolated settings/cache and fresh project paths containing spaces, downloads the pinned test apps' dependencies, builds their native hosts, captures representative screens through the installed MCP server, checks source diffs and tests cached reopen. It retains artifacts for visual review and writes `.context/distribution/native-package-test.json`. It requires the Mac's existing Xcode/signing and network access; it is not a second-Mac test. `--resume /path/to/test-directory` retries an existing acceptance run after a fix; its timings reuse intermediates and must not be described as a clean cold build. The three-app source corpus remains in [compatibility](compatibility.md).

A local package passing these checks is suitable for a supervised developer trial, not proof that four other Macs are already configured. Run setup on each tester's machine. Known SDK 57 full-reload crashes and other preview fidelity limitations remain documented in [compatibility](compatibility.md).

The onboarding currently lives in the npm command's setup flow. A native welcome window before Xcode/signing are available is not included. A shorter registry command (`npm install -g mobile-canvas`) requires npm publication; it is not the installation command for this GitHub release. A notarized Mac bootstrap remains a separate distribution step. Copying today's development-signed iOS wrapper into a DMG is not a verified public Mac installation path; see [Apple's distribution comparison](https://developer.apple.com/macos/distribution/).

## Maintainer release procedure

1. Run the public CI checks and installed-package smoke test on the exact release commit. Native acceptance uses the separate Mac test above.
2. Run `npm run package`, compute `shasum -a 256 mobile-canvas-<version>.tgz > SHA256SUMS` in the output directory, and attach both files to a GitHub release tagged `v<version>` at that tested commit. Do not use GitHub's automatically generated source archive as the npm artifact.
3. Test the public release URL by installing into a fresh npm prefix, then run its CLI and MCP. Existing releases are immutable: bump the version for changed bytes.
4. For npm-registry publication, sign in with `npm login`, confirm package-name ownership/access, and publish the same tested tarball with `npm publish /path/to/mobile-canvas-<version>.tgz --access public`. Complete any npm browser/2FA challenge locally; never put credentials in this repository. Update the installation instructions only after verifying the registry package.

## Existing Expo Canvas projects

The primary package and command are now `mobile-canvas`. If you installed an earlier `expo-canvas` tarball globally, first run `npm uninstall --global expo-canvas`, then install the Mobile Canvas release; this avoids a bin-name collision and retains your projects and settings. The `expo-canvas` executable remains a compatibility alias. Existing `expo-canvas.json` documents, `.expo-canvas` project data, per-user Expo Canvas settings/cache paths, `EXPO_CANVAS_*` environment variables and `@expo-canvas/preview` imports remain readable without migration. Generated MCP configurations use the new executable. Native bundle identifiers remain stable so existing development provisioning can be reused.
