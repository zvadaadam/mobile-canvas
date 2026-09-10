#if CANVAS_MATCHED_HOST
internal import Expo
#else
import Expo
#endif
import React
import ReactAppDependencyProvider
import UIKit
import CoreText


private func argument(_ name: String) -> String? {
  let args = ProcessInfo.processInfo.arguments
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}

@UIApplicationMain
class AppDelegate: ExpoAppDelegate {
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

class CanvasSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene, let app = UIApplication.shared.delegate as? AppDelegate else { return }
    window = UIWindow(windowScene: scene)
    window?.overrideUserInterfaceStyle = .light
    window?.rootViewController = CanvasController(factory: app.canvasFactory)
    window?.makeKeyAndVisible()
  }
}

// MARK: - Look

func rgb(_ hex: UInt32) -> UIColor {
  UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

/// The canvas follows Expo's light interface: neutral surfaces, hairline borders, blue only for selection.
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

enum Fonts {
  static func medium(_ size: CGFloat) -> UIFont { UIFont(name: "Inter-Medium", size: size) ?? .systemFont(ofSize: size, weight: .medium) }
  static func regular(_ size: CGFloat) -> UIFont { .systemFont(ofSize: size) }
  static func mono(_ size: CGFloat) -> UIFont { .monospacedSystemFont(ofSize: size, weight: .regular) }
}

let hairlineWidth = 1 / UIScreen.main.scale
func hairline() -> UIView {
  let line = UIView()
  line.backgroundColor = Palette.hairline
  return line
}

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
  // Linked apps own router/theme module singletons, so each gets its own JS runtime.
  var reactFactory: ExpoReactNativeFactory?
  var reactDelegate: CanvasReactDelegate?
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
  func mount(root: UIView, in scene: UIWindowScene) {
    guard self.root == nil else { return }
    root.accessibilityIdentifier = "canvas.frame." + id
    self.root = root
    placeholder.isHidden = true
    view.setNeedsLayout()
    attachContent(to: scene)
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
    let controller = UIViewController()
    controller.view = root
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

// MARK: - Canvas

let maxScreens = 32
private let toolbarHeight: CGFloat = 52
private let statusHeight: CGFloat = 30
private let inspectorWidth: CGFloat = 320
/// Room around the board in screen points; the top keeps the counter-scaled frame names visible.
private let boardMargins = UIEdgeInsets(top: 48, left: 32, bottom: 32, right: 32)

final class CanvasController: UIViewController, UIScrollViewDelegate {
  private let factory: ExpoReactNativeFactory
  private let scroll = UIScrollView()
  private let board = UIView()
  private let toolbar = UIView()
  private let toolbarLine = hairline()
  private let titleLabel = UILabel()
  private let statusBar = UIView()
  private let statusLine = hairline()
  private let statusDot = UIView()
  private let statusLabel = UILabel()
  private let contextLabel = UILabel()
  private let emptyLabel = UILabel()
  private let zoomButton = UIButton(type: .system)
  private let inspector = CanvasInspector()
  private var inspectorVisible = true
  private var latestSession: [String: Any] = [:]
  private var orderedIds: [String] = []
  private var mutationInFlight = false
  private var selectionGeneration = 0
  private var selectionPending = false
  private weak var undoButton: UIButton?
  private weak var redoButton: UIButton?
  private weak var addButton: UIButton?
  private weak var screensButton: UIButton?
  private weak var panButton: UIButton?
  private weak var flowButton: UIButton?
  private weak var inspectorButton: UIButton?
  // Flow connectors drawn from each screen's authored links; a navigation pulses the edge it takes.
  private let flowLayer = CAShapeLayer()
  private let flowArrowLayer = CAShapeLayer()
  private let flowSelectedLayer = CAShapeLayer()
  private let flowSelectedArrowLayer = CAShapeLayer()
  private let flowPulseLayer = CAShapeLayer()
  private let flowBackLayer = CAShapeLayer()
  private let flowBackArrowLayer = CAShapeLayer()
  private var flowVisible = true
  private var frames: [String: CanvasFrame] = [:]
  private var entries: [String: [String: Any]] = [:]
  private var workspaceId = ""
  private var sequence = 0
  private var documentName = "Expo Canvas"
  private var selectedId: String?
  private var fetching = false
  private var fitted = false
  private var dragging = false
  private var panning = false
  private var reconciledSequence = -1
  private var motion: CADisplayLink?
  private var motionStart: CFTimeInterval = 0
  private var motionFromScale: CGFloat = 1
  private var motionToScale: CGFloat = 1
  private var motionFromCenter = CGPoint.zero
  private var motionToCenter = CGPoint.zero
  private var inspectionScreen: String?
  private var inspectionExpiry: TimeInterval = 0
  private let inspectionRing = CAShapeLayer()
  private let inspectionLabel = UILabel()
  private var dragOrigin = CGPoint.zero
  private var dragSequence = 0
  private var worldOffset = CGPoint.zero
  private var boardSize = CGSize(width: 1200, height: 1000)
  /// A frame to center once the window has a real size; a reveal before the first layout would use empty bounds.
  private var pendingReveal: (id: String, scale: CGFloat?)?
  /// The last reveal's computation, reported to the runtime so an agent can see why the canvas looks where it does.
  private var note = ""
  private var poll: Timer?
  private var previewActivity: NSObjectProtocol?
  private var acknowledged = 0
  private let hostId = argument("--host-id") ?? UUID().uuidString
  private let runtime: URL?
  private enum Tone { case idle, busy, ready, error }

  init(factory: ExpoReactNativeFactory) {
    self.factory = factory
    let candidate = URL(string: argument("--canvas-runtime") ?? "")
    runtime = candidate?.scheme == "http" && candidate?.host == "127.0.0.1" && candidate?.port != nil ? candidate : nil
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  deinit {
    poll?.invalidate()
    motion?.invalidate()
    if let previewActivity { ProcessInfo.processInfo.endActivity(previewActivity) }
  }

  override func viewDidLoad() {
    view.backgroundColor = Palette.canvas
    if let data = NSDataAsset(name: "InterMedium")?.data, let provider = CGDataProvider(data: data as CFData), let font = CGFont(provider) {
      CTFontManagerRegisterGraphicsFont(font, nil)
    }
    buildToolbar()
    scroll.delegate = self
    scroll.backgroundColor = Palette.canvas
    scroll.minimumZoomScale = 0.1
    scroll.maximumZoomScale = 1.5
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.contentInset = boardMargins
    scroll.delaysContentTouches = false
    scroll.canCancelContentTouches = false
    scroll.panGestureRecognizer.minimumNumberOfTouches = 1
    scroll.panGestureRecognizer.allowedScrollTypesMask = .all
    scroll.bounces = false
    scroll.bouncesZoom = false
    scroll.addSubview(board)
    view.addSubview(scroll)
    inspectionRing.fillColor = UIColor.clear.cgColor
    inspectionRing.strokeColor = Palette.blue.cgColor
    inspectionRing.lineWidth = 3
    inspectionRing.lineDashPattern = [6, 4]
    scroll.layer.addSublayer(inspectionRing)
    inspectionLabel.font = Fonts.medium(11)
    inspectionLabel.textColor = Palette.blue
    inspectionLabel.backgroundColor = Palette.blueTint
    inspectionLabel.textAlignment = .center
    inspectionLabel.layer.cornerRadius = 9
    inspectionLabel.clipsToBounds = true
    inspectionLabel.isHidden = true
    inspectionLabel.accessibilityIdentifier = "canvas.agent-inspection"
    view.addSubview(inspectionLabel)
    for (layer, stroke, fill, width) in [
      (flowLayer, Palette.faint, nil, 1.5), (flowArrowLayer, nil, Palette.faint, 0),
      (flowSelectedLayer, Palette.blue, nil, 2), (flowSelectedArrowLayer, nil, Palette.blue, 0), (flowPulseLayer, Palette.green, nil, 3),
      (flowBackLayer, Palette.faint.withAlphaComponent(0.6), nil, 1), (flowBackArrowLayer, nil, Palette.faint.withAlphaComponent(0.7), 0),
    ] as [(CAShapeLayer, UIColor?, UIColor?, CGFloat)] {
      layer.strokeColor = stroke?.cgColor
      layer.fillColor = fill?.cgColor
      layer.lineWidth = width
      layer.lineCap = .round
      layer.lineJoin = .round
      board.layer.addSublayer(layer)
    }
    flowBackLayer.lineDashPattern = [6, 6]
    emptyLabel.text = "No screens yet. Add one, or let your agent create them."
    emptyLabel.textAlignment = .center
    emptyLabel.numberOfLines = 0
    emptyLabel.font = Fonts.regular(13)
    emptyLabel.textColor = Palette.muted
    emptyLabel.isHidden = true
    view.addSubview(emptyLabel)
    statusBar.backgroundColor = Palette.surface
    statusBar.addSubview(statusLine)
    statusDot.layer.cornerRadius = 4
    statusDot.backgroundColor = Palette.faint
    statusBar.addSubview(statusDot)
    statusLabel.font = Fonts.regular(12)
    statusLabel.textColor = Palette.muted
    statusBar.addSubview(statusLabel)
    contextLabel.font = Fonts.regular(12)
    contextLabel.textColor = Palette.faint
    contextLabel.textAlignment = .right
    contextLabel.lineBreakMode = .byTruncatingTail
    statusBar.addSubview(contextLabel)
    view.addSubview(statusBar)
    setStatus(runtime == nil ? "Open a project with expo-canvas open --project <directory>." : "Connecting to your project…", runtime == nil ? .idle : .busy)
    inspector.isHidden = !inspectorVisible
    view.addSubview(inspector)
    inspector.onApply = { [weak self] identity, id, patch, completion in
      self?.transact([["type": "screen.update", "id": id, "patch": patch]], label: "Edit screen", identity: identity, completion: completion)
    }
    inspector.onReset = { [weak self] id in self?.resetScreen(id) }
    inspector.onDuplicate = { [weak self] id in self?.addScreen(copying: id) }
    inspector.onSource = { [weak self] source, screenId in
      guard let self else { return }
      let encoded = source.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? source
      let props = screenId.flatMap { self.entries[$0]?["props"] as? [String: Any] }
      let endpoint = props?["route"] != nil && screenId != nil ? "route-source?screenId=\(screenId!)" : "source?path=\(encoded)"
      self.request(endpoint) { [weak self] result in
        switch result {
        case .success(let result): self?.inspector.showSource(path: result["appPath"] as? String ?? source, code: result["code"] as? String ?? "", original: result["overridden"] as? Bool == false)
        case .failure(let error): self?.inspector.showError(error.localizedDescription)
        }
      }
    }
    for (input, flags, action, title) in [
      ("=", UIKeyModifierFlags.command, #selector(zoomInCommand), "Zoom In"), ("+", .command, #selector(zoomInCommand), "Zoom In"),
      ("-", .command, #selector(zoomOutCommand), "Zoom Out"), ("0", .command, #selector(zoomResetCommand), "Actual Size"),
      ("1", [.command, .shift], #selector(fitCommand), "Fit All Screens"), ("2", [.command, .shift], #selector(focusCommand), "Fit Selected Screen"), ("i", [.command, .shift], #selector(inspectorCommand), "Toggle Inspector"),
    ] as [(String, UIKeyModifierFlags, Selector, String)] {
      addKeyCommand(UIKeyCommand(title: title, action: action, input: input, modifierFlags: flags))
    }
    if runtime != nil && ProcessInfo.processInfo.isiOSAppOnMac {
      previewActivity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Running the explicitly opened Expo design canvas")
    }
    refresh()
    poll = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.refresh() }
    RunLoop.main.add(poll!, forMode: .common)
  }

  // MARK: Toolbar

  private func buildToolbar() {
    toolbar.backgroundColor = Palette.surface
    toolbar.addSubview(toolbarLine)
    let logo = UIImageView(image: UIImage(named: "ExpoWordmark"))
    logo.contentMode = .scaleAspectFit
    logo.widthAnchor.constraint(equalToConstant: 74).isActive = true
    logo.heightAnchor.constraint(equalToConstant: 21).isActive = true
    logo.isAccessibilityElement = true
    logo.accessibilityLabel = "Expo"
    let divider = UIView()
    divider.backgroundColor = Palette.hairline
    divider.widthAnchor.constraint(equalToConstant: 1).isActive = true
    divider.heightAnchor.constraint(equalToConstant: 18).isActive = true
    titleLabel.text = "Canvas"
    titleLabel.textColor = Palette.ink
    titleLabel.font = Fonts.medium(14)
    titleLabel.lineBreakMode = .byTruncatingTail
    let leading = UIStackView(arrangedSubviews: [logo, divider, titleLabel])
    leading.axis = .horizontal
    leading.spacing = 14
    leading.alignment = .center
    let add = pill("New screen", symbol: "plus", primary: true, identifier: "canvas.add-screen") { [weak self] in self?.addScreen() }
    addButton = add
    let undo = icon("arrow.uturn.backward", label: "Undo", identifier: "canvas.undo") { [weak self] in self?.history("undo") }
    undoButton = undo
    let redo = icon("arrow.uturn.forward", label: "Redo", identifier: "canvas.redo") { [weak self] in self?.history("redo") }
    redoButton = redo
    let screens = pill("Screens", symbol: "chevron.down", identifier: "canvas.screens") {}
    screens.configuration?.imagePlacement = .trailing
    screens.showsMenuAsPrimaryAction = true
    screensButton = screens
    let pan = icon("hand.draw", label: "Pan the canvas", identifier: "canvas.pan") { [weak self] in self?.togglePan() }
    panButton = pan
    let flow = icon("arrow.triangle.branch", label: "Show the app flow", identifier: "canvas.flow") { [weak self] in self?.toggleFlow() }
    flowButton = flow
    setToggle(flow, on: true)
    let arrange = icon("rectangle.3.group", label: "Arrange by flow", identifier: "canvas.arrange") { [weak self] in self?.arrangeByFlow() }
    let fit = icon("arrow.up.left.and.arrow.down.right", label: "Fit all screens", key: "⇧⌘1", identifier: "canvas.fit") { [weak self] in self?.fit() }
    let zoomOut = icon("minus", label: "Zoom out", key: "⌘−", identifier: "canvas.zoom-out") { [weak self] in self?.zoom(by: 0.8) }
    var zoomConfig = UIButton.Configuration.plain()
    zoomConfig.title = "100%"
    zoomConfig.baseForegroundColor = Palette.icon
    zoomConfig.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 4, bottom: 6, trailing: 4)
    zoomConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
      return attributes
    }
    zoomButton.configuration = zoomConfig
    zoomButton.accessibilityLabel = "Zoom to 100%"
    zoomButton.accessibilityIdentifier = "canvas.zoom-reset"
    zoomButton.toolTip = "Zoom to 100%  ⌘0"
    zoomButton.widthAnchor.constraint(equalToConstant: 48).isActive = true
    zoomButton.addAction(UIAction { [weak self] _ in self?.moveViewport(scale: 1, center: self?.viewportCenter ?? .zero, animated: false) }, for: .touchUpInside)
    let zoomIn = icon("plus", label: "Zoom in", key: "⌘+", identifier: "canvas.zoom-in") { [weak self] in self?.zoom(by: 1.25) }
    let inspectorToggle = icon("sidebar.right", label: "Inspector", key: "⇧⌘I", identifier: "canvas.inspector") { [weak self] in self?.toggleInspector() }
    inspectorButton = inspectorToggle
    setToggle(inspectorToggle, on: inspectorVisible)
    let agent = pill("Agent", symbol: "terminal", identifier: "canvas.agent-tools") { [weak self] in self?.showAgentTools() }
    let trailing = UIStackView(arrangedSubviews: [
      add, group([undo, redo]), screens, group([pan, flow, arrange, fit]), group([zoomOut, zoomButton, zoomIn]), group([inspectorToggle]), agent,
    ])
    trailing.axis = .horizontal
    trailing.spacing = 10
    trailing.alignment = .center
    for stack in [leading, trailing] {
      stack.translatesAutoresizingMaskIntoConstraints = false
      toolbar.addSubview(stack)
    }
    NSLayoutConstraint.activate([
      leading.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 20),
      leading.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
      trailing.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -16),
      trailing.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
      leading.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -16),
    ])
    view.addSubview(toolbar)
  }
  /// A compact symbol button with a tooltip; toggles show their state in blue.
  private func icon(_ symbol: String, label: String, key: String? = nil, identifier: String, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system)
    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .medium))
    config.baseForegroundColor = Palette.icon
    config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 7, bottom: 6, trailing: 7)
    config.cornerStyle = .medium
    button.configuration = config
    button.accessibilityLabel = label
    button.accessibilityIdentifier = identifier
    button.toolTip = key.map { "\(label)  \($0)" } ?? label
    button.widthAnchor.constraint(equalToConstant: 30).isActive = true
    button.heightAnchor.constraint(equalToConstant: 28).isActive = true
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }
  private func pill(_ title: String, symbol: String? = nil, primary: Bool = false, identifier: String, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system)
    var config = primary ? UIButton.Configuration.filled() : .gray()
    config.title = title
    config.image = symbol.flatMap { UIImage(systemName: $0, withConfiguration: UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold)) }
    config.imagePadding = 6
    config.cornerStyle = .capsule
    config.baseBackgroundColor = primary ? Palette.ink : Palette.canvas
    config.baseForegroundColor = primary ? .white : Palette.ink
    config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = Fonts.medium(13)
      return attributes
    }
    button.configuration = config
    button.accessibilityIdentifier = identifier
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }
  private func group(_ buttons: [UIView]) -> UIView {
    let stack = UIStackView(arrangedSubviews: buttons)
    stack.axis = .horizontal
    stack.spacing = 2
    stack.alignment = .center
    stack.isLayoutMarginsRelativeArrangement = true
    stack.layoutMargins = UIEdgeInsets(top: 2, left: 2, bottom: 2, right: 2)
    stack.backgroundColor = Palette.canvas
    stack.layer.cornerRadius = 8
    return stack
  }
  private func setToggle(_ button: UIButton?, on: Bool) {
    button?.configuration?.baseForegroundColor = on ? Palette.blue : Palette.icon
    button?.configuration?.background.backgroundColor = on ? Palette.blueTint : .clear
    button?.accessibilityValue = on ? "On" : "Off"
  }
  private func setStatus(_ text: String, _ tone: Tone) {
    statusLabel.text = text
    switch tone {
    case .idle: statusDot.backgroundColor = Palette.faint
    case .busy: statusDot.backgroundColor = Palette.amber
    case .ready: statusDot.backgroundColor = Palette.green
    case .error: statusDot.backgroundColor = Palette.red
    }
  }
  @objc private func zoomInCommand() { zoom(by: 1.25) }
  @objc private func zoomOutCommand() { zoom(by: 0.8) }
  @objc private func zoomResetCommand() { moveViewport(scale: 1, center: viewportCenter, animated: false) }
  @objc private func fitCommand() { fit() }
  @objc private func focusCommand() { if let selectedId { reveal(selectedId, animated: false) } }
  @objc private func inspectorCommand() { toggleInspector() }

  // MARK: Layout

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let top = view.safeAreaInsets.top
    let panel: CGFloat = inspectorVisible ? min(inspectorWidth, view.bounds.width * 0.4) : 0
    let canvasWidth = view.bounds.width - panel
    toolbar.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: toolbarHeight)
    toolbarLine.frame = CGRect(x: 0, y: toolbarHeight - hairlineWidth, width: view.bounds.width, height: hairlineWidth)
    scroll.frame = CGRect(x: 0, y: top + toolbarHeight, width: canvasWidth, height: max(1, view.bounds.height - top - toolbarHeight - statusHeight))
    statusBar.frame = CGRect(x: 0, y: view.bounds.height - statusHeight, width: canvasWidth, height: statusHeight)
    statusLine.frame = CGRect(x: 0, y: 0, width: canvasWidth, height: hairlineWidth)
    statusDot.frame = CGRect(x: 16, y: (statusHeight - 8) / 2, width: 8, height: 8)
    statusLabel.frame = CGRect(x: 30, y: 0, width: max(0, canvasWidth * 0.5 - 30), height: statusHeight)
    contextLabel.frame = CGRect(x: canvasWidth * 0.5, y: 0, width: max(0, canvasWidth * 0.5 - 16), height: statusHeight)
    inspector.frame = CGRect(x: view.bounds.width - panel, y: top + toolbarHeight, width: panel, height: view.bounds.height - top - toolbarHeight)
    emptyLabel.frame = scroll.frame.insetBy(dx: 40, dy: 0)
    centerBoard()
    if !fitted && !frames.isEmpty && scroll.bounds.width > 100 {
      fitted = true
      fit()
    }
    if let pending = pendingReveal, scroll.bounds.width > 100, frames[pending.id] != nil {
      pendingReveal = nil
      reveal(pending.id, scale: pending.scale, animated: false)
    }
    positionContentWindows()
  }
  func viewForZooming(in scrollView: UIScrollView) -> UIView? { board }
  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    zoomButton.configuration?.title = "\(Int((scroll.zoomScale * 100).rounded()))%"
    for frame in frames.values {
      frame.setZoom(scroll.zoomScale)
      layoutTitle(frame)
    }
    centerBoard()
    positionContentWindows()
    drawFlow()
  }
  func scrollViewDidScroll(_ scrollView: UIScrollView) { positionContentWindows() }
  /// A board smaller than the viewport sits centered; a larger one keeps the base margins.
  private func centerBoard() {
    let extraX = max(0, (scroll.bounds.width - scroll.contentSize.width) / 2)
    let extraY = max(0, (scroll.bounds.height - scroll.contentSize.height) / 2)
    // Half-viewport padding lets edge frames center just like interior frames.
    let paddingX = max(boardMargins.left, scroll.bounds.width / 2 - 40)
    let paddingY = max(boardMargins.top, scroll.bounds.height / 2 - 40)
    let insets = UIEdgeInsets(top: max(paddingY, extraY), left: max(paddingX, extraX), bottom: max(paddingY, extraY), right: max(paddingX, extraX))
    if scroll.contentInset != insets { scroll.contentInset = insets }
  }
  /// The name sits just above its frame, sized in board points so it reads the same at every zoom.
  private func layoutTitle(_ frame: CanvasFrame) {
    let zoom = scroll.zoomScale
    let body = frame.view.frame
    let height = 22 / zoom
    frame.label.frame = CGRect(x: body.minX, y: body.minY - height - 6 / zoom, width: body.width, height: height)
  }
  /// Mounts React roots for frames near the viewport. Mounting is sticky, so scrolling away keeps state.
  private func mountVisibleFrames() {
    guard let canvasWindow = view.window, let scene = canvasWindow.windowScene, let runtime else { return }
    let viewport = scroll.convert(scroll.bounds, to: canvasWindow).insetBy(dx: -160, dy: -160)
    var mounted = false
    for id in orderedIds {
      guard let frame = frames[id], !frame.isMounted else { continue }
      let rect = frame.view.convert(frame.view.bounds, to: canvasWindow)
      guard rect.intersects(viewport) || id == selectedId else { continue }
      // Expo's normal delegate path recreates the app root and asserts on the second call.
      // Its exported superView path reaches RN's multi-surface factory on the shared host.
      var properties: [AnyHashable: Any] = [
        "screenId": id, "runtimeUrl": runtime.absoluteString, "workspaceId": workspaceId, "hostId": hostId,
      ]
#if CANVAS_MATCHED_HOST
      properties["isolatedRuntime"] = true
      let delegate = CanvasReactDelegate()
      delegate.dependencyProvider = RCTAppDependencyProvider()
      let isolatedFactory = ExpoReactNativeFactory(delegate: delegate)
      frame.reactDelegate = delegate
      frame.reactFactory = isolatedFactory
      let root = isolatedFactory.recreateRootView(withBundleURL: delegate.bundleURL(), moduleName: "ExpoCanvasScreen", initialProps: properties, launchOptions: nil)
#else
      let rootFactory = factory.rootViewFactory as! ExpoReactRootViewFactory
      let root = rootFactory.superView(withModuleName: "ExpoCanvasScreen", initialProperties: properties, launchOptions: nil)
#endif
      // expo-splash-screen customizes every root but owns only one loading view.
      // In this multi-surface host it leaves older frames under permanent white
      // splash overlays. Frame placeholders/readiness belong to the canvas.
      if let surface = root as? RCTSurfaceHostingProxyRootView {
        surface.disableActivityIndicatorAutoHide(false)
        surface.loadingView = UIView(frame: .zero)
      }
      frame.mount(root: root, in: scene)
      mounted = true
    }
    if mounted { reportHost() }
  }
  private func positionContentWindows() {
    guard let canvasWindow = view.window else { return }
    if motion == nil && !scroll.isDragging && !scroll.isDecelerating && !scroll.isZooming { mountVisibleFrames() }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    let viewport = scroll.convert(scroll.bounds, to: canvasWindow)
    for frame in frames.values {
      guard let window = frame.contentWindow else { continue }
      let rect = frame.view.convert(frame.view.bounds, to: canvasWindow)
      let bounds = CGRect(origin: .zero, size: frame.view.bounds.size)
      let center = CGPoint(x: rect.midX, y: rect.midY)
      let transform = CGAffineTransform(scaleX: scroll.zoomScale, y: scroll.zoomScale)
      if window.bounds != bounds { window.bounds = bounds }
      if window.center != center { window.center = center }
      if window.transform != transform { window.transform = transform }
      let clipped = rect.intersection(viewport)
      window.isHidden = clipped.isNull || clipped.isEmpty
      let visible = clipped.isNull ? .zero : CGRect(x: (clipped.minX - rect.minX) / scroll.zoomScale, y: (clipped.minY - rect.minY) / scroll.zoomScale, width: clipped.width / scroll.zoomScale, height: clipped.height / scroll.zoomScale)
      if window.viewport != visible {
        window.viewport = visible
        window.viewportMask.path = UIBezierPath(rect: visible).cgPath
      }
      window.isUserInteractionEnabled = !panning
      frame.label.isUserInteractionEnabled = !panning
    }
    positionInspection()
  }

  // MARK: Flow

  /// One undoable transaction that lays frames out by navigation depth; the runtime computes it.
  private func arrangeByFlow() {
    guard !mutationInFlight else { return }
    mutationInFlight = true
    updateEditor()
    request("arrange", body: ["workspaceId": workspaceId, "sequence": sequence]) { [weak self] result in
      guard let self else { return }
      self.mutationInFlight = false
      switch result {
      case .success(let response):
        if let session = response["session"] as? [String: Any], let project = session["project"] as? [String: Any],
          let document = project["document"] as? [String: Any], let records = document["screens"] as? [String: [String: Any]], let order = document["screenIds"] as? [String] {
          self.latestSession = session
          self.sequence = project["sequence"] as? Int ?? self.sequence
          self.entries = records
          self.orderedIds = order
          self.reconcile(order: order)
          self.fit()
        }
      case .failure(let error): self.showError(error)
      }
      self.refresh()
    }
  }
  private func toggleFlow() {
    flowVisible.toggle()
    setToggle(flowButton, on: flowVisible)
    drawFlow()
  }
  /// A curve from the source frame's nearest edge to the destination's, with an arrowhead at the destination.
  private func connector(from source: CGRect, to target: CGRect, offset: CGFloat) -> (UIBezierPath, UIBezierPath) {
    let start: CGPoint, end: CGPoint, control1: CGPoint, control2: CGPoint
    if target.minX >= source.maxX - 1 {
      start = CGPoint(x: source.maxX, y: source.midY + offset)
      end = CGPoint(x: target.minX, y: target.midY + offset)
      let dx = max(40, (end.x - start.x) * 0.5)
      control1 = CGPoint(x: start.x + dx, y: start.y)
      control2 = CGPoint(x: end.x - dx, y: end.y)
    } else if target.maxX <= source.minX + 1 {
      start = CGPoint(x: source.minX, y: source.midY - offset)
      end = CGPoint(x: target.maxX, y: target.midY - offset)
      let dx = max(40, (start.x - end.x) * 0.5)
      control1 = CGPoint(x: start.x - dx, y: start.y)
      control2 = CGPoint(x: end.x + dx, y: end.y)
    } else if target.minY >= source.midY {
      start = CGPoint(x: source.midX + offset, y: source.maxY)
      end = CGPoint(x: target.midX + offset, y: target.minY)
      let dy = max(40, (end.y - start.y) * 0.5)
      control1 = CGPoint(x: start.x, y: start.y + dy)
      control2 = CGPoint(x: end.x, y: end.y - dy)
    } else {
      start = CGPoint(x: source.midX - offset, y: source.minY)
      end = CGPoint(x: target.midX - offset, y: target.maxY)
      let dy = max(40, (start.y - end.y) * 0.5)
      control1 = CGPoint(x: start.x, y: start.y - dy)
      control2 = CGPoint(x: end.x, y: end.y + dy)
    }
    let curve = UIBezierPath()
    curve.move(to: start)
    curve.addCurve(to: end, controlPoint1: control1, controlPoint2: control2)
    let angle = atan2(end.y - control2.y, end.x - control2.x)
    let size: CGFloat = 10
    let tip = UIBezierPath()
    tip.move(to: end)
    tip.addLine(to: CGPoint(x: end.x - size * cos(angle - .pi / 6), y: end.y - size * sin(angle - .pi / 6)))
    tip.addLine(to: CGPoint(x: end.x - size * cos(angle + .pi / 6), y: end.y - size * sin(angle + .pi / 6)))
    tip.close()
    return (curve, tip)
  }
  /// A frame that shares its source with another frame and that nothing links to: a design variant.
  private func isVariant(_ id: String) -> Bool {
    guard let entry = entries[id], let source = entry["source"] as? String, let key = entry["key"] as? String else { return false }
    let linked = entries.values.contains { ($0["links"] as? [String])?.contains(key) == true }
    let shared = entries.contains { other in other.key != id && other.value["source"] as? String == source }
    return shared && !linked
  }
  /// Redraws every authored link as a connector; edges touching the selected frame are highlighted.
  /// A variant's edges repeat its base's, so they show only while the variant is selected.
  private func drawFlow() {
    let edges = UIBezierPath(), arrows = UIBezierPath(), selected = UIBezierPath(), selectedArrows = UIBezierPath()
    let back = UIBezierPath(), backArrows = UIBezierPath()
    if flowVisible {
      let byKey = Dictionary(entries.compactMap { id, entry in (entry["key"] as? String).map { ($0, id) } }, uniquingKeysWith: { first, _ in first })
      for id in orderedIds {
        guard let entry = entries[id], let source = frames[id]?.view.frame, let links = entry["links"] as? [String] else { continue }
        if id != selectedId && isVariant(id) { continue }
        for key in links {
          guard let targetId = byKey[key], targetId != id, let target = frames[targetId]?.view.frame else { continue }
          let reverse = (entries[targetId]?["links"] as? [String])?.contains(entry["key"] as? String ?? "") == true
          let (curve, tip) = connector(from: source, to: target, offset: reverse ? 8 : 0)
          // Forward means down or to the right; anything back up or left is a return path.
          let forward = target.minY >= source.maxY - 1 || target.minX >= source.maxX - 1
          if id == selectedId || targetId == selectedId {
            selected.append(curve)
            selectedArrows.append(tip)
          } else if forward {
            edges.append(curve)
            arrows.append(tip)
          } else {
            back.append(curve)
            backArrows.append(tip)
          }
        }
      }
    }
    flowLayer.path = edges.cgPath
    flowArrowLayer.path = arrows.cgPath
    flowBackLayer.path = back.cgPath
    flowBackArrowLayer.path = backArrows.cgPath
    flowSelectedLayer.path = selected.cgPath
    flowSelectedArrowLayer.path = selectedArrows.cgPath
    let scale = max(0.25, scroll.zoomScale)
    flowLayer.lineWidth = 1.5 / scale
    flowBackLayer.lineWidth = 1 / scale
    flowSelectedLayer.lineWidth = 2 / scale
    flowPulseLayer.lineWidth = 3 / scale
    flowBackLayer.lineDashPattern = [NSNumber(value: 6 / scale), NSNumber(value: 6 / scale)]
  }
  /// Draws the edge a navigation just took, then fades it, so a flow is visible as it happens.
  private func pulseFlow(from: String, to: String) {
    guard flowVisible, let source = frames[from]?.view.frame, let target = frames[to]?.view.frame else { return }
    flowPulseLayer.removeAllAnimations()
    flowPulseLayer.path = connector(from: source, to: target, offset: 0).0.cgPath
    let draw = CABasicAnimation(keyPath: "strokeEnd")
    draw.fromValue = 0
    draw.toValue = 1
    draw.duration = 0.5
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.beginTime = 1.0
    fade.duration = 0.8
    let group = CAAnimationGroup()
    group.animations = [draw, fade]
    group.duration = 1.8
    group.fillMode = .forwards
    group.isRemovedOnCompletion = false
    flowPulseLayer.add(group, forKey: "pulse")
  }

  // MARK: Navigation

  private func togglePan() {
    panning.toggle()
    setToggle(panButton, on: panning)
    scroll.panGestureRecognizer.minimumNumberOfTouches = 1
    scroll.canCancelContentTouches = panning
    if panning { contextLabel.text = "Pan · Drag anywhere to move the canvas · Click the hand again to interact" } else { updateEditor() }
    positionContentWindows()
  }
  private func stopMotion() {
    motion?.invalidate()
    motion = nil
  }
  private var viewportCenter: CGPoint {
    CGPoint(x: (scroll.contentOffset.x + scroll.bounds.width / 2) / scroll.zoomScale,
            y: (scroll.contentOffset.y + scroll.bounds.height / 2) / scroll.zoomScale)
  }
  private func setViewport(scale: CGFloat, center: CGPoint) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    scroll.setZoomScale(scale, animated: false)
    centerBoard()
    scroll.setContentOffset(CGPoint(x: center.x * scale - scroll.bounds.width / 2, y: center.y * scale - scroll.bounds.height / 2), animated: false)
    positionContentWindows()
    CATransaction.commit()
  }
  private func moveViewport(scale: CGFloat, center: CGPoint, animated: Bool) {
    stopMotion()
    let target = min(1.5, max(0.1, scale))
    guard animated && !UIAccessibility.isReduceMotionEnabled else {
      setViewport(scale: target, center: center)
      reportHost()
      return
    }
    motionFromScale = scroll.zoomScale
    motionToScale = target
    motionFromCenter = viewportCenter
    motionToCenter = center
    motionStart = CACurrentMediaTime()
    let link = CADisplayLink(target: self, selector: #selector(stepViewport(_:)))
    motion = link
    link.add(to: .main, forMode: .common)
  }
  @objc private func stepViewport(_ link: CADisplayLink) {
    let progress = min(1, (link.timestamp - motionStart) / 0.22)
    let t = CGFloat(1 - pow(1 - max(0, progress), 3))
    setViewport(scale: motionFromScale + (motionToScale - motionFromScale) * t,
      center: CGPoint(x: motionFromCenter.x + (motionToCenter.x - motionFromCenter.x) * t,
                      y: motionFromCenter.y + (motionToCenter.y - motionFromCenter.y) * t))
    if progress >= 1 { stopMotion(); positionContentWindows(); reportHost() }
  }
  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { stopMotion() }
  func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
    if scrollView.pinchGestureRecognizer?.state == .began || scrollView.pinchGestureRecognizer?.state == .changed { stopMotion() }
  }
  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { positionContentWindows() } }
  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { positionContentWindows() }
  func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { positionContentWindows() }
  private func zoom(by scale: CGFloat) { moveViewport(scale: scroll.zoomScale * scale, center: viewportCenter, animated: false) }
  private func fit() {
    for frame in frames.values { frame.setInteractionEnabled(false) }
    guard boardSize.width > 0 && boardSize.height > 0 && scroll.bounds.width > 0 else { return }
    let width = scroll.bounds.width - boardMargins.left - boardMargins.right
    let height = scroll.bounds.height - boardMargins.top - boardMargins.bottom
    moveViewport(scale: min(1, min(width / boardSize.width, height / boardSize.height)),
      center: CGPoint(x: boardSize.width / 2, y: boardSize.height / 2), animated: false)
  }
  /// Fit the entire screen and its readable title, accounting for inspector and toolbar.
  private func reveal(_ id: String, scale: CGFloat? = nil, animated: Bool) {
    guard let frame = frames[id] else { return }
    guard scroll.bounds.width > 100 else { pendingReveal = (id, scale); return }
    fitted = true
    frame.setInteractionEnabled(true)
    let body = frame.view.frame
    let fitScale = min(1, min((scroll.bounds.width - 96) / body.width, (scroll.bounds.height - 112) / body.height))
    let zoom = scale ?? fitScale
    note = "Focused \(id) · whole screen at \(Int(zoom * 100))%"
    moveViewport(scale: zoom, center: CGPoint(x: body.midX, y: body.midY - 14 / zoom), animated: animated)
  }
  private func showInspection(_ value: [String: Any]?) {
    let nextScreen = value?["screenId"] as? String
    let nextExpiry = (value?["expiresAt"] as? Double ?? 0) / 1000
    if nextScreen != inspectionScreen || nextExpiry != inspectionExpiry {
      inspectionRing.removeAnimation(forKey: "inspection-fade")
      inspectionLabel.layer.removeAnimation(forKey: "inspection-fade")
      if nextScreen != nil && !UIAccessibility.isReduceMotionEnabled {
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        fade.beginTime = CACurrentMediaTime() + max(0, nextExpiry - Date().timeIntervalSince1970 - 0.25)
        fade.duration = 0.25
        fade.fillMode = .forwards
        fade.isRemovedOnCompletion = false
        inspectionRing.add(fade, forKey: "inspection-fade")
        inspectionLabel.layer.add(fade, forKey: "inspection-fade")
      }
    }
    inspectionScreen = nextScreen
    inspectionExpiry = nextExpiry
    inspectionLabel.text = value?["status"] as? String == "captured" ? "  Captured for agent  " : "  Agent inspecting  "
    positionInspection()
  }
  private func positionInspection() {
    guard let id = inspectionScreen, let frame = frames[id], inspectionExpiry > Date().timeIntervalSince1970 else {
      inspectionRing.path = nil
      inspectionLabel.isHidden = true
      return
    }
    let rect = frame.view.convert(frame.view.bounds, to: scroll)
    inspectionRing.path = UIBezierPath(roundedRect: rect.insetBy(dx: -7, dy: -7), cornerRadius: 4).cgPath
    let labelRect = frame.view.convert(frame.view.bounds, to: view)
    inspectionLabel.frame = CGRect(x: labelRect.minX, y: labelRect.minY - 54, width: 146, height: 22)
    inspectionLabel.isHidden = false
    view.bringSubviewToFront(inspectionLabel)
  }

  // MARK: Runtime

  private func request(_ path: String, body: [String: Any]? = nil, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    guard let runtime, let url = URL(string: "\(runtime.absoluteString)/api/\(path)") else { return }
    var request = URLRequest(url: url)
    request.timeoutInterval = 3
    if let body {
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    URLSession.shared.dataTask(with: request) { data, response, error in
      let result: Result<[String: Any], Error>
      do {
        if let error { throw error }
        let json = try JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any] ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
          throw NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: (json["error"] as? [String: Any])?["message"] as? String ?? "Canvas request failed"])
        }
        result = .success(json)
      } catch { result = .failure(error) }
      DispatchQueue.main.async { completion(result) }
    }.resume()
  }
  private func refresh() {
    guard runtime != nil && !fetching else { return }
    fetching = true
    let generation = selectionGeneration
    let wasSelecting = selectionPending
    request("session") { [weak self] result in
      guard let self else { return }
      self.fetching = false
      switch result {
      case .failure(let error): self.setStatus("Reconnecting · \(error.localizedDescription)", .error)
      case .success(let session):
        guard let project = session["project"] as? [String: Any], let id = project["workspaceId"] as? String,
          let doc = project["document"] as? [String: Any], let records = doc["screens"] as? [String: [String: Any]],
          let order = doc["screenIds"] as? [String] else { return }
        if !self.workspaceId.isEmpty && self.workspaceId != id {
          self.setStatus("Project identity changed. Reopen the native canvas.", .error)
          return
        }
        if (project["sequence"] as? Int ?? 0) < self.sequence { return }
        let previousSequence = self.sequence
        let previousSelection = self.selectedId
        let previousVersion = self.latestSession["codeVersion"] as? String
        self.workspaceId = id
        self.sequence = project["sequence"] as? Int ?? 0
        self.documentName = doc["name"] as? String ?? "Expo Canvas"
        self.titleLabel.text = self.documentName + ((doc["appPreview"] as? [String: Any])?["offline"] as? Bool == true ? " · Design preview" : "")
        self.latestSession = session
        self.orderedIds = order
        self.entries = records
        if !wasSelecting && !self.selectionPending && generation == self.selectionGeneration {
          self.selectedId = (session["selection"] as? [String])?.first
        }
        if previousSequence != self.sequence || previousSelection != self.selectedId || previousVersion != session["codeVersion"] as? String {
          self.updateEditor()
        }
        if !self.dragging && self.reconciledSequence != self.sequence {
          self.reconcile(order: order)
          self.reconciledSequence = self.sequence
        } else {
          for (id, frame) in self.frames { frame.select(id == self.selectedId) }
        }
        self.reportHost()
      }
    }
  }
  private func reconcile(order: [String]) {
    let visible = Array(order.prefix(maxScreens))
    for id in frames.keys.filter({ !visible.contains($0) }) {
      guard let frame = frames.removeValue(forKey: id) else { continue }
      frame.contentWindow?.isHidden = true
      frame.contentWindow = nil
      frame.label.removeFromSuperview()
      frame.willMove(toParent: nil)
      frame.view.removeFromSuperview()
      frame.removeFromParent()
    }
    // Frames are created for every authored screen; React roots mount lazily and stay mounted.
    let minX = visible.compactMap { entries[$0]?["x"] as? Double }.min() ?? 0
    let minY = visible.compactMap { entries[$0]?["y"] as? Double }.min() ?? 0
    worldOffset = CGPoint(x: -minX, y: -minY)
    var maxX: CGFloat = 0
    var maxY: CGFloat = 0
    for id in visible {
      guard let entry = entries[id] else { continue }
      let frame: CanvasFrame
      if let existing = frames[id] {
        frame = existing
      } else {
        frame = CanvasFrame(id: id)
        addChild(frame)
        // A view controller's view autoresizes with its superview by default; the board's bounds change
        // whenever frames move, and that stretch would misplace the frame until the next refresh.
        frame.view.autoresizingMask = []
        board.addSubview(frame.view)
        board.addSubview(frame.label)
        frame.didMove(toParent: self)
        setOverrideTraitCollection(UITraitCollection(horizontalSizeClass: .compact), forChild: frame)
        frame.onSelect = { [weak self] in self?.select(id, reveal: true) }
        frame.onMove = { [weak self] gesture in self?.move(id, gesture: gesture) }
        for gesture in frame.label.gestureRecognizers ?? [] { scroll.panGestureRecognizer.require(toFail: gesture) }
        frames[id] = frame
      }
      let width = entry["width"] as? Double ?? 402
      let height = entry["height"] as? Double ?? 874
      frame.label.name.text = entry["name"] as? String ?? "Screen"
      frame.label.detail.text = "\(Int(width)) × \(Int(height))"
      frame.label.accessibilityLabel = entry["name"] as? String ?? "Screen"
      let insets = entry["insets"] as? [String: Any] ?? [:]
      frame.safeAreaInsets = UIEdgeInsets(top: insets["top"] as? Double ?? 0, left: insets["left"] as? Double ?? 0,
        bottom: insets["bottom"] as? Double ?? 0, right: insets["right"] as? Double ?? 0)
      let rect = CGRect(x: (entry["x"] as? Double ?? 0) + worldOffset.x, y: (entry["y"] as? Double ?? 0) + worldOffset.y, width: width, height: height)
      frame.view.frame = rect
      frame.setZoom(scroll.zoomScale)
      layoutTitle(frame)
      maxX = max(maxX, rect.maxX)
      maxY = max(maxY, rect.maxY)
      frame.select(id == selectedId)
    }
    boardSize = CGSize(width: max(1, maxX), height: max(1, maxY))
    board.bounds = CGRect(origin: .zero, size: boardSize)
    board.frame.origin = .zero
    scroll.contentSize = CGSize(width: boardSize.width * scroll.zoomScale, height: boardSize.height * scroll.zoomScale)
    emptyLabel.isHidden = !visible.isEmpty
    centerBoard()
    positionContentWindows()
    drawFlow()
    view.setNeedsLayout()
  }
  private func select(_ id: String, reveal: Bool = false) {
    guard entries[id] != nil else { return }
    selectedId = id
    for (key, frame) in frames { frame.select(key == id) }
    updateEditor()
    drawFlow()
    selectionGeneration += 1
    selectionPending = true
    let generation = selectionGeneration
    request("selection", body: ["workspaceId": workspaceId, "ids": [id]]) { [weak self] result in
      guard let self, self.selectionGeneration == generation else { return }
      self.selectionPending = false
      self.selectionGeneration += 1
      if case .failure(let error) = result { self.inspector.showError(error.localizedDescription) }
    }
    if reveal { self.reveal(id, animated: true) }
  }
  private func updateEditor() {
    inspector.update(session: latestSession, selected: selectedId)
    let history = latestSession["history"] as? [String: Any] ?? [:]
    undoButton?.isEnabled = !mutationInFlight && history["canUndo"] as? Bool == true
    redoButton?.isEnabled = !mutationInFlight && history["canRedo"] as? Bool == true
    addButton?.isEnabled = !mutationInFlight && entries.count < maxScreens && !workspaceId.isEmpty
    screensButton?.menu = UIMenu(children: orderedIds.compactMap { id in
      guard let entry = entries[id] else { return nil }
      return UIAction(title: entry["name"] as? String ?? "Screen", state: id == selectedId ? .on : .off) { [weak self] _ in self?.select(id, reveal: true) }
    })
    if !panning {
      let name = selectedId.flatMap { entries[$0]?["name"] as? String }
      contextLabel.text = name.map { "\($0) · Interact with the screen · Drag its name to move it" } ?? "Click a screen to focus · Drag the background to pan · ⇧⌘2 to fit selection"
    }
  }
  private func toggleInspector() {
    inspectorVisible.toggle()
    inspector.isHidden = !inspectorVisible
    setToggle(inspectorButton, on: inspectorVisible)
    if inspectorVisible { inspector.showEditor() }
    view.endEditing(true)
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }
  private func showInspector() {
    guard !inspectorVisible else { return }
    inspectorVisible = true
    inspector.isHidden = false
    setToggle(inspectorButton, on: true)
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }
  private func showAgentTools() {
    showInspector()
    request("tools") { [weak self] result in
      switch result {
      case .success(let config): self?.inspector.showAgentTools(config)
      case .failure(let error): self?.inspector.showError(error.localizedDescription)
      }
    }
  }
  private func showError(_ error: Error) {
    showInspector()
    inspector.showError(error.localizedDescription)
  }
  private func transact(_ operations: [[String: Any]], label: String, identity: [String: Any]? = nil, completion: ((Result<Void, Error>) -> Void)? = nil) {
    guard !mutationInFlight else {
      completion?(.failure(NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Wait for the current edit to finish."])))
      return
    }
    var command = identity ?? ["workspaceId": workspaceId, "sequence": sequence]
    command["requestId"] = UUID().uuidString
    command["label"] = label
    command["operations"] = operations
    mutationInFlight = true
    updateEditor()
    request("command", body: command) { [weak self] result in
      guard let self else { return }
      self.mutationInFlight = false
      switch result {
      case .success(let result):
        if let session = result["session"] as? [String: Any] {
          self.latestSession = session
          if let project = session["project"] as? [String: Any] { self.sequence = project["sequence"] as? Int ?? self.sequence }
          self.inspector.update(session: session, selected: self.selectedId)
        }
        completion?(.success(()))
        if let created = result["created"] as? [String: String], let id = created.values.first {
          // Reconcile before focus so a newly authored frame can receive selection.
          if let project = self.latestSession["project"] as? [String: Any], let document = project["document"] as? [String: Any],
            let records = document["screens"] as? [String: [String: Any]], let order = document["screenIds"] as? [String] {
            self.entries = records
            self.orderedIds = order
            self.reconcile(order: order)
            self.select(id, reveal: true)
          }
        }
      case .failure(let error):
        self.showError(error)
        completion?(.failure(error))
      }
      self.refresh()
    }
  }
  private func addScreen(copying id: String? = nil) {
    guard entries.count < maxScreens else {
      showInspector()
      inspector.showError("This canvas holds up to \(maxScreens) screens.")
      return
    }
    let existingKeys = Set(entries.values.compactMap { $0["key"] as? String })
    let base = id.flatMap { entries[$0] }
    let prefix = base.map { String(($0["key"] as? String ?? "screen").prefix(45)) + "-copy" } ?? "screen"
    var suffix = 1
    var key = "\(prefix)-\(suffix)"
    while existingKeys.contains(key) {
      suffix += 1
      key = "\(prefix)-\(suffix)"
    }
    var screen: [String: Any] = base ?? ["name": "Screen \(entries.count + 1)", "notes": "Describe this screen's purpose, mock states and interactions."]
    screen.removeValue(forKey: "id")
    screen["key"] = key
    if let base { screen["name"] = String((base["name"] as? String ?? "Screen").prefix(85)) + " · Copy" }
    screen["x"] = (entries.values.map { ($0["x"] as? Double ?? 0) + ($0["width"] as? Double ?? 402) }.max() ?? -72) + 72
    screen["y"] = 0
    transact([["type": "screen.create", "screen": screen]], label: base == nil ? "Add screen" : "Duplicate screen state")
  }
  private func history(_ direction: String) {
    guard !mutationInFlight else { return }
    mutationInFlight = true
    updateEditor()
    request(direction, body: ["workspaceId": workspaceId, "sequence": sequence]) { [weak self] result in
      guard let self else { return }
      self.mutationInFlight = false
      if case .failure(let error) = result { self.showError(error) }
      self.refresh()
    }
  }
  private func resetScreen(_ id: String) {
    request("studio/control", body: ["workspaceId": workspaceId, "sequence": sequence, "hostId": hostId, "action": ["type": "reset", "screenId": id]]) { [weak self] result in
      if case .failure(let error) = result { self?.inspector.showError(error.localizedDescription) }
    }
  }
  private func move(_ id: String, gesture: UIPanGestureRecognizer) {
    guard let frame = frames[id] else { return }
    switch gesture.state {
    case .began:
      dragging = true
      dragOrigin = frame.view.frame.origin
      dragSequence = sequence
      select(id)
    case .changed:
      let delta = gesture.translation(in: board)
      frame.view.frame.origin = CGPoint(x: dragOrigin.x + delta.x, y: dragOrigin.y + delta.y)
      layoutTitle(frame)
      positionContentWindows()
      drawFlow()
    case .ended:
      let delta = gesture.translation(in: board)
      let point = CGPoint(x: dragOrigin.x + delta.x, y: dragOrigin.y + delta.y)
      frame.view.frame.origin = point
      layoutTitle(frame)
      positionContentWindows()
      if abs(delta.x) < 0.5 && abs(delta.y) < 0.5 {
        dragging = false
        return
      }
      let operation: [String: Any] = ["type": "screen.update", "id": id, "patch": ["x": point.x - worldOffset.x, "y": point.y - worldOffset.y]]
      request("command", body: ["workspaceId": workspaceId, "sequence": dragSequence, "requestId": UUID().uuidString, "label": "Move screen", "operations": [operation]]) { [weak self] result in
        self?.dragging = false
        if case .failure(let error) = result { self?.setStatus(error.localizedDescription, .error) }
        self?.refresh()
      }
    case .cancelled, .failed:
      dragging = false
      refresh()
    default: break
    }
  }
  /// Renders the canvas and every mounted frame window into one image without ScreenCaptureKit,
  /// so agents get captures even where screen recording is unavailable, and posts it to the
  /// runtime (the sandboxed app cannot write into the project). Presented sheets that UIKit
  /// hosts in separate compositor windows are not part of this snapshot.
  private func snapshot(command: Int, screenId: String? = nil) {
    if let screenId {
      guard let frame = frames[screenId], let root = frame.root, frame.isMounted else { return }
      let format = UIGraphicsImageRendererFormat.default()
      format.scale = 2
      let bounds = CGRect(origin: .zero, size: frame.view.bounds.size)
      let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
        root.drawHierarchy(in: bounds, afterScreenUpdates: true)
      }
      guard let png = image.pngData() else { return }
      request("studio/snapshot", body: ["workspaceId": workspaceId, "hostId": hostId, "id": command, "png": png.base64EncodedString()]) { _ in }
      return
    }
    guard let canvasWindow = view.window else { return }
    let bounds = canvasWindow.bounds
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = canvasWindow.screen.scale
    let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { context in
      canvasWindow.drawHierarchy(in: bounds, afterScreenUpdates: true)
      let origin = canvasWindow.frame.origin
      for id in orderedIds {
        guard let window = frames[id]?.contentWindow, !window.isHidden else { continue }
        let rect = window.frame.offsetBy(dx: -origin.x, dy: -origin.y)
        let zoom = scroll.zoomScale
        let clip = CGRect(x: rect.minX + window.viewport.minX * zoom, y: rect.minY + window.viewport.minY * zoom,
          width: window.viewport.width * zoom, height: window.viewport.height * zoom)
        context.cgContext.saveGState()
        context.cgContext.clip(to: clip)
        window.drawHierarchy(in: rect, afterScreenUpdates: true)
        context.cgContext.restoreGState()
      }
    }
    guard let png = image.pngData() else {
      setStatus("Capture failed · no image", .error)
      return
    }
    request("studio/snapshot", body: ["workspaceId": workspaceId, "hostId": hostId, "id": command, "png": png.base64EncodedString()]) { [weak self] result in
      if case .failure(let error) = result { self?.setStatus("Capture failed · \(error.localizedDescription)", .error) }
    }
  }
  private func reportHost() {
    let mountedCount = frames.values.filter(\.isMounted).count
    let zoom = max(0.01, scroll.zoomScale)
    let viewport: [String: Any] = ["x": scroll.contentOffset.x / zoom, "y": scroll.contentOffset.y / zoom, "width": scroll.bounds.width / zoom, "height": scroll.bounds.height / zoom]
    request("studio/report", body: ["kind": "host", "workspaceId": workspaceId, "hostId": hostId,
      "pid": ProcessInfo.processInfo.processIdentifier, "screenIds": frames.values.filter(\.isMounted).map(\.id), "acknowledged": acknowledged,
      "width": view.bounds.width, "height": view.bounds.height, "zoom": scroll.zoomScale, "viewport": viewport, "note": String(note.prefix(1000)),
      "platform": ProcessInfo.processInfo.isiOSAppOnMac ? "ios-on-mac" : "ios", "focusedScreenId": selectedId ?? NSNull(), "settled": motion == nil && !scroll.isDragging && !scroll.isZooming && !scroll.isDecelerating, "screenCapture": true, "error": NSNull()]) { [weak self] result in
      guard let self, case .success(let response) = result else { return }
      if let error = response["error"] as? String {
        self.setStatus(error, .error)
      } else {
        let count = response["readyCount"] as? Int ?? 0
        if ["ready", "degraded"].contains(response["phase"] as? String ?? "") {
          let sdk = Bundle.main.object(forInfoDictionaryKey: "CanvasExpoSDK") as? Int ?? 54
          let waiting = response["waitingCount"] as? Int ?? 0
          let needsState = response["needsStateCount"] as? Int ?? 0
          let failures = response["screenErrorCount"] as? Int ?? 0
          let pending = waiting + needsState
          let coverage = (pending > 0 ? " · \(pending) need state or parameters" : "") + (failures > 0 ? " · \(failures) frame errors" : "")
          self.setStatus("\(count) frames running\(coverage) · Expo SDK \(sdk) · iOS on Mac", .ready)
        } else {
          self.setStatus("Loading screens · \(count) of \(mountedCount) current", .busy)
        }
      }
      self.showInspection(response["inspection"] as? [String: Any])
      guard let command = response["command"] as? [String: Any], let id = command["id"] as? Int, id > self.acknowledged else { return }
      self.acknowledged = id
      if command["type"] as? String == "focus", let screen = command["screenId"] as? String {
        self.select(screen, reveal: true)
        if let from = command["from"] as? String { self.pulseFlow(from: from, to: screen) }
      }
      if command["type"] as? String == "fit" { self.fit() }
      if command["type"] as? String == "capture" { self.snapshot(command: id, screenId: command["screenId"] as? String) }
      if command["type"] as? String == "zoom", let scale = command["scale"] as? Double {
        // An explicit zoom, including the one that reveals a requested screen on open, outranks the first-layout fit.
        self.fitted = true
        if let screen = command["screenId"] as? String {
          self.select(screen)
          self.reveal(screen, scale: CGFloat(scale), animated: false)
        } else {
          self.scroll.setZoomScale(min(1.5, max(0.1, scale)), animated: false)
          self.scrollViewDidZoom(self.scroll)
        }
      }
      if command["type"] as? String == "stop" { exit(0) }
    }
  }
}
