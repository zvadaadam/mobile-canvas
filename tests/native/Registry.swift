import UIKit

/// The generated registry contract, without importing or executing an app.
@MainActor
enum CanvasSwiftRegistry {
  static let nativeVersion = "test"
  static let factories: [String: (CanvasPreviewContext) -> UIViewController] = [:]
  static func initializeApplication() {}
}
