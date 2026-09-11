# Native canvas shell

Shared UIKit sources for the one human canvas window. Both Expo and Swift renderers compile these files into their iOS-on-Mac application.

- `Sources/CanvasHost.swift`: window/controller, layout, flow and native capture orchestration.
- `Sources/CanvasWire.swift`: typed session, screen, mutation receipt and host-command decoding; arbitrary JSON props stay intact.
- `Sources/CanvasRuntimeClient.swift`: cancellable loopback HTTP requests, response decoding and errors.
- `Sources/CanvasSession.swift`: native session projection, polling, stale-read protection and serialized selection writes.
- `Sources/CanvasFrame.swift`: frame view/window ownership, mounting, focus cover and cleanup.
- `Sources/CanvasViewport.swift` and `CanvasCamera.swift`: pure focus/fit geometry and interruptible native animation.
- `Sources/CanvasStyle.swift`: shared colors, fonts and hairlines.
- `Sources/CanvasInspector.swift`: inspector, screen navigator and canvas controls.
- `Sources/CanvasRenderer.swift`: renderer/frame protocol; no React dependency.
- `Resources/`: canvas wordmark, font and their license notices.
- `Tools/capture.swift`: separately compiled ScreenCaptureKit fallback, not an application source.

This is a shared source bundle, not a separately published npm library or standalone Swift package. The imported app's native dependencies determine the actual Xcode target. Expo's renderer is in `apps/native-host/native/ExpoRenderer.swift`; Swift's renderer is in `apps/swift-host/`.

`src/runtime/host/canvas-template.ts` stages sources/resources into generated Expo hosts before building. In a source checkout, `apps/native-host/native/Canvas*.swift` and `apps/native-host/assets/` are ignored build copies. Edit this directory, never those copies. Swift builds read this bundle directly. Both build paths account for shared source/resource changes; the capture executable is cached by source hash.

All top-level `Sources/*.swift` files belong to both native targets. Full and incremental Expo builds register these files automatically; Swift target preparation enumerates the same bundle. Adding a source does not require editing parallel filename lists.

`tests/native-canvas.test.ts` type-checks the shared shell and Swift renderer against the iOS SDK with both Swift 6 default isolation modes, then runs the Foundation model/client tests against an ephemeral loopback server. Its session fixture comes from the real TypeScript project store. These tests need Xcode but no signing team, private app or running canvas; rendered pixels are still verified separately.
