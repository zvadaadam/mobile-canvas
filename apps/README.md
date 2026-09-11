# Renderer applications and templates

These directories supply content to the shared native shell in `packages/native-canvas`. They are not separate human products.

| Directory | Owns | How it runs |
| --- | --- | --- |
| `native-host` | Expo 54 dependencies, React screen surface, error boundary, Metro config, Expo native renderer/plugin | The authored build prepares the Xcode target; `index.tsx` registers the per-frame React component. There is intentionally no conventional single-screen `App.tsx`. |
| `linked-host` | Actual Expo Router root, per-frame routing/state, supported offline integrations | Runtime preparation combines these source templates with `native-host` and the app's SDK-matched dependencies in a separate experiment. It has no independent package manifest because the imported app determines those dependencies. |
| `swift-host` | SwiftUI/UIKit frame rendering, scene selection and supported native capabilities | The Swift build adapter combines these sources with the shared canvas and the app's generated Xcode inputs. It does not consume React or Metro. |

`native-host/registry.d.ts` and `linked-host/context.d.ts` declare modules supplied by runtime/Metro generation. They are contracts, not unfinished implementations. `linked-host/route-samples.ts` forwards the shared contract for checkout type checking; preparation copies the canonical source into the generated host.

Edit shared window/camera/inspector code in `packages/native-canvas/Sources`. Edit renderer-specific behavior here. Build output, installed dependencies, linked apps and generated registry files do not belong in the public source tree.
