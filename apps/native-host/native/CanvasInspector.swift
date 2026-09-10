import UIKit

/// Human editing uses the same guarded transaction as CLI/MCP. Drafts never enter the document.
final class CanvasInspector: UIView, UITextViewDelegate {
  var onApply: (([String: Any], String, [String: Any], @escaping (Result<Void, Error>) -> Void) -> Void)?
  var onReset: ((String) -> Void)?
  var onDuplicate: ((String) -> Void)?
  var onSource: ((String, String?) -> Void)?
  private let edge = hairline()
  private let scroll = UIScrollView()
  private let stack = UIStackView()
  private let editor = UIStackView()
  private let auxiliary = UIStackView()
  private let heading = UILabel()
  private let pathLabel = UILabel()
  private let previewLabel = UILabel()
  private let message = UILabel()
  private let nameField = UITextField()
  private let positionX = UITextField()
  private let positionY = UITextField()
  private let propsField = UITextView()
  private let notesField = UITextView()
  private let applyButton = UIButton(type: .system)
  private let discardButton = UIButton(type: .system)
  private var duplicateButton: UIButton!
  private var boundID: String?
  private var identity: [String: Any] = [:]
  private var baseline: [String: Any] = [:]
  private var latestSession: [String: Any] = [:]
  private var latestSelection: String?
  private var dirty = false
  private var draftError: String?
  private var saving = false
  private var showingAuxiliary = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = Palette.surface
    scroll.alwaysBounceVertical = true
    scroll.translatesAutoresizingMaskIntoConstraints = false
    addSubview(scroll)
    addSubview(edge)
    stack.axis = .vertical
    stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: topAnchor), scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: leadingAnchor), scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
      stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
    ])
    heading.font = Fonts.medium(15)
    heading.textColor = Palette.ink
    heading.numberOfLines = 2
    pathLabel.font = Fonts.mono(11)
    pathLabel.textColor = Palette.muted
    pathLabel.lineBreakMode = .byTruncatingMiddle
    previewLabel.font = Fonts.medium(12)
    previewLabel.textColor = Palette.muted
    previewLabel.numberOfLines = 0
    let title = UIStackView(arrangedSubviews: [heading, pathLabel, previewLabel])
    title.axis = .vertical
    title.spacing = 4
    stack.addArrangedSubview(title)
    editor.axis = .vertical
    editor.spacing = 16
    stack.addArrangedSubview(editor)
    auxiliary.axis = .vertical
    auxiliary.spacing = 16
    auxiliary.isHidden = true
    stack.addArrangedSubview(auxiliary)
    configure(nameField, label: "Screen name")
    editor.addArrangedSubview(field("Name", nameField))
    configure(positionX, label: "Screen x")
    configure(positionY, label: "Screen y")
    positionX.keyboardType = .numbersAndPunctuation
    positionY.keyboardType = .numbersAndPunctuation
    let positions = UIStackView(arrangedSubviews: [positionX, positionY])
    positions.axis = .horizontal
    positions.spacing = 8
    positions.distribution = .fillEqually
    editor.addArrangedSubview(field("Position", positions))
    positionX.leftView = coordinateLabel("X")
    positionY.leftView = coordinateLabel("Y")
    configure(propsField, label: "Preview props", height: 104, monospaced: true)
    editor.addArrangedSubview(field("Preview props", propsField))
    configure(notesField, label: "Screen context", height: 120)
    editor.addArrangedSubview(field("Context", notesField))
    style(applyButton, title: "Apply changes", primary: true)
    applyButton.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
    style(discardButton, title: "Discard")
    discardButton.addAction(UIAction { [weak self] _ in
      guard let self else { return }
      self.dirty = false
      self.draftError = nil
      self.boundID = nil
      self.update(session: self.latestSession, selected: self.latestSelection)
    }, for: .touchUpInside)
    let actions = UIStackView(arrangedSubviews: [applyButton, discardButton, UIView()])
    actions.axis = .horizontal
    actions.spacing = 8
    editor.addArrangedSubview(actions)
    editor.addArrangedSubview(divider())
    let source = makeButton("View source") { [weak self] in
      guard let self, let source = self.baseline["source"] as? String else { return }
      self.onSource?(source, self.boundID)
    }
    let reset = makeButton("Reset state") { [weak self] in
      guard let self, let id = self.boundID else { return }
      self.onReset?(id)
    }
    duplicateButton = makeButton("Duplicate") { [weak self] in
      guard let self, let id = self.boundID else { return }
      self.onDuplicate?(id)
    }
    editor.addArrangedSubview(source)
    let tools = UIStackView(arrangedSubviews: [reset, duplicateButton!])
    tools.axis = .horizontal
    tools.distribution = .fillEqually
    tools.spacing = 8
    editor.addArrangedSubview(tools)
    message.font = Fonts.regular(12)
    message.textColor = Palette.muted
    message.numberOfLines = 0
    stack.addArrangedSubview(message)
    update(session: [:], selected: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  override func layoutSubviews() {
    super.layoutSubviews()
    edge.frame = CGRect(x: 0, y: 0, width: hairlineWidth, height: bounds.height)
  }

  // MARK: Components

  private func coordinateLabel(_ text: String) -> UIView {
    let container = UIView(frame: CGRect(x: 0, y: 0, width: 30, height: 32))
    let label = UILabel(frame: CGRect(x: 10, y: 0, width: 12, height: 32))
    label.text = text
    label.font = Fonts.medium(11)
    label.textColor = Palette.muted
    label.textAlignment = .center
    container.addSubview(label)
    return container
  }
  private func caption(_ text: String) -> UILabel {
    let label = UILabel()
    label.text = text
    label.font = Fonts.medium(11)
    label.textColor = Palette.muted
    label.numberOfLines = 0
    return label
  }
  private func field(_ title: String, _ input: UIView) -> UIStackView {
    let group = UIStackView(arrangedSubviews: [caption(title), input])
    group.axis = .vertical
    group.spacing = 6
    return group
  }
  private func divider() -> UIView {
    let line = hairline()
    line.heightAnchor.constraint(equalToConstant: hairlineWidth).isActive = true
    return line
  }
  private func outline(_ view: UIView) {
    view.backgroundColor = Palette.surface
    view.layer.cornerRadius = 6
    view.layer.borderWidth = 1
    view.layer.borderColor = Palette.border.cgColor
  }
  private func focus(_ view: UIView, _ focused: Bool) {
    view.layer.borderColor = (focused ? Palette.blue : Palette.border).cgColor
    view.layer.borderWidth = focused ? 1.5 : 1
  }
  private func configure(_ field: UITextField, label: String) {
    outline(field)
    field.borderStyle = .none
    field.font = Fonts.regular(13)
    field.textColor = Palette.ink
    field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
    field.leftViewMode = .always
    field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
    field.rightViewMode = .always
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.accessibilityLabel = label
    field.accessibilityIdentifier = "inspector." + label.lowercased().replacingOccurrences(of: " ", with: "-")
    field.heightAnchor.constraint(equalToConstant: 32).isActive = true
    field.addAction(UIAction { [weak self] _ in self?.markDirty() }, for: .editingChanged)
    field.addAction(UIAction { [weak self, weak field] _ in if let field { self?.focus(field, true) } }, for: .editingDidBegin)
    field.addAction(UIAction { [weak self, weak field] _ in if let field { self?.focus(field, false) } }, for: .editingDidEnd)
  }
  private func configure(_ field: UITextView, label: String, height: CGFloat, monospaced: Bool = false) {
    outline(field)
    field.font = monospaced ? Fonts.mono(12) : Fonts.regular(13)
    field.textColor = Palette.ink
    field.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.accessibilityLabel = label
    field.accessibilityIdentifier = "inspector." + label.lowercased().replacingOccurrences(of: " ", with: "-")
    field.heightAnchor.constraint(equalToConstant: height).isActive = true
    field.delegate = self
  }
  func textViewDidBeginEditing(_ textView: UITextView) { focus(textView, true) }
  func textViewDidEndEditing(_ textView: UITextView) { focus(textView, false) }
  func textViewDidChange(_ textView: UITextView) { markDirty() }
  private func style(_ button: UIButton, title: String, primary: Bool = false) {
    var config = primary ? UIButton.Configuration.filled() : .plain()
    config.title = title
    config.cornerStyle = .capsule
    config.baseBackgroundColor = primary ? Palette.ink : Palette.surface
    config.baseForegroundColor = primary ? .white : Palette.ink
    if !primary {
      config.background.backgroundColor = Palette.surface
      config.background.strokeColor = Palette.border
      config.background.strokeWidth = 1
    }
    config.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 14, bottom: 7, trailing: 14)
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = Fonts.medium(13)
      return attributes
    }
    config.titleLineBreakMode = .byTruncatingTail
    button.configuration = config
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 34).isActive = true
    button.accessibilityIdentifier = "inspector." + title.lowercased().replacingOccurrences(of: " ", with: "-")
  }
  private func makeButton(_ title: String, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system)
    style(button, title: title)
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }
  private func codeView(_ label: String, text: String, height: CGFloat) -> UITextView {
    let view = UITextView()
    configure(view, label: label, height: height, monospaced: true)
    view.isEditable = false
    view.delegate = nil
    view.text = text
    view.backgroundColor = rgb(0xFAFAFB)
    return view
  }
  private func markDirty() {
    guard !saving else { return }
    dirty = true
    draftError = nil
    applyButton.isEnabled = true
    duplicateButton.isEnabled = false
    discardButton.isHidden = false
    message.textColor = Palette.muted
    message.text = "Unsaved changes"
  }

  // MARK: Editing

  func update(session: [String: Any], selected: String?) {
    latestSession = session
    latestSelection = selected
    guard !showingAuxiliary, !saving else { return }
    let project = session["project"] as? [String: Any] ?? [:]
    let document = project["document"] as? [String: Any] ?? [:]
    let offline = (document["appPreview"] as? [String: Any])?["offline"] as? Bool == true
    var previewText = offline ? "Offline preview · Local data only. Connected services are unavailable." : ""
    if let selected, let entry = (document["screens"] as? [String: [String: Any]])?[selected],
       let route = (entry["props"] as? [String: Any])?["route"] as? [String: Any] {
      if let step = route["step"] as? [String: Any], let index = step["index"] as? Int, let count = step["count"] as? Int {
        previewText += "\nStep \(index + 1) of \(count) · Independent preview."
      }
    }
    previewLabel.text = previewText.trimmingCharacters(in: .whitespacesAndNewlines)
    previewLabel.isHidden = previewText.isEmpty
    let records = document["screens"] as? [String: [String: Any]] ?? [:]
    if dirty {
      // Keep the preview explanation attached to the draft's screen, too.
      if boundID != selected { previewLabel.isHidden = true }
      if let draftError {
        message.text = draftError
        return
      }
      if boundID != selected { message.text = "Apply or discard this draft before inspecting another screen." }
      else if project["sequence"] as? Int != identity["sequence"] as? Int {
        message.text = "The project changed. Your draft is kept; copy it before discarding."
      }
      return
    }
    guard let selected, let entry = records[selected] else {
      boundID = nil
      heading.text = "Inspector"
      pathLabel.text = "No screen selected"
      editor.isHidden = true
      message.text = "Select a screen to edit its name, fixture props and context."
      return
    }
    editor.isHidden = false
    let changed = boundID != selected || identity["sequence"] as? Int != project["sequence"] as? Int
    guard changed else { return }
    if boundID != selected { scroll.setContentOffset(.zero, animated: false) }
    boundID = selected
    baseline = entry
    identity = ["workspaceId": project["workspaceId"] ?? "", "sequence": project["sequence"] ?? 0]
    heading.text = entry["name"] as? String ?? "Screen"
    pathLabel.text = entry["source"] as? String
    nameField.text = entry["name"] as? String
    positionX.text = String(describing: entry["x"] ?? 0)
    positionY.text = String(describing: entry["y"] ?? 0)
    var editableProps = entry["props"] as? [String: Any] ?? [:]
    if let route = editableProps["route"] as? [String: Any], route["file"] is String { editableProps.removeValue(forKey: "route") }
    let data = try? JSONSerialization.data(withJSONObject: editableProps, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    propsField.text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    notesField.text = entry["notes"] as? String ?? ""
    applyButton.isEnabled = false
    duplicateButton.isEnabled = true
    discardButton.isHidden = true
    message.textColor = Palette.muted
    message.text = "Edits share the project and undo history with your agent."
  }
  private func apply() {
    guard !saving, let id = boundID else { return }
    do {
      guard var props = try JSONSerialization.jsonObject(with: Data(propsField.text.utf8)) as? [String: Any] else {
        throw NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Preview props must be a JSON object."])
      }
      guard let x = Double(positionX.text ?? ""), let y = Double(positionY.text ?? ""), x.isFinite, y.isFinite else {
        throw NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Enter valid X and Y positions."])
      }
      if let route = (baseline["props"] as? [String: Any])?["route"] as? [String: Any], route["file"] is String { props["route"] = route }
      let patch: [String: Any] = ["name": nameField.text ?? "", "x": x, "y": y, "props": props, "notes": notesField.text ?? ""]
      saving = true
      editor.isUserInteractionEnabled = false
      message.text = "Saving…"
      endEditing(true)
      onApply?(identity, id, patch) { [weak self] result in
        guard let self else { return }
        self.saving = false
        self.editor.isUserInteractionEnabled = true
        switch result {
        case .success:
          self.dirty = false
          self.draftError = nil
          self.boundID = nil
          self.update(session: self.latestSession, selected: self.latestSelection)
        case .failure(let error): self.showError(error.localizedDescription)
        }
      }
    } catch { showError(error.localizedDescription) }
  }
  func showError(_ text: String) {
    if dirty { draftError = text }
    message.textColor = Palette.red
    message.text = text
  }
  func showEditor() {
    showingAuxiliary = false
    auxiliary.isHidden = true
    editor.isHidden = false
    if dirty {
      heading.text = baseline["name"] as? String ?? "Screen"
      pathLabel.text = baseline["source"] as? String
    }
    boundID = dirty ? boundID : nil
    update(session: latestSession, selected: latestSelection)
  }

  // MARK: Source and agent setup

  private func showAuxiliary(_ title: String, subtitle: String?) {
    showingAuxiliary = true
    previewLabel.isHidden = true
    heading.text = title
    pathLabel.text = subtitle
    editor.isHidden = true
    auxiliary.isHidden = false
    auxiliary.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let back = makeButton("Back to screen") { [weak self] in self?.showEditor() }
    let row = UIStackView(arrangedSubviews: [back, UIView()])
    row.axis = .horizontal
    auxiliary.addArrangedSubview(row)
    message.textColor = Palette.muted
    message.text = nil
    scroll.setContentOffset(.zero, animated: false)
  }
  func showSource(path: String, code: String, original: Bool = false) {
    showAuxiliary("Component source", subtitle: path)
    auxiliary.addArrangedSubview(codeView("Component source", text: code, height: 520))
    let copy = makeButton("Copy source") { UIPasteboard.general.string = code }
    let row = UIStackView(arrangedSubviews: [copy, UIView()])
    row.axis = .horizontal
    auxiliary.addArrangedSubview(row)
    message.text = original ? "Original app source. Preview edits use a project override; the app changes only when you choose to apply them." : "Your agent edits this same file through the CLI or MCP."
  }
  func showAgentTools(_ config: [String: Any]) {
    showAuxiliary("Connect your agent", subtitle: "MCP and CLI for this project")
    let intro = caption("Your coding agent creates and edits the screens in this window. Add the MCP server to its configuration, or drive the CLI directly.")
    intro.font = Fonts.regular(13)
    intro.textColor = Palette.ink
    auxiliary.addArrangedSubview(intro)
    let data = try? JSONSerialization.data(withJSONObject: ["mcpServers": ["expo-canvas": config]], options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    let args = config["args"] as? [String] ?? []
    let quote: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
    let cli = ([config["command"] as? String ?? "node"] + args.map { $0 == "mcp" ? "read" : $0 }).map(quote).joined(separator: " ")
    auxiliary.addArrangedSubview(field("MCP server", codeView("MCP configuration", text: json, height: 260)))
    let copyMcp = makeButton("Copy MCP configuration") { [weak self] in
      UIPasteboard.general.string = json
      self?.message.text = "MCP configuration copied."
    }
    let mcpRow = UIStackView(arrangedSubviews: [copyMcp, UIView()])
    mcpRow.axis = .horizontal
    auxiliary.addArrangedSubview(mcpRow)
    auxiliary.addArrangedSubview(field("CLI", codeView("CLI command", text: cli, height: 96)))
    let copyCli = makeButton("Copy CLI command") { [weak self] in
      UIPasteboard.general.string = cli
      self?.message.text = "CLI command copied."
    }
    let cliRow = UIStackView(arrangedSubviews: [copyCli, UIView()])
    cliRow.axis = .horizontal
    auxiliary.addArrangedSubview(cliRow)
  }
}

/// A searchable index of the document; selection uses the canvas' shared focus path.
final class CanvasNavigator: UIView, UITableViewDataSource, UITableViewDelegate {
  var onSelect: ((String) -> Void)?
  private let edge = hairline()
  private let title = UILabel()
  private let count = UILabel()
  private let search = UISearchTextField()
  private let table = UITableView(frame: .zero, style: .plain)
  private let empty = UILabel()
  private var order: [String] = []
  private var records: [String: [String: Any]] = [:]
  private var filtered: [String] = []
  private var selected: String?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = Palette.surface
    title.text = "Screens"
    title.font = Fonts.medium(14)
    title.textColor = Palette.ink
    count.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
    count.textColor = Palette.muted
    count.textAlignment = .right
    search.placeholder = "Find a screen"
    search.font = Fonts.regular(13)
    search.backgroundColor = Palette.canvas
    search.layer.cornerRadius = 8
    search.autocorrectionType = .no
    search.autocapitalizationType = .none
    search.accessibilityIdentifier = "canvas.screen-search"
    search.addAction(UIAction { [weak self] _ in self?.filter() }, for: .editingChanged)
    table.backgroundColor = .clear
    table.separatorStyle = .none
    table.rowHeight = 58
    table.dataSource = self
    table.delegate = self
    table.keyboardDismissMode = .onDrag
    table.register(UITableViewCell.self, forCellReuseIdentifier: "screen")
    empty.text = "No matching screens"
    empty.font = Fonts.regular(13)
    empty.textColor = Palette.muted
    empty.textAlignment = .center
    for child in [title, count, search, table, empty, edge] { addSubview(child) }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  override func layoutSubviews() {
    super.layoutSubviews()
    title.frame = CGRect(x: 16, y: 16, width: bounds.width - 80, height: 22)
    count.frame = CGRect(x: bounds.width - 64, y: 16, width: 48, height: 22)
    search.frame = CGRect(x: 12, y: 50, width: bounds.width - 24, height: 34)
    table.frame = CGRect(x: 8, y: 98, width: bounds.width - 16, height: max(0, bounds.height - 106))
    empty.frame = CGRect(x: 12, y: 120, width: bounds.width - 24, height: 40)
    edge.frame = CGRect(x: bounds.width - hairlineWidth, y: 0, width: hairlineWidth, height: bounds.height)
  }
  func update(order: [String], records: [String: [String: Any]], selected: String?) {
    let changed = self.selected != selected
    // Pager variants are appended during import; keep their steps together in navigation.
    let route = { (id: String) in (records[id]?["props"] as? [String: Any])?["route"] as? [String: Any] }
    var listed = Set<String>()
    self.order = []
    for id in order where !listed.contains(id) {
      var group = [id]
      if route(id)?["step"] != nil, let file = route(id)?["file"] as? String {
        group = order.filter { route($0)?["step"] != nil && route($0)?["file"] as? String == file }
        group.sort { ((route($0)?["step"] as? [String: Any])?["index"] as? Int ?? 0) < ((route($1)?["step"] as? [String: Any])?["index"] as? Int ?? 0) }
      }
      for member in group where listed.insert(member).inserted { self.order.append(member) }
    }
    self.records = records
    self.selected = selected
    filter()
    if changed, let selected, let index = filtered.firstIndex(of: selected) {
      table.scrollToRow(at: IndexPath(row: index, section: 0), at: .none, animated: false)
    }
  }
  private func filter() {
    let query = (search.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    filtered = order.filter { id in
      guard let entry = records[id] else { return false }
      return query.isEmpty || ["name", "key", "source"].contains { (entry[$0] as? String ?? "").localizedCaseInsensitiveContains(query) }
    }
    count.text = query.isEmpty ? "\(order.count)" : "\(filtered.count)/\(order.count)"
    empty.text = order.isEmpty ? "Your screens will appear here" : "No matching screens"
    empty.isHidden = !filtered.isEmpty
    table.reloadData()
  }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filtered.count }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "screen", for: indexPath)
    let id = filtered[indexPath.row]
    let entry = records[id] ?? [:]
    let active = selected == id
    let route = (entry["props"] as? [String: Any])?["route"] as? [String: Any]
    let step = route?["step"] as? [String: Any]
    var content = cell.defaultContentConfiguration()
    content.text = entry["name"] as? String ?? "Screen"
    content.textProperties.font = Fonts.medium(13)
    content.textProperties.color = active ? Palette.blue : Palette.ink
    content.textProperties.numberOfLines = 1
    content.secondaryText = step.flatMap { step in
      guard let index = step["index"] as? Int, let count = step["count"] as? Int else { return nil }
      return "Step \(index + 1) of \(count)"
    } ?? (entry["key"] as? String)
    content.secondaryTextProperties.font = Fonts.regular(11)
    content.secondaryTextProperties.color = active ? Palette.blue : Palette.muted
    content.secondaryTextProperties.numberOfLines = 1
    content.image = UIImage(systemName: step == nil ? "iphone" : "rectangle.stack", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .regular))
    content.imageProperties.tintColor = active ? Palette.blue : Palette.muted
    content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 8)
    content.imageToTextPadding = 10
    cell.contentConfiguration = content
    var background = UIBackgroundConfiguration.clear()
    background.backgroundColor = active ? Palette.blueTint : .clear
    background.cornerRadius = 8
    background.backgroundInsets = NSDirectionalEdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0)
    cell.backgroundConfiguration = background
    cell.accessibilityIdentifier = "canvas.screen.\(entry["key"] as? String ?? id)"
    cell.accessibilityTraits = active ? [.button, .selected] : .button
    cell.interactions.filter { $0 is UIToolTipInteraction }.forEach { cell.removeInteraction($0) }
    cell.addInteraction(UIToolTipInteraction(defaultToolTip: "\(entry["name"] as? String ?? "Screen")\n\(entry["source"] as? String ?? "")"))
    return cell
  }
  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    endEditing(true)
    onSelect?(filtered[indexPath.row])
  }
}
