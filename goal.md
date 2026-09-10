# Expo Canvas

Build a Figma-like workspace whose mobile screens are running Expo code.

An agent should be able to create a screen, render it with real native components, inspect the result, change its source or fixture props, and compare alternatives on an infinite canvas. A person should be able to arrange those screens and directly try toggles, buttons, sliders, navigation and animations in place.

The unit of design is an ordinary Expo component plus preview props. Several canvas screens may show different states of the same component. Mock state and navigation are enough: designing an interface must not require building its backend.

Actual native iOS appearance, including Liquid Glass, is essential in the design view. Visible screens run independently together, with their own view trees and fixture state; selecting a screen never swaps another screen's running UI. The experience must not require a Simulator app, and browser replicas are not a renderer.

Design comes before app implementation. Every screen carries its purpose, states, interactions and navigation context so an agent can explore the complete app coherently. Clicking the design should feel like trying the UI: native controls respond, animations play, and navigation reaches another canvas screen. Judge the workflow by an independent agent building and iterating an app through CLI/MCP, and a person actually using the resulting screens.

## Current product

- One portable project: `expo-canvas.json`, ordinary TSX under `screens/`, `components/` and `lib/`, optional `resolver` and `origin` for imported apps.
- One native macOS window in Expo's look: live frames with names above them, flow connectors between them, arrange, pan, zoom, inspector, undo and agent setup. `open --screen <key>` reveals one screen at 100%, like opening a URL, so a change can be checked without clicking through the app.
- One loopback runtime with a typed command executor, exposed to agents through the CLI and a stdio MCP server, with stable IDs, sequence checks and hash-checked source writes.
- An Expo 54 host that runs up to 32 screens in one iOS-on-Mac window, mounting each screen's surface when it scrolls into view, with real UIKit, SwiftUI and Liquid Glass and no CoreSimulator.
- Existing apps as design input: `import --link` runs an app's own source in place with project-side overrides keyed by app path; `diff` reviews the experiment against the app and `apply` carries chosen files back only when asked.
- Deterministic app previews: CLI/MCP `--app` creates a separate linked route map and renders Expo 56 and 57 routes through the actual app providers and native navigation. A cached SDK-matched host isolates JavaScript and default SQLite storage per frame, without agent-authored app shims or fixtures. Real route examples are observed from rendered links and recorded as props. Shared groups have one frame per source; recognized finite pagers expose pinned steps in their own band; navigation moves canvas focus without replacing the origin screen. Explicit `--offline` design previews disconnect supported services without keys; local UI stays real, with unavailable data and service-owned UI disclosed. See `docs/drop-in.md`.
- Tests for transactions, concurrency, import, review, arrange and the studio protocol.

## Existing-codebase experiments

Make it useful to bring an existing Expo app, explore different design systems or new screens, and compare alternatives before changing the original codebase.

Read the app in place, prepare a separate portable experiment project with representative mock data, and create independently editable directions on the canvas next to the baseline. Different fixture states may share source; different implementations need separate source or deliberately scoped themes. Global theme singletons must not leak one direction into another. People try each direction's native controls, navigation and animations, refine it with an agent, and request a reviewable change back only after choosing. Experiment creation never rewrites the original app.

Existing-app regressions use pinned upstream repositories, with source checkouts and generated linked projects under gitignored `.context/`. Hot Chocolate and Nathan Schroeder’s Clarity exercise the Expo 56/57 drop-in path with real navigation and providers; Workout retains source-only route mapping coverage. The curated workout export has been removed. See `docs/compatibility.md`. Still open: broader record-state exploration, cross-frame storage transfer, scheduling beyond 32 frames, and an iPhone-fidelity comparison.

## Later

Support Android, expose a richer inspection/accessibility surface, package the local runtime as an installable agent tool, and measure resource use and interaction latency against actual design sessions.

## Outside the product

AI image/video generation, media Workers, hosted editing, accounts, full app business logic, a generic vector editor, and an in-app agent chat. AI agents bring their own reasoning and code-writing tools; Expo Canvas provides a reliable design environment.
