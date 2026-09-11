import Foundation
import CoreGraphics

/// Geometry has no view or network dependencies, so panel/zoom regressions can
/// be checked without booting a renderer. All dimensions here are screen points.
nonisolated enum CanvasViewport {
  struct Position { let scale: CGFloat; let center: CGPoint }
  static func clamp(_ scale: CGFloat) -> CGFloat { min(1.5, max(0.1, scale.isFinite ? scale : 1)) }

  static func fit(board: CGSize, viewport: CGSize, horizontalMargins: CGFloat,
    verticalMargins: CGFloat, toolsClearance: CGFloat) -> Position? {
    guard board.width > 0, board.height > 0, viewport.width > 0, viewport.height > 0 else { return nil }
    let scale = clamp(min(1, min(max(1, viewport.width - horizontalMargins) / board.width,
      max(1, viewport.height - verticalMargins - toolsClearance) / board.height)))
    return Position(scale: scale, center: CGPoint(x: board.width / 2, y: board.height / 2 + toolsClearance / (2 * scale)))
  }

  static func focus(frame: CGRect, viewport: CGSize, scale: CGFloat? = nil, toolsClearance: CGFloat) -> Position? {
    guard frame.width > 0, frame.height > 0, viewport.width > 100, viewport.height > 0 else { return nil }
    let fit = min(1, min(max(1, viewport.width - 96) / frame.width,
      max(1, viewport.height - 112 - toolsClearance) / frame.height))
    let zoom = clamp(scale ?? fit)
    return Position(scale: zoom, center: CGPoint(x: frame.midX, y: frame.midY + (toolsClearance / 2 - 14) / zoom))
  }

  static func interpolate(from: Position, to: Position, progress: Double) -> Position {
    let t = CGFloat(1 - pow(1 - min(1, max(0, progress)), 3))
    return Position(scale: from.scale + (to.scale - from.scale) * t,
      center: CGPoint(x: from.center.x + (to.center.x - from.center.x) * t,
        y: from.center.y + (to.center.y - from.center.y) * t))
  }
}
