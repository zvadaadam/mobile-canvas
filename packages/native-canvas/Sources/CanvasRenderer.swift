import UIKit

@MainActor
protocol CanvasApplicationDelegate: UIApplicationDelegate {
  var canvasRenderer: CanvasRendering { get }
}

struct CanvasFrameRequest {
  let id: String
  let runtime: URL
  let workspaceId: String
  let hostId: String
  let entry: [String: Any]
  let codeVersion: String
}

@MainActor
protocol CanvasRendering {
  var name: String { get }
  var maximumScreens: Int { get }
  func makeFrame(_ request: CanvasFrameRequest) -> CanvasRenderedFrame
}

extension CanvasRendering { var maximumScreens: Int { 32 } }

/// The shell retains the controller and renderer resources for the frame's lifetime.
/// Renderer implementations own state updates; the shell owns geometry and capture.
@MainActor
final class CanvasRenderedFrame {
  let controller: UIViewController
  let update: ([String: Any], String) -> Void
  private var cleanup: (() -> Void)?
  private var resources: [AnyObject]

  init(controller: UIViewController, resources: [AnyObject] = [],
       update: @escaping ([String: Any], String) -> Void = { _, _ in },
       dispose: @escaping () -> Void = {}) {
    self.controller = controller
    self.resources = resources
    self.update = update
    self.cleanup = dispose
  }

  func dispose() {
    cleanup?()
    cleanup = nil
    resources.removeAll()
  }
}
