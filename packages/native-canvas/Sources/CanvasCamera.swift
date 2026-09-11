import UIKit

/// One interruptible camera motion. The controller supplies view operations;
/// gesture interruption and Reduce Motion use the same destination geometry.
@MainActor
final class CanvasCamera {
  private var link: CADisplayLink?
  private var started: CFTimeInterval = 0
  private var origin = CanvasViewport.Position(scale: 1, center: .zero)
  private var target = CanvasViewport.Position(scale: 1, center: .zero)
  private var apply: ((CanvasViewport.Position) -> Void)?
  private var completion: (() -> Void)?
  var isMoving: Bool { link != nil }

  func stop() {
    link?.invalidate()
    link = nil
    apply = nil
    completion = nil
  }

  func move(from: CanvasViewport.Position, to: CanvasViewport.Position, animated: Bool,
    apply: @escaping (CanvasViewport.Position) -> Void, completion: @escaping () -> Void) {
    stop()
    guard animated && !UIAccessibility.isReduceMotionEnabled else { apply(to); completion(); return }
    origin = from
    target = to
    self.apply = apply
    self.completion = completion
    started = CACurrentMediaTime()
    let link = CADisplayLink(target: self, selector: #selector(step(_:)))
    self.link = link
    link.add(to: .main, forMode: .common)
  }

  @objc private func step(_ link: CADisplayLink) {
    let progress = (link.timestamp - started) / 0.22
    apply?(CanvasViewport.interpolate(from: origin, to: target, progress: progress))
    if progress >= 1 {
      let finish = completion
      stop()
      finish?()
    }
  }
}
