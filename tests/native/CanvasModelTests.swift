import Foundation
import CoreGraphics

private enum TestFailure: Error { case failed(String) }
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw TestFailure.failed(message) }
}

@main
struct CanvasModelTests {
  @MainActor static func main() async throws {
    let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let initial = try JSONDecoder().decode(CanvasSessionSnapshot.self, from: fixture)
    let ids = initial.project.document.screenIds
    func snapshot(sequence: Int, selection: [String], workspace: String? = nil) throws -> CanvasSessionSnapshot {
      var raw = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
      var project = raw["project"] as! [String: Any]
      project["sequence"] = sequence
      if let workspace { project["workspaceId"] = workspace }
      raw["project"] = project
      raw["selection"] = selection
      return try JSONDecoder().decode(CanvasSessionSnapshot.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    func rejectSession(_ edit: (inout [String: Any]) -> Void) throws {
      var raw = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
      edit(&raw)
      let result = Result { try JSONDecoder().decode(CanvasSessionSnapshot.self, from: JSONSerialization.data(withJSONObject: raw)) }
      if case .success = result { throw TestFailure.failed("Malformed session was accepted") }
    }
    try rejectSession { $0.removeValue(forKey: "codeVersion") }
    try rejectSession {
      var project = $0["project"] as! [String: Any]
      var document = project["document"] as! [String: Any]
      document["screenIds"] = [ids[0], ids[0], ids[2]]
      project["document"] = document; $0["project"] = project
    }
    try rejectSession {
      var project = $0["project"] as! [String: Any]
      var document = project["document"] as! [String: Any]
      var screens = document["screens"] as! [String: [String: Any]]
      screens[ids[0]]!["height"] = -100
      document["screens"] = screens; project["document"] = document; $0["project"] = project
    }
    let props = initial.project.document.screens[ids[0]]!.raw["props"]!
    try expect(props == .object(["enabled": .bool(false), "count": .number(0), "nested": .array([.null, .string("value")])]), "Props changed at the Swift boundary")
    let roundTrip = try JSONDecoder().decode(CanvasJSON.self, from: JSONEncoder().encode(props))
    try expect(roundTrip == props, "JSON round trip changed app data")
    try expect(initial.raw["project"]?.foundation is [String: Any], "Inspector lost its project envelope")
    let bridgedProject = initial.raw["project"]!.foundation as! [String: Any]
    try expect(bridgedProject["sequence"] as? Int == initial.project.sequence, "JSON integers lost their Foundation bridge")

    var state = CanvasSessionState()
    try state.accept(initial, read: state.readToken)
    let beforeClick = state.readToken
    let first = state.select(ids[1])!
    try state.accept(snapshot(sequence: 2, selection: [ids[0]]), read: beforeClick)
    try expect(state.selectedId == ids[1], "A pre-click poll undid local focus")
    let duringClick = state.readToken
    let latest = state.select(ids[2])!
    state.finishSelection(first)
    try expect(state.selectionPending, "Old selection completion cleared a newer request")
    state.finishSelection(latest)
    try state.accept(snapshot(sequence: 2, selection: [ids[1]]), read: duringClick)
    try expect(state.selectedId == ids[2], "A pending-selection poll undid focus after completion")
    let stale = try state.accept(snapshot(sequence: 1, selection: [ids[0]]), read: state.readToken)
    try expect(!stale && state.sequence == 2, "An old read rolled back the document")
    try state.accept(snapshot(sequence: 2, selection: [ids[0]]), read: state.readToken)
    try expect(state.selectedId == ids[0], "A fresh agent selection did not reach the UI")
    let mismatch = Result { try state.accept(snapshot(sequence: 3, selection: [], workspace: UUID().uuidString)) }
    if case .success = mismatch { throw TestFailure.failed("Another workspace replaced the canvas") }
    try expect(state.sequence == 2, "Rejected identity changed the current state")
    print("PASS typed session, dynamic props, stale reads and selection races")

    for malformed in [#"{"id":1,"type":"focus"}"#, #"{"id":1,"type":"zoom","scale":-1}"#,
      #"{"id":0,"type":"fit"}"#, #"{"id":1,"type":"unknown"}"#] {
      if case .success = Result(catching: { try JSONDecoder().decode(CanvasHostCommand.self, from: Data(malformed.utf8)) }) {
        throw TestFailure.failed("Malformed host command was accepted")
      }
    }
    let command = try JSONDecoder().decode(CanvasHostCommand.self, from: Data(#"{"id":2,"type":"focus","screenId":"home","from":"intro"}"#.utf8))
    guard case .focus(let screen, let from) = command.action, screen == "home", from == "intro" else { throw TestFailure.failed("Focus lost its flow source") }
    print("PASS typed host commands")

    let phone = CGRect(x: 500, y: 300, width: 402, height: 874)
    let target = CanvasViewport.focus(frame: phone, viewport: CGSize(width: 800, height: 800), toolsClearance: 64)!
    try expect(target.scale * phone.height <= 800 - 112 - 64, "Focused phone is clipped by canvas chrome")
    try expect(target.center.x == phone.midX, "Focus did not center the selected frame")
    try expect(CanvasViewport.focus(frame: phone, viewport: .zero, toolsClearance: 64) == nil, "Focus consumed a pre-layout viewport")
    let start = CanvasViewport.Position(scale: 1, center: .zero)
    let end = CanvasViewport.interpolate(from: start, to: target, progress: 1)
    try expect(end.scale == target.scale && end.center == target.center, "Animation missed its target")
    try expect(CanvasViewport.clamp(.nan) == 1 && CanvasViewport.clamp(100) == 1.5, "Invalid zoom escaped the camera limits")
    print("PASS focus geometry and camera interpolation")

    for address in ["https://127.0.0.1:1234", "http://localhost:1234", "http://127.0.0.1:1234@evil.test", "http://127.0.0.1:1234/path"] {
      try expect(CanvasRuntimeClient.loopbackURL(URL(string: address)) == nil, "Non-runtime URL accepted")
    }
    let client = CanvasRuntimeClient(url: URL(string: CommandLine.arguments[2]))
    let model = CanvasSession(client: client)
    try model.accept(initial)
    var errors = 0
    var changes = 0
    model.onError = { _ in errors += 1 }
    model.onChange = { _ in changes += 1 }
    model.refresh()
    try await wait { errors == 1 }
    try expect(model.state.snapshot?.project.workspaceId == initial.project.workspaceId, "Disconnect discarded the loaded session")
    model.refresh()
    try await wait { changes == 1 }
    model.select(ids[0]); model.select(ids[1]); model.select(ids[2])
    try await wait { !model.state.selectionPending }
    model.refresh()
    try await wait { changes == 2 }
    try expect(model.state.selectedId == ids[2], "Server selection was reordered")

    let malformed: Result<CanvasSessionSnapshot, Error> = await receive(client, "malformed", CanvasSessionSnapshot.self)
    if case .success = malformed { throw TestFailure.failed("Malformed JSON looked like a successful request") }
    let invalid = CanvasRuntimeClient(url: nil)
    let unavailable: Result<CanvasSessionSnapshot, Error> = await receive(invalid, "session", CanvasSessionSnapshot.self)
    if case .success = unavailable { throw TestFailure.failed("Missing runtime did not fail") }
    var cancelledCallback = false
    client.request("slow") { _ in cancelledCallback = true }
    try await Task.sleep(for: .milliseconds(50))
    client.cancelAll()
    try await Task.sleep(for: .milliseconds(350))
    try expect(!cancelledCallback, "Cancelled request updated a disposed client")
    print("PASS HTTP errors, reconnect, serialized selection and cancellation")
  }

  @MainActor private static func wait(_ predicate: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(5)
    while !predicate() {
      if Date() > deadline { throw TestFailure.failed("Timed out waiting for native connection") }
      try await Task.sleep(for: .milliseconds(10))
    }
  }

  @MainActor private static func receive<T: Decodable & Sendable>(_ client: CanvasRuntimeClient, _ path: String, _ type: T.Type) async -> Result<T, Error> {
    await withCheckedContinuation { continuation in
      client.request(path, as: type) { continuation.resume(returning: $0) }
    }
  }
}
