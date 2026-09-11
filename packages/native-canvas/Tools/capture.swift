import AppKit
import ScreenCaptureKit

// Capture only the owned canvas window, including native child presentations.
@main
struct CanvasCapture {
  @MainActor static func main() async {
    _ = NSApplication.shared
    do {
      guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]), pid > 0 else {
        throw NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected owned host PID and output path."])
      }
      let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
      guard let window = content.windows.filter({ $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 100 && $0.frame.height > 100 }).max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
        throw NSError(domain: "ExpoCanvas", code: 2, userInfo: [NSLocalizedDescriptionKey: "No native canvas window. Open the canvas and try again."])
      }
      let configuration = SCStreamConfiguration()
      configuration.width = Int(window.frame.width * 2)
      configuration.height = Int(window.frame.height * 2)
      configuration.showsCursor = false
      configuration.ignoreShadowsSingleWindow = true
      // SwiftUI sheets use child compositor windows on iOS-on-Mac. Include them
      // in both paths, including when macOS reports the window as off screen.
      configuration.includeChildWindows = true
      let filter: SCContentFilter
      if window.isOnScreen, let display = content.displays.max(by: { $0.frame.intersection(window.frame).width * $0.frame.intersection(window.frame).height < $1.frame.intersection(window.frame).width * $1.frame.intersection(window.frame).height }) {
        configuration.sourceRect = CGRect(x: window.frame.minX - display.frame.minX, y: window.frame.minY - display.frame.minY, width: window.frame.width, height: window.frame.height)
        filter = SCContentFilter(display: display, including: content.windows.filter { $0.owningApplication?.processID == pid })
      } else {
        configuration.sourceRect = CGRect(origin: .zero, size: window.frame.size)
        filter = SCContentFilter(desktopIndependentWindow: window)
      }
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
      guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw NSError(domain: "ExpoCanvas", code: 3) }
      try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
      print("Captured native canvas")
    } catch {
      FileHandle.standardError.write(Data("Native capture failed: \(error.localizedDescription)\n".utf8))
      exit(1)
    }
  }
}
