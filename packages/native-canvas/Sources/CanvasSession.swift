import Foundation

/// The runtime owns document state. This model owns a native projection and the
/// user's optimistic selection, without any views, networking or undo logic.
nonisolated struct CanvasSessionState {
  struct ReadToken { let generation: Int; let selectionPending: Bool }
  private(set) var snapshot: CanvasSessionSnapshot?
  private(set) var selectedId: String?
  private(set) var selectionPending = false
  private var generation = 0

  var readToken: ReadToken { ReadToken(generation: generation, selectionPending: selectionPending) }
  var workspaceId: String { snapshot?.project.workspaceId ?? "" }
  var sequence: Int { snapshot?.project.sequence ?? 0 }

  @discardableResult
  mutating func accept(_ next: CanvasSessionSnapshot, read: ReadToken? = nil) throws -> Bool {
    if !workspaceId.isEmpty && workspaceId != next.project.workspaceId {
      throw CanvasProtocolError.invalid("Project identity changed. Reopen the canvas.")
    }
    guard next.project.sequence >= sequence else { return false }
    snapshot = next
    if let read, !read.selectionPending, !selectionPending, read.generation == generation {
      selectedId = next.selection.first
    }
    if let selectedId, next.project.document.screens[selectedId] == nil { self.selectedId = nil }
    return true
  }

  mutating func select(_ id: String) -> Int? {
    guard snapshot?.project.document.screens[id] != nil else { return nil }
    selectedId = id
    generation += 1
    selectionPending = true
    return generation
  }

  mutating func finishSelection(_ token: Int) {
    guard token == generation else { return }
    selectionPending = false
    generation += 1
  }
}

/// Owns polling and selection request ordering. A disconnect retains mounted
/// content; the next successful read reconciles it. Document mutations stay in
/// the runtime's canonical executor.
@MainActor
final class CanvasSession {
  let client: CanvasRuntimeClient
  private(set) var state = CanvasSessionState()
  private(set) var dictionary: [String: Any] = [:]
  private(set) var entries: [String: [String: Any]] = [:]
  var onChange: ((_ contentChanged: Bool) -> Void)?
  var onError: ((Error) -> Void)?
  private var poll: Timer?
  private var fetching = false
  private var selecting = false
  private var queuedSelection: (id: String, token: Int)?

  init(client: CanvasRuntimeClient) { self.client = client }
  isolated deinit { poll?.invalidate() }

  func start() {
    guard poll == nil, client.baseURL != nil else { return }
    refresh()
    let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    RunLoop.main.add(timer, forMode: .common)
    poll = timer
  }

  func refresh() {
    guard !fetching, client.baseURL != nil else { return }
    fetching = true
    let read = state.readToken
    client.request("session", as: CanvasSessionSnapshot.self) { [weak self] result in
      guard let self else { return }
      self.fetching = false
      do { try self.accept(result.get(), read: read) }
      catch { self.onError?(error) }
    }
  }

  func accept(_ snapshot: CanvasSessionSnapshot, read: CanvasSessionState.ReadToken? = nil) throws {
    let previous = state.snapshot
    let previousSelection = state.selectedId
    guard try state.accept(snapshot, read: read) else { return }
    dictionary = snapshot.raw.mapValues(\.foundation)
    entries = snapshot.project.document.screens.mapValues { $0.raw.mapValues(\.foundation) }
    onChange?(previous?.project.sequence != snapshot.project.sequence || previous?.codeVersion != snapshot.codeVersion || previousSelection != state.selectedId)
  }

  func select(_ id: String) {
    guard let token = state.select(id) else { return }
    queuedSelection = (id, token)
    sendSelection()
  }

  private func sendSelection() {
    guard !selecting, let next = queuedSelection else { return }
    queuedSelection = nil
    selecting = true
    client.request("selection", body: ["workspaceId": state.workspaceId, "ids": [next.id]]) { [weak self] result in
      guard let self else { return }
      self.selecting = false
      self.state.finishSelection(next.token)
      if case .failure(let error) = result { self.onError?(error) }
      // Keep only the latest requested focus, but never let concurrent writes
      // reach the runtime in the opposite order from the user's clicks.
      self.sendSelection()
    }
  }
}
