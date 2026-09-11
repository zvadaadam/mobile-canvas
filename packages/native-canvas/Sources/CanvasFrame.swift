import UIKit

// MARK: - Frames

final class FrameWindow: UIWindow {
  var viewport = CGRect.zero
  let viewportMask = CAShapeLayer()
  weak var focusCover: UIView?
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard !isHidden, isUserInteractionEnabled, viewport.contains(point) else { return nil }
    // React may insert native content after mounting. Selection owns the first
    // pointer hit regardless of that content's subview order.
    if let focusCover, !focusCover.isHidden { return focusCover }
    return super.hitTest(point, with: event)
  }
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    viewport.contains(point) && super.point(inside: point, with: event)
  }
}

/// The name above a frame. It selects on click, drags the frame, and stays readable at any zoom.
final class FrameTitle: UIControl {
  let name = UILabel()
  let detail = UILabel()
  override init(frame: CGRect) {
    super.init(frame: frame)
    name.textColor = Palette.muted
    name.lineBreakMode = .byTruncatingTail
    detail.textColor = Palette.faint
    detail.textAlignment = .right
    detail.isHidden = true
    addSubview(name)
    addSubview(detail)
    isAccessibilityElement = true
    accessibilityTraits = .button
    setZoom(1)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  override func layoutSubviews() {
    // The dimensions yield to the name when the frame is too narrow on screen for both.
    let wanted = detail.isHidden ? 0 : ceil(detail.intrinsicContentSize.width)
    let detailWidth = wanted > 0 && wanted < bounds.width * 0.45 ? wanted : 0
    detail.frame = CGRect(x: bounds.width - detailWidth, y: 0, width: detailWidth, height: bounds.height)
    name.frame = CGRect(x: 0, y: 0, width: max(0, bounds.width - detailWidth - (detailWidth > 0 ? 8 : 0)), height: bounds.height)
  }
  /// Fonts scale inversely with the board so the label keeps one size on screen.
  func setZoom(_ zoom: CGFloat) {
    name.font = Fonts.medium(12 / zoom)
    detail.font = .monospacedDigitSystemFont(ofSize: 11 / zoom, weight: .regular)
    setNeedsLayout()
  }
  func select(_ selected: Bool) {
    name.textColor = selected ? Palette.blue : Palette.muted
    detail.isHidden = !selected
    setNeedsLayout()
  }
}

final class CanvasFrame: UIViewController {
  private(set) var rendered: CanvasRenderedFrame?
  let id: String
  let label = FrameTitle()
  // A frame exists for every authored screen; its React root mounts once it scrolls into view and then stays.
  private(set) var root: UIView?
  private let placeholder = UILabel()
  private let focusCover = UIControl()
  var isMounted: Bool { root != nil }
  var contentWindow: FrameWindow?
  var onSelect: (() -> Void)?
  var onMove: ((UIPanGestureRecognizer) -> Void)?
  private(set) var selected = false
  private var zoom: CGFloat = 1
  // Authored device safe areas: real scroll views and safe-area hooks inset exactly as on a phone.
  var safeAreaInsets = UIEdgeInsets.zero {
    didSet { contentWindow?.rootViewController?.additionalSafeAreaInsets = safeAreaInsets }
  }
  init(id: String) {
    self.id = id
    super.init(nibName: nil, bundle: nil)
    definesPresentationContext = true
    label.accessibilityIdentifier = "canvas.frame-title." + id
    label.addAction(UIAction { [weak self] _ in self?.onSelect?() }, for: .touchUpInside)
    label.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragTitle(_:))))
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  func mount(rendered: CanvasRenderedFrame, in scene: UIWindowScene) {
    guard self.root == nil else { return }
    self.rendered = rendered
    let root = rendered.controller.view!
    root.accessibilityIdentifier = "canvas.frame." + id
    self.root = root
    placeholder.isHidden = true
    view.setNeedsLayout()
    attachContent(to: scene)
  }
  func unmount() {
    rendered?.dispose()
    rendered = nil
    contentWindow?.isHidden = true
    contentWindow?.rootViewController = nil
    contentWindow = nil
    root = nil
    label.removeFromSuperview()
    willMove(toParent: nil)
    view.removeFromSuperview()
    removeFromParent()
  }
  override func viewDidLoad() {
    view.backgroundColor = Palette.surface
    view.layer.borderColor = Palette.border.cgColor
    view.layer.borderWidth = 1
    view.layer.shadowColor = UIColor.black.cgColor
    view.layer.shadowOpacity = 0.10
    view.layer.shadowRadius = 16
    view.layer.shadowOffset = CGSize(width: 0, height: 6)
    placeholder.text = "Loads when it scrolls into view"
    placeholder.textAlignment = .center
    placeholder.numberOfLines = 0
    placeholder.font = Fonts.medium(13)
    placeholder.textColor = Palette.faint
    placeholder.backgroundColor = rgb(0xFAFAFB)
    placeholder.isAccessibilityElement = false
    view.addSubview(placeholder)
    focusCover.backgroundColor = .clear
    focusCover.isAccessibilityElement = true
    focusCover.accessibilityTraits = .button
    focusCover.accessibilityLabel = "Focus screen"
    focusCover.addAction(UIAction { [weak self] _ in self?.onSelect?() }, for: .touchUpInside)
  }
  override func viewDidLayoutSubviews() {
    root?.frame = view.bounds
    placeholder.frame = view.bounds
    view.layer.shadowPath = UIBezierPath(rect: view.bounds).cgPath
  }
  func select(_ selected: Bool) {
    guard self.selected != selected else { return }
    self.selected = selected
    focusCover.isHidden = false
    label.select(selected)
    applyStroke()
  }
  func setInteractionEnabled(_ enabled: Bool) { focusCover.isHidden = selected && enabled }
  /// Borders stay one screen pixel wide and the name one readable size at any zoom.
  func setZoom(_ zoom: CGFloat) {
    self.zoom = zoom
    label.setZoom(zoom)
    applyStroke()
  }
  private func applyStroke() {
    let width = (selected ? 2 : 1) / zoom
    let color = (selected ? Palette.blue : Palette.border).cgColor
    view.layer.borderWidth = width
    view.layer.borderColor = color
    contentWindow?.layer.borderWidth = width
    contentWindow?.layer.borderColor = color
  }
  @objc private func dragTitle(_ gesture: UIPanGestureRecognizer) { onMove?(gesture) }
  func attachContent(to scene: UIWindowScene) {
    guard let root, contentWindow == nil else { return }
    let window = FrameWindow(windowScene: scene)
    window.windowLevel = .normal + 1
    window.overrideUserInterfaceStyle = .light
    window.clipsToBounds = true
    guard let controller = rendered?.controller else { return }
    controller.view.clipsToBounds = true
    if #available(iOS 17.0, *) {
      controller.traitOverrides.horizontalSizeClass = .compact
      controller.traitOverrides.activeAppearance = .active
    }
    controller.additionalSafeAreaInsets = safeAreaInsets
    window.rootViewController = controller
    focusCover.frame = controller.view.bounds
    focusCover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.addSubview(focusCover)
    window.focusCover = focusCover
    window.layer.mask = window.viewportMask
    contentWindow = window
    window.isHidden = false
    applyStroke()
  }
}

// Floating tools stay above independent native frame windows without taking keyboard focus.
final class CanvasToolsWindow: UIWindow {
  override var canBecomeKey: Bool { false }
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === rootViewController?.view ? nil : hit
  }
}
