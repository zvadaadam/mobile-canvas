import Foundation

/// Arbitrary app props stay JSON. The canvas envelope itself has a typed contract.
nonisolated indirect enum CanvasJSON: Codable, Equatable, Sendable {
  case null, bool(Bool), number(Double), string(String), array([CanvasJSON]), object([String: CanvasJSON])

  init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() { self = .null }
    else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
    else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
    else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
    else if let decoded = try? value.decode([CanvasJSON].self) { self = .array(decoded) }
    else { self = .object(try value.decode([String: CanvasJSON].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .null: try value.encodeNil()
    case .bool(let decoded): try value.encode(decoded)
    case .number(let decoded): try value.encode(decoded)
    case .string(let decoded): try value.encode(decoded)
    case .array(let decoded): try value.encode(decoded)
    case .object(let decoded): try value.encode(decoded)
    }
  }

  /// Compatibility boundary for renderer integrations and the arbitrary-props editor.
  var foundation: Any {
    switch self {
    case .null: return NSNull()
    case .bool(let value): return value
    case .number(let value): return NSNumber(value: value)
    case .string(let value): return value
    case .array(let value): return value.map(\.foundation)
    case .object(let value): return value.mapValues(\.foundation)
    }
  }
}

nonisolated enum CanvasProtocolError: LocalizedError {
  case invalid(String)
  var errorDescription: String? {
    switch self { case .invalid(let message): return "Invalid canvas response · \(message)" }
  }
}

nonisolated struct CanvasScreenRecord: Decodable, Sendable {
  nonisolated struct Insets: Decodable, Sendable {
    let top: Double
    let left: Double
    let bottom: Double
    let right: Double
  }
  let id: String
  let key: String
  let name: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let links: [String]
  let source: String
  let exportName: String
  let notes: String
  let props: [String: CanvasJSON]
  let insets: Insets?
  let raw: [String: CanvasJSON]

  private enum CodingKeys: String, CodingKey { case id, key, name, x, y, width, height, links, source, exportName, notes, props, insets }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    key = try values.decode(String.self, forKey: .key)
    name = try values.decode(String.self, forKey: .name)
    x = try values.decode(Double.self, forKey: .x)
    y = try values.decode(Double.self, forKey: .y)
    width = try values.decode(Double.self, forKey: .width)
    height = try values.decode(Double.self, forKey: .height)
    links = try values.decode([String].self, forKey: .links)
    source = try values.decode(String.self, forKey: .source)
    exportName = try values.decode(String.self, forKey: .exportName)
    notes = try values.decode(String.self, forKey: .notes)
    props = try values.decode([String: CanvasJSON].self, forKey: .props)
    insets = try values.decodeIfPresent(Insets.self, forKey: .insets)
    raw = try decoder.singleValueContainer().decode([String: CanvasJSON].self)
    guard !id.isEmpty, !key.isEmpty, !name.isEmpty,
      x.isFinite, y.isFinite, width.isFinite, height.isFinite,
      abs(x) <= 1_000_000, abs(y) <= 1_000_000,
      (180...2000).contains(width), (240...3000).contains(height) else {
      throw CanvasProtocolError.invalid("Screen identity or geometry is invalid.")
    }
    if let insets, ![insets.top, insets.left, insets.bottom, insets.right].allSatisfy({ $0.isFinite && (0...300).contains($0) }) {
      throw CanvasProtocolError.invalid("Screen safe-area insets are invalid.")
    }
  }
}

nonisolated struct CanvasSessionSnapshot: Decodable, Sendable {
  nonisolated struct Document: Decodable, Sendable {
    let name: String
    let screenIds: [String]
    let screens: [String: CanvasScreenRecord]
  }
  nonisolated struct Project: Decodable, Sendable {
    let workspaceId: String
    let sequence: Int
    let document: Document
  }
  let project: Project
  let codeVersion: String
  let selection: [String]
  let raw: [String: CanvasJSON]

  private enum CodingKeys: String, CodingKey { case project, codeVersion, selection }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    project = try values.decode(Project.self, forKey: .project)
    codeVersion = try values.decode(String.self, forKey: .codeVersion)
    selection = try values.decode([String].self, forKey: .selection)
    raw = try decoder.singleValueContainer().decode([String: CanvasJSON].self)
    let document = project.document
    let ids = Set(document.screenIds)
    guard UUID(uuidString: project.workspaceId) != nil, project.sequence >= 0,
      ids.count == document.screenIds.count, ids == Set(document.screens.keys),
      document.screens.allSatisfy({ $0.key == $0.value.id }),
      Set(document.screens.values.map(\.key)).count == ids.count,
      selection.allSatisfy({ ids.contains($0) }) else {
      throw CanvasProtocolError.invalid("Project identity, screen order or selection is invalid.")
    }
  }
}

nonisolated struct CanvasMutationReceipt: Decodable, Sendable {
  let session: CanvasSessionSnapshot
  let created: [String: String]?
}

nonisolated struct CanvasHostCommand: Decodable, Sendable {
  enum Action: Sendable {
    case focus(screen: String, from: String?)
    case fit, stop
    case capture(screen: String?)
    case zoom(scale: Double, screen: String?)
  }
  let id: Int
  let action: Action
  private enum CodingKeys: String, CodingKey { case id, type, screenId, from, scale }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(Int.self, forKey: .id)
    guard id > 0 else { throw CanvasProtocolError.invalid("Command identity must be positive.") }
    let screen = try values.decodeIfPresent(String.self, forKey: .screenId)
    switch try values.decode(String.self, forKey: .type) {
    case "focus":
      guard let screen, !screen.isEmpty else { throw CanvasProtocolError.invalid("Focus needs a screen.") }
      action = .focus(screen: screen, from: try values.decodeIfPresent(String.self, forKey: .from))
    case "fit": action = .fit
    case "stop": action = .stop
    case "capture": action = .capture(screen: screen)
    case "zoom":
      let scale = try values.decode(Double.self, forKey: .scale)
      guard scale.isFinite, (0.1...1.5).contains(scale) else { throw CanvasProtocolError.invalid("Zoom is outside the canvas range.") }
      action = .zoom(scale: scale, screen: screen)
    default: throw CanvasProtocolError.invalid("Unrecognized host command. Reopen with a matching runtime.")
    }
  }
}

nonisolated struct CanvasHostReceipt: Decodable, Sendable {
  nonisolated struct Inspection: Decodable, Sendable {
    let screenId: String
    let expiresAt: Double
    let status: String
  }
  let phase: String
  let readyCount: Int
  let waitingCount: Int
  let needsStateCount: Int
  let screenErrorCount: Int
  let error: String?
  let inspection: Inspection?
  let command: CanvasHostCommand?
}
