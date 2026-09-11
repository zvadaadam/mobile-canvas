#if CANVAS_MATCHED_HOST
internal import Expo
#else
import Expo
#endif
import React
import ReactAppDependencyProvider
import UIKit

@UIApplicationMain
class AppDelegate: ExpoAppDelegate, CanvasApplicationDelegate {
  var canvasRenderer: CanvasRendering { ExpoCanvasRenderer(factory: canvasFactory) }
  var canvasFactory: ExpoReactNativeFactory!
  var canvasDelegate: CanvasReactDelegate!
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
#if CANVAS_MATCHED_HOST
    // The launcher already preflights the complete bundle. Concurrent per-frame
    // runtimes don't need Metro's multipart progress stream; ordinary responses
    // avoid intermittent multipart-reader cancellations during a full-map launch.
    RCTSetCustomMultipartDataTaskRequestInterceptor { request in
      guard var request else { return nil }
      request.setValue("application/javascript", forHTTPHeaderField: "Accept")
      return request
    }
#endif
    canvasDelegate = CanvasReactDelegate()
    canvasDelegate.dependencyProvider = RCTAppDependencyProvider()
    canvasFactory = ExpoReactNativeFactory(delegate: canvasDelegate)
#if !CANVAS_MATCHED_HOST
    bindReactNativeFactory(canvasFactory)
#endif
    return super.application(application, didFinishLaunchingWithOptions: options)
  }
}

class CanvasReactDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? { bridge.bundleURL ?? bundleURL() }
  override func bundleURL() -> URL? {
    let port = Int(argument("--metro-port") ?? "") ?? 8108
    return URL(string: "http://127.0.0.1:\(port)/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false")
  }
}


@MainActor
final class ExpoCanvasRenderer: CanvasRendering {
  private let factory: ExpoReactNativeFactory
  var name: String { "Expo SDK \(Bundle.main.object(forInfoDictionaryKey: "CanvasExpoSDK") as? Int ?? 54)" }
  init(factory: ExpoReactNativeFactory) { self.factory = factory }

  func makeFrame(_ request: CanvasFrameRequest) -> CanvasRenderedFrame {
    var properties: [AnyHashable: Any] = ["screenId": request.id, "runtimeUrl": request.runtime.absoluteString,
      "workspaceId": request.workspaceId, "hostId": request.hostId]
    var resources: [AnyObject] = []
#if CANVAS_MATCHED_HOST
    properties["isolatedRuntime"] = true
    let delegate = CanvasReactDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let isolatedFactory = ExpoReactNativeFactory(delegate: delegate)
    resources = [delegate, isolatedFactory]
    let root = isolatedFactory.recreateRootView(withBundleURL: delegate.bundleURL(), moduleName: "ExpoCanvasScreen", initialProps: properties, launchOptions: nil)
#else
    let rootFactory = factory.rootViewFactory as! ExpoReactRootViewFactory
    let root = rootFactory.superView(withModuleName: "ExpoCanvasScreen", initialProperties: properties, launchOptions: nil)
#endif
    if let surface = root as? RCTSurfaceHostingProxyRootView {
      surface.disableActivityIndicatorAutoHide(false)
      surface.loadingView = UIView(frame: .zero)
    }
    let controller = UIViewController()
    controller.view = root
    return CanvasRenderedFrame(controller: controller, resources: resources)
  }
}
