# Contributing

Canvas runs real iOS interfaces in one native Mac window. Start with [the product goal](goal.md), [architecture](docs/architecture.md) and [repository instructions](AGENTS.md). Expo and experimental Swift support share a document/runtime and native shell, while retaining their own analysis and rendering code.

## Repository map

```text
bin/                         npm executable entry point
src/shared/                  document and loopback protocol contracts
src/runtime/                 project transactions, server, CLI and MCP
  adapters/expo/             Expo source/dependency analysis and import planning
  adapters/swift/            Swift/Xcode analysis and native build strategy
  host/                      launch, capture/build preparation and Metro tooling
packages/native-canvas/      shared Swift canvas shell, assets and capture tool
packages/preview/            React hooks supplied to authored preview components
apps/native-host/            authored Expo 54 renderer and build template
apps/linked-host/            Expo 56/57 linked-app renderer template
apps/swift-host/             SwiftUI/UIKit renderer and native capabilities
designs/native-studio/       small authored example, not an exported source app
tests/fixtures/swift/        ordinary Swift apps for public regression tests
tests/compatibility/         pinned external app definitions
scripts/                    packaging and compatibility entry points
docs/                       guides, architecture and historical investigations
```

The root npm package ships the runtime and host source templates together. `apps/` and `packages/` identify ownership, not independently installable products. The Expo host has a separate dependency graph because it pins a native SDK. Adding workspaces would change that resolution model; it is not necessary to give these directories clear boundaries.

## Start with the public tests

With Node 22.14+ and Git:

```sh
npm ci
npm ci --prefix apps/native-host
npm run check
npm test
npm run test:compat:public
npm run test:package
```

The host dependency install supplies the Babel transforms and native package metadata exercised by the unit tests; it does not compile or launch an app. The public corpus fetches only pinned Hot Chocolate and Clarity source. It never installs or executes their applications. macOS unit tests also invoke the Swift scanner and need compatible Xcode; those tests are explicitly skipped on other systems. Passing non-Mac tests is not native validation. The package test installs a tarball in a temporary prefix and verifies the actual CLI/MCP without compiling an app.

The public GitHub Actions workflow uses Node 22.14 and Xcode 26.3 on macOS 15. It runs these checks plus the Expo host TypeScript check, with read-only repository access and no signing credentials. Native unit tests also type-check the shared UIKit shell with Swift 6 isolation and exercise session decoding, stale reads, selection ordering, cancellation and reconnects against a local test server. Signed builds and pixel checks remain maintainer acceptance steps.

Maintainers additionally run `npm run test:compat`, which includes the access-controlled Workout reference. Private Swift regression is explicit:

```sh
CANVAS_TEST_BETTERMIND=/path/to/pinned/bettermind-checkout npm run test:compat:swift
```

The private runner verifies revision and clean source state; it never fetches or changes the app. Ordinary unit tests use repository-owned Swift fixtures and do not need that checkout.

## Work on native code

Use an Apple-silicon Mac, compatible Xcode and development signing. Follow [Mac setup](docs/distribution.md) and [native compatibility](docs/compatibility.md). The first authored Expo host build is:

```sh
npm ci --prefix apps/native-host
node bin/mobile-canvas.mjs setup
npm run studio:build
node bin/mobile-canvas.mjs open --project designs/native-studio
```

Shared canvas source is in `packages/native-canvas`; Expo-specific native code is in `apps/native-host/native/ExpoRenderer.swift`. `studio:build -- --incremental` stages current sources and assets before recompiling an existing target. Native dependency/plugin changes require a full build. Stop and reopen the relevant canvas after rebuilding. Swift projects compile their own generated target on explicit open.

After host/resolver changes, open the listed native experiments and run `npm run test:compat:native`; inspect the images as well as receipts. Do not stop unrelated simulators, Metro servers or agents. A rendered frame can still lack app data; report unavailable services separately from crashes or rendering failures.

## Keep contributions bounded

- The shared contracts have no filesystem, process or renderer dependencies.
- Mutations use the project store's executor, sequence checks and source hashes. Preserve notes, links, history and stable frame IDs.
- Never modify a linked app during an experiment. Keep generated apps, logs and captures under ignored project/cache directories.
- Do not replace native controls with browser approximations or add a second human UI.
- Keep source discovery separate from execution and preview availability. Explain unsupported cases instead of inventing records or implying complete coverage.
- Include the relevant tests and native evidence in a change description. Avoid committing credentials, local signing settings or private app sources.

Contributions are provided under the [MIT License](LICENSE). Keep the [third-party notices](THIRD_PARTY_NOTICES.md) with redistributed assets. See [distribution](docs/distribution.md) for the release procedure and remaining native installation requirements.
