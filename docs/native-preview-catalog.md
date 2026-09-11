# Component previews, animations and image fixtures

The native canvas can show an app's screen flow and selected component previews together. The component frames use the app's existing `#Preview` expressions. They have a “Component” suffix, no generated navigation links, and their own arrangement band. Re-import retains the selection, authored notes and explicit image fixtures.

## Discover and open

From the Canvas checkout, first map/open a Swift app in a separate experiment. Original source stays read-only:

```sh
node bin/expo-canvas.mjs open --app /path/to/swift-app --project /path/to/canvas
node bin/expo-canvas.mjs previews --project /path/to/canvas
```

`previews` is read-only. It inventories existing preview labels/factory IDs, animation source evidence and the target's bundled image assets. It does not run the app. Use a unique label or exact factory ID to add a component:

```sh
node bin/expo-canvas.mjs import --from /path/to/swift-app --project /path/to/canvas \
  --link --map --swift-preview MindIcon --swift-preview RemoteImage
node bin/expo-canvas.mjs open --project /path/to/canvas --screen mindicon-component
```

You can also add a selection while reopening an existing experiment with `open --project /path/to/canvas --swift-preview MindIcon`. Both `--project` and `--app` honor explicit selections on an already populated map.

Applications requiring their real SwiftUI App initializer need explicit `--swift-context application`; this starts real services and is not offline. Opening new factories requires a native rebuild. The canvas screen navigator can find the component by name or by searching “Component”. Its existing Reset command remounts the preview, replaying mount-driven animation.

MCP uses the same runtime: `canvas_native_preview_catalog` reads the catalog, `canvas_import.swiftPreviews` selects factories, `canvas_batch` edits frame fixtures, and `canvas_inspect_screen` focuses and captures their real native output.

## Animation evidence

The catalog follows visible constructor references and records file/line evidence for recognized SwiftUI animation, timeline, shader and Core Animation APIs. This is a candidate detector, not proof of motion. Event-driven animations require a changing input; timers, async data, gestures, custom shaders and helper functions may fall outside the analysis. For example, BetterMind's `RotatingBorder` has animation code but its constant-true preview never performs the change that starts it. Canvas does not synthesize or invoke arbitrary app actions to force it.

Existing preview controls remain interactive. There is no universal pause, seek, speed or animation timeline yet: SwiftUI animations, Metal time uniforms and UIKit particle systems require different controls. Capturing two distinct native frames can establish changing pixels; a single screenshot cannot.

## Explicit local images

The catalog lists image assets already bundled in the selected target. It does not download pictures or assume missing asset names exist. BetterMind currently supplies 25 such assets; its `PlatformImage` helper also names portrait/landscape placeholders that are absent from that catalog, so those names must not be assumed usable.

For supported Kingfisher views, edit the selected frame's props in the native inspector or with `canvas_batch`, preserving the other props:

```json
{
  "native": {
    "imageFixtures": {
      "*": "onboarding.encouragement.f"
    }
  }
}
```

This fragment belongs inside the existing `native` object; it is not a replacement for the complete props. An exact original URL can replace `*` to target one image. The wildcard applies to supported image calls in that frame only. Changes remount the frame; they do not need a native rebuild once the image adapter is compiled.

The source compiler adapts one-argument `KFImage(url)` and `KFImage.url(url)` calls inside an app SwiftUI struct's `body`. It supplies a Kingfisher data provider backed by `UIImage(named:)`. The app retains its own resizing, crop, processors, placeholders and transitions. Context comes from that frame's SwiftUI environment; no global URL replacement is installed. Missing fixture assets produce a `missing-asset` receipt and do not fall back to fetching the original URL. Receipts report asset names, not URL query strings.

This first adapter supports that Kingfisher syntax only. Explicit cache-key overloads, helper methods outside `body`, UIKit image loaders, AsyncImage, other third-party libraries and React Native images are unchanged. Arbitrary local files, a bundled stock-photo library and automatic image assignment are not implemented. The shared catalog/fixture convention allows further adapters without replacing the app's native layout.

## Native evidence

BetterMind's selected `MindIcon`, `InteractiveMindIcon`, `EmitParticlesView`, `PastSessionCard` and `RemoteImage` previews were built and captured in the real iOS-on-Mac host. The image view used a bundled asset with a `local-asset` receipt. A separate OpenDevs experiment was created directly from the current source with no overrides; workspace, settings, changes and code-diff previews rendered using the app's existing local demos. Evidence lives in `.context/verification/bettermind-components/` and `.context/verification/deus-media-regression/`.

Component examples are additional evidence and useful design surfaces. They do not fill missing authentication, therapy answers, purchase offerings or other backend records in unrelated screens.

### Frame dimensions and measured motion

Supported `UIScreen.main.bounds` reads in SwiftUI struct bodies and UIKit representable make/update methods now resolve through that frame's preview environment. This preserves the intended phone-sized coordinate space instead of using the host display width. Global initializers, arbitrary helper methods and other UIScreen APIs remain unchanged. A frame-size edit updates this context without rebuilding the app. The independent SceneLab native test displayed widths 402 and 320 in two live frames, with its real Metal shader still visible.

This corrected BetterMind's RemoteMessageDetailView: the prior oversized image expanded its content beyond the frame and hid most text. After the change, the header image, title and Markdown body are visible. The frame uses `AppIconEclipse.preview`, while the separate RemoteImage component uses `onboarding.encouragement.f`; both report their own local asset. The source text and layout remain app-authored.

Two MindIcon captures 2.36 seconds apart changed 228,088 pixels by more than three intensity levels, within the orb area. The static local-image control remained pixel-identical across 2.86 seconds. This is evidence of actual rendered motion, not just an animation call found in source. Evidence: `.context/verification/bettermind-media-proof/pixel-comparison.json`, `.context/verification/frame-bounds/`, and `.context/verification/bettermind-media-final/`.
