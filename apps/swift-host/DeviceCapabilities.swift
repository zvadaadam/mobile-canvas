import Foundation
import CoreMotion
import MessageUI
import ObjectiveC.runtime

/// Preview rendering must not activate the user's configured mail account.
/// Install before app initialization, including static capability caches.
@MainActor enum CanvasPreviewMail {
  private static let installed: Void = {
    guard let method = class_getClassMethod(MFMailComposeViewController.self, #selector(MFMailComposeViewController.canSendMail)) else { return }
    let unavailable: @convention(block) (AnyObject) -> Bool = { _ in false }
    method_setImplementation(method, imp_implementationWithBlock(unavailable))
  }()
  static func install() { _ = installed }
}

/// Designed-for-iPad's virtual motion device can abort while many preview
/// owners start/stop and release it. A Mac canvas has no handheld orientation:
/// report that capability as unavailable, retaining one inert native manager.
nonisolated enum CanvasPreviewDeviceMotion {
  nonisolated private final class Storage: @unchecked Sendable {
    let manager = UnavailableMotionManager()
  }
  private static let storage = Storage()
  static func makeManager() -> CMMotionManager {
    ProcessInfo.processInfo.isiOSAppOnMac ? storage.manager : CMMotionManager()
  }
}

nonisolated private final class UnavailableMotionManager: CMMotionManager {
  override var isDeviceMotionAvailable: Bool { false }
  override var isDeviceMotionActive: Bool { false }
  override var isAccelerometerAvailable: Bool { false }
  override var isAccelerometerActive: Bool { false }
  override var isGyroAvailable: Bool { false }
  override var isGyroActive: Bool { false }
  override var isMagnetometerAvailable: Bool { false }
  override var isMagnetometerActive: Bool { false }
  override func startDeviceMotionUpdates() {}
  override func startDeviceMotionUpdates(to queue: OperationQueue, withHandler handler: @escaping CMDeviceMotionHandler) {}
  override func startDeviceMotionUpdates(using referenceFrame: CMAttitudeReferenceFrame) {}
  override func startDeviceMotionUpdates(using referenceFrame: CMAttitudeReferenceFrame, to queue: OperationQueue, withHandler handler: @escaping CMDeviceMotionHandler) {}
  override func stopDeviceMotionUpdates() {}
  override func startAccelerometerUpdates() {}
  override func startAccelerometerUpdates(to queue: OperationQueue, withHandler handler: @escaping CMAccelerometerHandler) {}
  override func stopAccelerometerUpdates() {}
  override func startGyroUpdates() {}
  override func startGyroUpdates(to queue: OperationQueue, withHandler handler: @escaping CMGyroHandler) {}
  override func stopGyroUpdates() {}
  override func startMagnetometerUpdates() {}
  override func startMagnetometerUpdates(to queue: OperationQueue, withHandler handler: @escaping CMMagnetometerHandler) {}
  override func stopMagnetometerUpdates() {}
}
