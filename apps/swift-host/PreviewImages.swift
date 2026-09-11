import SwiftUI
import UIKit
#if canImport(Kingfisher)
import Kingfisher

/// The app retains its own image layout, processors and transitions. Only an
/// explicitly chosen frame fixture changes the image's source.
@MainActor enum CanvasPreviewImages {
  private static var data: [String: Data] = [:]
  static func kingfisher(_ url: URL?, context: CanvasPreviewContext?) -> KFImage {
    let native = context?.props["native"] as? [String: Any]
    let fixtures = native?["imageFixtures"] as? [String: String] ?? [:]
    guard let asset = fixtures[url?.absoluteString ?? ""] ?? fixtures["*"] else { return KFImage.url(url) }
    let bytes = data[asset] ?? UIImage(named: asset)?.pngData()
    if let bytes { data[asset] = bytes }
    let status = bytes == nil ? "missing-asset" : "local-asset"
    DispatchQueue.main.async {
      guard let context else { return }
      var report = context.state["imageFixtures"] as? [String: String] ?? [:]
      if report[asset] != status { report[asset] = status; context.state["imageFixtures"] = report }
    }
    // A missing fixture stays missing instead of silently fetching the URL.
    return KFImage.data(bytes, cacheKey: "canvas-local-asset:" + asset)
  }
}
#endif
