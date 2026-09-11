# Resolving preview state

Screen discovery, screen construction and observed rendering are separate concerns. A route can be known without a constructor; a constructor can compile without a record; a mounted view can show loading or an empty state. Coverage reports must keep those distinctions.

## Current boundaries

| Concern | Shared | Swift | Expo |
| --- | --- | --- | --- |
| Identity and flow | Document, stable IDs, notes, links, arrangement | SwiftSyntax navigation analysis | Route, guard and pager analysis |
| Construction | Explicit open, provenance in metadata | Existing previews, default initializers and source-derived recipes | Actual React app providers and route entries |
| Local examples | No silent edits to the imported app | Typed local models and supported lexical bindings | Observed rendered hrefs supply missing route parameters |
| Execution | Native canvas geometry, focus, capture and command loop | SwiftUI hosting controllers; native compile/relaunch | SDK-matched React Native hosts; Metro reload |
| Evidence | Versioned receipts and image inspection | Missing recipe/record reported separately | Missing parameters, empty route output and errors reported separately |

A Swift parser improvement does not alter React rendering. Expo already retains its actual provider tree, whereas extracted Swift views need their state-owning parent reconstructed explicitly. Both need an honest account of where example data came from and whether the running screen can use it.

Agent inspection now activates the experiment's existing native window and waits for a new screen receipt before capture. In native testing, an inactive iOS-on-Mac window retained an earlier unavailable/loading image after its model and accessibility content had changed. Activation allowed its visible content to update. This fix is in the shared runtime and applies to both adapters; it deliberately brings the inspected canvas forward. It does not establish that every asynchronous image or service has finished loading.

## Implemented structural improvement

The Swift planner now reconstructs supported `ForEach` element bindings and nested `if let` bindings in their original owner. It chooses the first existing collection element and guards absence. Unknown callback parameters, arbitrary local computations and unsupported binding forms are rejected.

Complete typed owner construction precedes optional record guesses. An asynchronously loaded list can therefore supply a detail through the list's lifecycle, instead of extracting the still-empty collection directly from a distant demo root. Among source constructors, fewer guarded inputs win, then a shorter owner path, then stable source order. Paths are bounded and cycles rejected.

DEUS provides the concrete case: `WorkspaceReviewDemo` owns a model; `ChangesView` loads its session changes; its `ForEach` constructs `TurnChangedFileView`; that view supplies `ToolEditDiffView`, which constructs `CodeDiffContent`. These are existing application expressions and local examples, not generated business records. The generic extraction logic lives in `adapters/swift/projection.ts`; selection remains in `recipes.ts`.

This is deterministic source planning for fixed inputs. It does not make asynchronous application execution deterministic, try every alternative at runtime, or prove every screen has useful data. Retaining lifecycle code may also retain service side effects; this is not a sandbox.

## Further work with value for both adapters

1. **Explicit example candidates.** Preserve alternatives with stable IDs and provenance, including which owner/provider and inputs they require. Let the user select a state without changing the canonical screen identity. Keep a chosen candidate stable across source edits. The current Swift planner selects one recipe; it does not retain a user-selectable candidate catalog.
2. **Dependency-aware state preparation.** Each language adapter should describe and prepare its dependencies. Swift needs model ownership, environment values and local services; Expo needs provider/store state as well as route parameters. Passing a session ID cannot populate a disconnected Convex query. Serializing arbitrary Swift objects or React stores into a universal fixture is not a sound default.
3. **Evidence after preparation.** Distinguish construction failure, waiting for data, an authored empty/loading state and an exception. A receipt or non-null React element alone is insufficient to prove useful pixels. Report the tested state and capture, rather than labeling every known route available.
4. **App-local contracts for missing examples.** When source has no usable example, accept a small explicit preview contract or service fixture in the experiment. Do not silently fabricate schemas, authenticate, or replay side-effecting actions to reach a screen. These contracts can share metadata while retaining language-specific execution.

Hot Chocolate's bundled records and rendered links already provide useful route examples. Clarity's session-dependent screens need actual session/query state in addition to route IDs. Improving Swift lexical projection alone cannot fill that gap. Hardware and authentication remain separate requirements; unsupported Xcode target graphs, arbitrary state machines, Swift navigation pinning and service isolation also remain incomplete.

## Acceptance

Test a supported pattern in an ordinary small app, then in an independently maintained app, then check native images and source provenance. Preserve missing destinations in the flow. Run the pinned Expo mapping and native capture corpus after shared-host changes. Passing this corpus is regression evidence for those cases, not a claim of universal app compatibility.

Swift now supports explicit application context and unambiguous app-authored environment provider recovery. These prepare some previously blocked factories without claiming their model state is complete. BetterMind illustrates the remaining distinction: a configured service can coexist with a blank authentication guard or a mock whose loading flag was never set. See [Swift build adapters](swift-xcode-builds.md) for the measured 75-frame pass and limitations.
