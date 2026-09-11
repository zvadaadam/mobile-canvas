import UIKit
import CoreText

func argument(_ name: String) -> String? {
  let args = ProcessInfo.processInfo.arguments
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}

class CanvasSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene, let app = UIApplication.shared.delegate as? CanvasApplicationDelegate else { return }
    window = UIWindow(windowScene: scene)
    window?.overrideUserInterfaceStyle = .light
    window?.rootViewController = CanvasController(renderer: app.canvasRenderer)
    window?.makeKeyAndVisible()
  }
  func sceneWillResignActive(_ scene: UIScene) {
    (window?.rootViewController as? CanvasController)?.suspendViewportMotion()
  }
  func sceneDidBecomeActive(_ scene: UIScene) {
    (window?.rootViewController as? CanvasController)?.restoreWindowLayout()
  }
}

// MARK: - Canvas


private let toolbarHeight: CGFloat = 52
private let statusHeight: CGFloat = 30
private let inspectorWidth: CGFloat = 300
private let navigatorWidth: CGFloat = 224
private let canvasToolsClearance: CGFloat = 64
/// Room around the board in screen points; the top keeps the counter-scaled frame names visible.
private let boardMargins = UIEdgeInsets(top: 48, left: 32, bottom: 32, right: 32)

final class CanvasController: UIViewController, UIScrollViewDelegate {
  private let renderer: CanvasRendering
  private var maxScreens: Int { renderer.maximumScreens }
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
  private let navigator = CanvasNavigator()
  private var navigatorVisible = true
  private let canvasTools = UIStackView()
  private var toolsWindow: CanvasToolsWindow?
  private let inspector = CanvasInspector()
  private var inspectorVisible = true
  private var latestSession: [String: Any] { session.dictionary }
  private var orderedIds: [String] = []
  private var mutationInFlight = false
  private weak var undoButton: UIButton?
  private weak var redoButton: UIButton?
  private weak var addButton: UIButton?
  private weak var navigatorButton: UIButton?
  private weak var selectButton: UIButton?
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
  private var entries: [String: [String: Any]] { session.entries }
  private var workspaceId: String { session.state.workspaceId }
  private var sequence: Int { session.state.sequence }
  private var documentName = "Expo Canvas"
  private var selectedId: String? { session.state.selectedId }
  private var fitted = false
  private var dragging = false
  private var panning = false
  private var reconciledSequence = -1
  private let camera = CanvasCamera()
  private var inspectionScreen: String?
  private var inspectionExpiry: TimeInterval = 0
  private let inspectionRing = CAShapeLayer()
  private let inspectionLabel = UILabel()
  private var dragOrigin = CGPoint.zero
  private var dragSequence = 0
  private var worldOffset = CGPoint.zero
  private var boardSize = CGSize(width: 1200, height: 1000)
  /// A frame to center once the window has a real size; a reveal before the first layout would use empty bounds.
  private var lastWindowSize = CGSize.zero
  private var pendingReveal: (id: String, scale: CGFloat?)?
  /// The last reveal's computation, reported to the runtime so an agent can see why the canvas looks where it does.
  private var note = ""
  private var previewActivity: NSObjectProtocol?
  private var acknowledged = 0
  private let hostId = argument("--host-id") ?? UUID().uuidString
  private let session: CanvasSession
  private var runtime: URL? { session.client.baseURL }
  private var reporting = false
  private enum Tone { case idle, busy, ready, error }

