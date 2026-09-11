import UIKit

// MARK: - Look

func rgb(_ hex: UInt32) -> UIColor {
  UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

/// The canvas follows Expo's light interface: neutral surfaces, hairline borders, blue only for selection.
@MainActor
enum Palette {
  static let canvas = rgb(0xF2F3F5)
  static let surface = UIColor.white
  static let hairline = rgb(0xE4E5E9)
  static let border = rgb(0xD5D8DE)
  static let ink = rgb(0x1C2024)
  static let icon = rgb(0x3C4148)
  static let muted = rgb(0x6B7178)
  static let faint = rgb(0x9AA0A6)
  static let blue = rgb(0x0A7AF5)
  static let blueTint = rgb(0xE6F0FF)
  static let green = rgb(0x30A46C)
  static let amber = rgb(0xF0A020)
  static let red = rgb(0xE5484D)
}

@MainActor
enum Fonts {
  static func medium(_ size: CGFloat) -> UIFont { UIFont(name: "Inter-Medium", size: size) ?? .systemFont(ofSize: size, weight: .medium) }
  static func regular(_ size: CGFloat) -> UIFont { .systemFont(ofSize: size) }
  static func mono(_ size: CGFloat) -> UIFont { .monospacedSystemFont(ofSize: size, weight: .regular) }
}

@MainActor let hairlineWidth = 1 / UIScreen.main.scale
@MainActor func hairline() -> UIView {
  let line = UIView()
  line.backgroundColor = Palette.hairline
  return line
}
