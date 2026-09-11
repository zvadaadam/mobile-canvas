# Project adapters

Language-specific source analysis belongs here. The shared project store owns documents, source hashes, request receipts and undo; adapters feed its typed commands rather than writing manifests directly.

- `index.ts`: selects the Expo or Swift native build adapter.
- `expo/`: Expo dependency inspection, import planning, Router discovery, finite pagers/guards, route cards and observed route examples. Analysis reads source; it does not execute it.
- `swift/`: Xcode membership, SwiftSyntax scanning, navigation, local construction recipes, composed states and build preparation. `Scan.swift` is a compiler helper invoked by `scan.ts`, not part of the previewed app.

Rendering is separate: `apps/native-host` and `apps/linked-host` provide Expo content; `apps/swift-host` provides Swift content. All use `packages/native-canvas`. Shared process/Metro/build tooling lives in `src/runtime/host`.

The adapters intentionally retain different analysis and build pipelines. Swift construction rules and Expo hook/router instrumentation are not interchangeable. Add a shared abstraction only for behavior that actually has the same contract; keep unsupported inputs explicit.