  init(renderer: CanvasRendering) {
    self.renderer = renderer
    let candidate = URL(string: argument("--canvas-runtime") ?? "")
    session = CanvasSession(client: CanvasRuntimeClient(url: candidate))
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  isolated deinit {
    camera.stop()
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
    navigator.onSelect = { [weak self] id in self?.select(id, reveal: true) }
    view.addSubview(navigator)
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
      let endpoint = (props?["route"] != nil || props?["native"] != nil) && screenId != nil ? "route-source?screenId=\(screenId!)" : "source?path=\(encoded)"
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
      ("1", [.command, .shift], #selector(fitCommand), "Fit All Screens"), ("2", [.command, .shift], #selector(focusCommand), "Fit Selected Screen"), ("i", [.command, .shift], #selector(inspectorCommand), "Toggle Inspector"), ("l", [.command, .shift], #selector(navigatorCommand), "Toggle Screen List"),
    ] as [(String, UIKeyModifierFlags, Selector, String)] {
      addKeyCommand(UIKeyCommand(title: title, action: action, input: input, modifierFlags: flags))
    }
    if runtime != nil && ProcessInfo.processInfo.isiOSAppOnMac {
      previewActivity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Running the explicitly opened Expo design canvas")
    }
    session.onChange = { [weak self] changed in self?.renderSession(contentChanged: changed) }
    session.onError = { [weak self] error in self?.setStatus(error.localizedDescription, .error) }
    session.start()
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
    let navigatorToggle = icon("sidebar.left", label: "Screen list", key: "⇧⌘L", identifier: "canvas.screens") { [weak self] in self?.toggleNavigator() }
    navigatorButton = navigatorToggle
    setToggle(navigatorToggle, on: navigatorVisible)
    let select = icon("cursorarrow", label: "Select and interact", identifier: "canvas.select") { [weak self] in
      if self?.panning == true { self?.togglePan() }
    }
    selectButton = select
    setToggle(select, on: true)
    let pan = icon("hand.draw", label: "Pan the canvas", identifier: "canvas.pan") { [weak self] in self?.togglePan() }
    panButton = pan
    let flow = icon("arrow.triangle.branch", label: "Show the app flow", identifier: "canvas.flow") { [weak self] in self?.toggleFlow() }
    flowButton = flow
    setToggle(flow, on: true)
    let arrange = icon("rectangle.3.group", label: "Arrange by flow", identifier: "canvas.arrange") { [weak self] in self?.arrangeByFlow() }
    let zoomOut = icon("minus", label: "Zoom out", key: "⌘−", identifier: "canvas.zoom-out") { [weak self] in self?.zoom(by: 0.8) }
    var zoomConfig = UIButton.Configuration.plain()
    zoomConfig.title = "100%"
    zoomConfig.image = UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 8, weight: .medium))
    zoomConfig.imagePlacement = .trailing
    zoomConfig.imagePadding = 3
    zoomConfig.baseForegroundColor = Palette.icon
    zoomConfig.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 4, bottom: 6, trailing: 4)
    zoomConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
      return attributes
    }
    zoomButton.configuration = zoomConfig
    zoomButton.accessibilityLabel = "Zoom options"
    zoomButton.accessibilityIdentifier = "canvas.zoom-reset"
    zoomButton.toolTip = "Zoom · Fit all ⇧⌘1 · Fit selection ⇧⌘2"
    zoomButton.widthAnchor.constraint(equalToConstant: 62).isActive = true
    zoomButton.heightAnchor.constraint(equalToConstant: 36).isActive = true
    zoomButton.showsMenuAsPrimaryAction = true
    zoomButton.menu = UIMenu(children: [
      UIAction(title: "Fit all screens", image: UIImage(systemName: "arrow.up.left.and.arrow.down.right")) { [weak self] _ in self?.fit() },
      UIAction(title: "Fit selected screen", image: UIImage(systemName: "viewfinder")) { [weak self] _ in self?.focusCommand() },
      UIAction(title: "Actual size · 100%") { [weak self] _ in self?.zoomResetCommand() },
      UIMenu(options: .displayInline, children: [25, 50, 75, 100, 150].map { percent in
        UIAction(title: "\(percent)%") { [weak self] _ in
          guard let self else { return }
          self.moveViewport(scale: CGFloat(percent) / 100, center: self.viewportCenter, animated: false)
        }
      }),
    ])
    let zoomIn = icon("plus", label: "Zoom in", key: "⌘+", identifier: "canvas.zoom-in") { [weak self] in self?.zoom(by: 1.25) }
    let inspectorToggle = icon("sidebar.right", label: "Inspector", key: "⇧⌘I", identifier: "canvas.inspector") { [weak self] in self?.toggleInspector() }
    inspectorButton = inspectorToggle
    setToggle(inspectorToggle, on: inspectorVisible)
    let agent = pill("Agent", symbol: "terminal", identifier: "canvas.agent-tools") { [weak self] in self?.showAgentTools() }
    let trailing = UIStackView(arrangedSubviews: [
      group([undo, redo]), group([navigatorToggle, inspectorToggle]), agent, add,
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
      leading.centerYAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: -toolbarHeight / 2),
      trailing.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -16),
      trailing.centerYAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: -toolbarHeight / 2),
      leading.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -16),
    ])
    view.addSubview(toolbar)
    canvasTools.axis = .horizontal
    canvasTools.spacing = 12
    canvasTools.alignment = .center
    for buttons in [[select, pan, flow, arrange], [zoomOut, zoomButton, zoomIn]] {
      let cluster = group(buttons)
      cluster.backgroundColor = Palette.surface
      cluster.layer.cornerRadius = 12
      cluster.layer.borderWidth = hairlineWidth
      cluster.layer.borderColor = Palette.border.cgColor
      cluster.layer.shadowColor = UIColor.black.cgColor
      cluster.layer.shadowOpacity = 0.08
      cluster.layer.shadowRadius = 10
      cluster.layer.shadowOffset = CGSize(width: 0, height: 3)
      canvasTools.addArrangedSubview(cluster)
    }
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
    button.widthAnchor.constraint(equalToConstant: 36).isActive = true
    button.heightAnchor.constraint(equalToConstant: 36).isActive = true
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
  @objc private func navigatorCommand() { toggleNavigator() }

  // MARK: Layout

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let previousCenter = viewportCenter
    let resized = lastWindowSize != .zero && lastWindowSize != view.bounds.size
    lastWindowSize = view.bounds.size
    if resized { stopMotion() }
    let top = view.safeAreaInsets.top
    let panel: CGFloat = inspectorVisible ? min(inspectorWidth, view.bounds.width * 0.3) : 0
    let sidebar: CGFloat = navigatorVisible ? min(navigatorWidth, view.bounds.width * 0.23) : 0
    let canvasWidth = view.bounds.width - panel - sidebar
    toolbar.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: top + toolbarHeight)
    toolbarLine.frame = CGRect(x: 0, y: top + toolbarHeight - hairlineWidth, width: view.bounds.width, height: hairlineWidth)
    scroll.frame = CGRect(x: sidebar, y: top + toolbarHeight, width: canvasWidth, height: max(1, view.bounds.height - top - toolbarHeight - statusHeight))
    statusBar.frame = CGRect(x: sidebar, y: view.bounds.height - statusHeight, width: canvasWidth, height: statusHeight)
    statusLine.frame = CGRect(x: 0, y: 0, width: canvasWidth, height: hairlineWidth)
    statusDot.frame = CGRect(x: 16, y: (statusHeight - 8) / 2, width: 8, height: 8)
    statusLabel.frame = CGRect(x: 30, y: 0, width: max(0, canvasWidth * 0.5 - 30), height: statusHeight)
    contextLabel.frame = CGRect(x: canvasWidth * 0.5, y: 0, width: max(0, canvasWidth * 0.5 - 16), height: statusHeight)
    navigator.frame = CGRect(x: 0, y: top + toolbarHeight, width: sidebar, height: view.bounds.height - top - toolbarHeight)
    inspector.frame = CGRect(x: view.bounds.width - panel, y: top + toolbarHeight, width: panel, height: view.bounds.height - top - toolbarHeight)
    emptyLabel.frame = scroll.frame.insetBy(dx: 40, dy: 0)
    positionTools()
    centerBoard()
    if resized && fitted { setViewport(scale: scroll.zoomScale, center: previousCenter) }
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
  private func positionTools() {
    guard let scene = view.window?.windowScene else { return }
    if toolsWindow == nil {
      let window = CanvasToolsWindow(windowScene: scene)
      window.windowLevel = .normal + 2
      window.overrideUserInterfaceStyle = .light
      window.backgroundColor = .clear
      let controller = UIViewController()
      controller.view.backgroundColor = .clear
      controller.view.addSubview(canvasTools)
      window.rootViewController = controller
      toolsWindow = window
    }
    let size = canvasTools.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    let origin = view.convert(CGPoint(x: scroll.frame.midX - size.width / 2, y: scroll.frame.maxY - size.height - 16), to: view.window)
    toolsWindow?.frame = CGRect(origin: origin, size: size)
    canvasTools.frame = CGRect(origin: .zero, size: size)
    toolsWindow?.isHidden = false
  }
  override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); positionTools() }
  func suspendViewportMotion() { stopMotion() }
  func restoreWindowLayout() {
    view.setNeedsLayout()
    view.layoutIfNeeded()
    positionContentWindows()
    positionTools()
    reportHost()
  }
  func viewForZooming(in scrollView: UIScrollView) -> UIView? { board }
  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    zoomButton.configuration?.title = "\(Int((scroll.zoomScale * 100).rounded()))%"
    zoomButton.accessibilityValue = zoomButton.configuration?.title
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
      let request = CanvasFrameRequest(id: id, runtime: runtime, workspaceId: workspaceId, hostId: hostId,
        entry: entries[id] ?? [:], codeVersion: latestSession["codeVersion"] as? String ?? "")
      frame.mount(rendered: renderer.makeFrame(request), in: scene)
      mounted = true
    }
    if mounted { reportHost() }
  }
  private func positionContentWindows() {
    guard let canvasWindow = view.window else { return }
    if !camera.isMoving && !scroll.isDragging && !scroll.isDecelerating && !scroll.isZooming { mountVisibleFrames() }
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
    session.client.request("arrange", body: ["workspaceId": workspaceId, "sequence": sequence], as: CanvasMutationReceipt.self) { [weak self] result in
      guard let self else { return }
      self.mutationInFlight = false
      do {
        try self.session.accept(result.get().session)
        self.fit()
      } catch { self.showError(error) }
      self.updateEditor()
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
    setToggle(selectButton, on: !panning)
    scroll.panGestureRecognizer.minimumNumberOfTouches = 1
    scroll.canCancelContentTouches = panning
    if panning { contextLabel.text = "Pan · Drag anywhere to move the canvas · Click the hand again to interact" } else { updateEditor() }
    positionContentWindows()
  }
  private func stopMotion() { camera.stop() }
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
    camera.move(from: .init(scale: scroll.zoomScale, center: viewportCenter),
      to: .init(scale: CanvasViewport.clamp(scale), center: center), animated: animated,
      apply: { [weak self] position in self?.setViewport(scale: position.scale, center: position.center) },
      completion: { [weak self] in self?.positionContentWindows(); self?.reportHost() })
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
    guard let target = CanvasViewport.fit(board: boardSize, viewport: scroll.bounds.size,
      horizontalMargins: boardMargins.left + boardMargins.right,
      verticalMargins: boardMargins.top + boardMargins.bottom, toolsClearance: canvasToolsClearance) else { return }
    moveViewport(scale: target.scale, center: target.center, animated: false)
  }
  /// Fit the entire screen and its readable title, accounting for inspector and toolbar.
  private func reveal(_ id: String, scale: CGFloat? = nil, animated: Bool) {
    guard let frame = frames[id] else { return }
    guard let target = CanvasViewport.focus(frame: frame.view.frame, viewport: scroll.bounds.size,
      scale: scale, toolsClearance: canvasToolsClearance) else { pendingReveal = (id, scale); return }
    fitted = true
    frame.setInteractionEnabled(true)
    note = "Focused \(id) · whole screen at \(Int(target.scale * 100))%"
    moveViewport(scale: target.scale, center: target.center, animated: animated)
  }
  private func showInspection(_ value: CanvasHostReceipt.Inspection?) {
    let nextScreen = value?.screenId
    let nextExpiry = (value?.expiresAt ?? 0) / 1000
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
    inspectionLabel.text = value?.status == "captured" ? "  Captured for agent  " : "  Agent inspecting  "
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

  private func request(_ path: String, body: [String: Any]? = nil, completion: @escaping @MainActor (Result<[String: Any], Error>) -> Void) {
    session.client.request(path, body: body, completion: completion)
  }
  private func refresh() { session.refresh() }

  private func renderSession(contentChanged: Bool) {
    guard let snapshot = session.state.snapshot else { return }
    documentName = snapshot.project.document.name
    let document = latestSession["project"] as? [String: Any]
    let offline = ((document?["document"] as? [String: Any])?["appPreview"] as? [String: Any])?["offline"] as? Bool == true
    titleLabel.text = documentName + (offline ? " · Design preview" : "")
    orderedIds = snapshot.project.document.screenIds
    for (id, frame) in frames { frame.rendered?.update(entries[id] ?? [:], snapshot.codeVersion) }
    if contentChanged { updateEditor() }
    if !dragging && reconciledSequence != sequence {
      reconcile(order: orderedIds)
      reconciledSequence = sequence
    } else {
      for (id, frame) in frames { frame.select(id == selectedId) }
    }
    reportHost()
  }
  private func reconcile(order: [String]) {
    guard let records = session.state.snapshot?.project.document.screens else { return }
    let visible = Array(order.prefix(maxScreens))
    for id in frames.keys.filter({ !visible.contains($0) }) {
      guard let frame = frames.removeValue(forKey: id) else { continue }
      frame.unmount()
    }
    // Frames are created for every authored screen; React roots mount lazily and stay mounted.
    let minX = visible.compactMap { records[$0]?.x }.min() ?? 0
    let minY = visible.compactMap { records[$0]?.y }.min() ?? 0
    worldOffset = CGPoint(x: -minX, y: -minY)
    var maxX: CGFloat = 0
    var maxY: CGFloat = 0
    for id in visible {
      guard let entry = records[id] else { continue }
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
      let width = entry.width
      let height = entry.height
      frame.label.name.text = entry.name
      frame.label.detail.text = "\(Int(width)) × \(Int(height))"
      frame.label.accessibilityLabel = entry.name
      frame.safeAreaInsets = UIEdgeInsets(top: entry.insets?.top ?? 0, left: entry.insets?.left ?? 0,
        bottom: entry.insets?.bottom ?? 0, right: entry.insets?.right ?? 0)
      let rect = CGRect(x: entry.x + worldOffset.x, y: entry.y + worldOffset.y, width: width, height: height)
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
    session.select(id)
    for (key, frame) in frames { frame.select(key == id) }
    updateEditor()
    drawFlow()
    if reveal { self.reveal(id, animated: true) }
  }
  private func updateEditor() {
    inspector.update(session: latestSession, selected: selectedId)
    let history = latestSession["history"] as? [String: Any] ?? [:]
    undoButton?.isEnabled = !mutationInFlight && history["canUndo"] as? Bool == true
    redoButton?.isEnabled = !mutationInFlight && history["canRedo"] as? Bool == true
    addButton?.isEnabled = !mutationInFlight && entries.count < maxScreens && !workspaceId.isEmpty
    navigator.update(order: orderedIds, records: entries, selected: selectedId)
    if !panning {
      let name = selectedId.flatMap { entries[$0]?["name"] as? String }
      contextLabel.text = name.map { "\($0) · Interact with the screen · Drag its name to move it" } ?? "Click a screen to focus · Drag the background to pan · ⇧⌘2 to fit selection"
    }
  }
  private func toggleNavigator() {
    let center = viewportCenter
    navigatorVisible.toggle()
    navigator.isHidden = !navigatorVisible
    setToggle(navigatorButton, on: navigatorVisible)
    relayoutPanels(center: center)
  }
  private func relayoutPanels(center: CGPoint) {
    view.endEditing(true)
    view.setNeedsLayout()
    view.layoutIfNeeded()
    if let selectedId { reveal(selectedId, animated: false) }
    else { moveViewport(scale: scroll.zoomScale, center: center, animated: false) }
  }
  private func toggleInspector() {
    let center = viewportCenter
    inspectorVisible.toggle()
    inspector.isHidden = !inspectorVisible
    setToggle(inspectorButton, on: inspectorVisible)
    if inspectorVisible { inspector.showEditor() }
    relayoutPanels(center: center)
  }
  private func showInspector() {
    guard !inspectorVisible else { return }
    let center = viewportCenter
    inspectorVisible = true
    inspector.isHidden = false
    setToggle(inspectorButton, on: true)
    relayoutPanels(center: center)
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
    session.client.request("command", body: command, as: CanvasMutationReceipt.self) { [weak self] result in
      guard let self else { return }
      self.mutationInFlight = false
      do {
        let receipt = try result.get()
        try self.session.accept(receipt.session)
        completion?(.success(()))
        if let id = receipt.created?.values.first {
          // Session acceptance reconciles the new frame before focusing it.
          self.select(id, reveal: true)
        }
      } catch {
        self.showError(error)
        completion?(.failure(error))
      }
      self.updateEditor()
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
      self.updateEditor()
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
        self?.reconciledSequence = -1
        if case .failure(let error) = result { self?.setStatus(error.localizedDescription, .error) }
        self?.refresh()
      }
    case .cancelled, .failed:
      dragging = false
      reconciledSequence = -1
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
      if let toolsWindow, !toolsWindow.isHidden {
        toolsWindow.drawHierarchy(in: toolsWindow.frame.offsetBy(dx: -origin.x, dy: -origin.y), afterScreenUpdates: true)
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
    guard !reporting, !workspaceId.isEmpty else { return }
    reporting = true
    let mountedCount = frames.values.filter(\.isMounted).count
    let zoom = max(0.01, scroll.zoomScale)
    let viewport: [String: Any] = ["x": scroll.contentOffset.x / zoom, "y": scroll.contentOffset.y / zoom, "width": scroll.bounds.width / zoom, "height": scroll.bounds.height / zoom]
    session.client.request("studio/report", body: ["kind": "host", "workspaceId": workspaceId, "hostId": hostId,
      "pid": ProcessInfo.processInfo.processIdentifier, "screenIds": frames.values.filter(\.isMounted).map(\.id), "acknowledged": acknowledged,
      "width": view.bounds.width, "height": view.bounds.height, "zoom": scroll.zoomScale, "viewport": viewport, "note": String(note.prefix(1000)),
      "platform": ProcessInfo.processInfo.isiOSAppOnMac ? "ios-on-mac" : "ios", "focusedScreenId": selectedId ?? NSNull(), "settled": !camera.isMoving && !scroll.isDragging && !scroll.isZooming && !scroll.isDecelerating, "screenCapture": true, "error": NSNull()], as: CanvasHostReceipt.self) { [weak self] result in
      guard let self else { return }
      self.reporting = false
      guard case .success(let response) = result else {
        if case .failure(let error) = result { self.setStatus(error.localizedDescription, .error) }
        return
      }
      if let error = response.error {
        self.setStatus(error, .error)
      } else {
        let count = response.readyCount
        if ["ready", "degraded"].contains(response.phase) {
          let rendererName = self.renderer.name
          let waiting = response.waitingCount
          let needsState = response.needsStateCount
          let failures = response.screenErrorCount
          let pending = waiting + needsState
          let coverage = (pending > 0 ? " · \(pending) need state or parameters" : "") + (failures > 0 ? " · \(failures) frame errors" : "")
          self.setStatus("\(count) frames running\(coverage) · \(rendererName) · iOS on Mac", .ready)
        } else {
          self.setStatus("Loading screens · \(count) of \(mountedCount) current", .busy)
        }
      }
      self.showInspection(response.inspection)
      guard let command = response.command, command.id > self.acknowledged else { return }
      self.acknowledged = command.id
      switch command.action {
      case .focus(let screen, let from):
        self.select(screen, reveal: true)
        if let from { self.pulseFlow(from: from, to: screen) }
      case .fit: self.fit()
      case .capture(let screen): self.snapshot(command: command.id, screenId: screen)
      case .zoom(let scale, let screen):
        self.fitted = true
        if let screen {
          self.select(screen)
          self.reveal(screen, scale: CGFloat(scale), animated: false)
        } else {
          self.scroll.setZoomScale(CanvasViewport.clamp(scale), animated: false)
          self.scrollViewDidZoom(self.scroll)
        }
      case .stop: exit(0)
      }
    }
  }
}
