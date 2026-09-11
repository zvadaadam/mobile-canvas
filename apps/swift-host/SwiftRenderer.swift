import UIKit
import SwiftUI
import Observation

@main
final class CanvasSwiftAppDelegate: UIResponder, UIApplicationDelegate, CanvasApplicationDelegate {
  let canvasRenderer: CanvasRendering = SwiftCanvasRenderer()
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    CanvasPreviewMail.install()
    CanvasSwiftRegistry.initializeApplication()
    return true
  }
}

/// Per-frame preview inputs and explicit navigation. Application services are not replaced.
@Observable @MainActor
final class CanvasPreviewContext {
  var props: [String: Any]
  var bounds: CGRect
  var state: [String: Any] = [:]
  var navigation: String?
  init(props: [String: Any], bounds: CGRect? = nil) { self.props = props; self.bounds = bounds ?? UIScreen.main.bounds }
  convenience init(entry: [String: Any]) {
    self.init(props: entry["props"] as? [String: Any] ?? [:], bounds: Self.frameBounds(entry))
  }
  static func frameBounds(_ entry: [String: Any]) -> CGRect {
    CGRect(x: 0, y: 0, width: (entry["width"] as? NSNumber)?.doubleValue ?? 402,
      height: (entry["height"] as? NSNumber)?.doubleValue ?? 874)
  }
  func navigate(_ key: String) { navigation = key }
}

private struct CanvasProjectionKey: EnvironmentKey {
  static let defaultValue: [String] = []
}
extension EnvironmentValues {
  var canvasProjection: [String] {
    get { self[CanvasProjectionKey.self] }
    set { self[CanvasProjectionKey.self] = newValue }
  }
}

private struct CanvasPreviewEnvironmentKey: EnvironmentKey {
  static let defaultValue: CanvasPreviewContext? = nil
}
extension EnvironmentValues {
  var canvasPreview: CanvasPreviewContext? {
    get { self[CanvasPreviewEnvironmentKey.self] }
    set { self[CanvasPreviewEnvironmentKey.self] = newValue }
  }
}

/// A page keeps its real parent UI; navigation selects another canvas frame.
struct CanvasSceneSelection<Value: Equatable>: ViewModifier {
  let id: String
  let selection: Binding<Value>
  let values: [String: Value]
  @Environment(\.canvasPreview) private var context
  @State private var prepared = false
  private var scene: [String: Any]? {
    let scene = (context?.props["native"] as? [String: Any])?["scene"] as? [String: Any]
    return scene?["id"] as? String == id ? scene : nil
  }
  func body(content: Content) -> some View {
    if let scene, let key = scene["value"] as? String, let expected = values[key] {
      Group {
        if prepared { content }
        else {
          Color.clear.onAppear {
            selection.wrappedValue = expected
            context?.state["scene"] = ["id": id, "value": key]
            prepared = true
          }
        }
      }.onChange(of: selection.wrappedValue) { _, next in
        guard prepared, next != expected else { return }
        if let value = values.first(where: { $0.value == next })?.key,
           let destination = (scene["destinations"] as? [String: String])?[value] {
          context?.navigate(destination)
        }
        selection.wrappedValue = expected
      }
    } else { content }
  }
}

@MainActor
enum CanvasPreviewHost {
  static func unavailable(context: CanvasPreviewContext, issue: String) -> UIViewController {
    context.state["recipeMissing"] = issue
    return UIHostingController(rootView: UnavailableSwiftPreview(context: context, issue: issue))
  }
  static func make<V: View>(_ view: V, context: CanvasPreviewContext) -> UIViewController {
    UIHostingController(rootView: view.environment(\.canvasPreview, context)
      .environment(\.openURL, OpenURLAction { url in
        // Retain only the scheme: email addresses, query strings and tokens
        // do not belong in preview receipts.
        context.state["externalAction"] = ["status": "blocked", "scheme": url.scheme ?? "unknown",
          "reason": "Opening another app is disabled in canvas previews."]
        return .discarded
      }))
  }
  static func make(_ controller: UIViewController, context: CanvasPreviewContext) -> UIViewController { controller }
}

@MainActor
private final class SwiftFrameContainer: UIViewController {
  private var content: UIViewController?
  func install(_ next: UIViewController) {
    if let old = content {
      old.dismiss(animated: false)
      old.willMove(toParent: nil)
      old.view.removeFromSuperview()
      old.removeFromParent()
    }
    content = next
    addChild(next)
    next.view.frame = view.bounds
    next.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(next.view)
    next.didMove(toParent: self)
  }
}

nonisolated private struct SwiftFrameReceipt: Decodable, Sendable {
  nonisolated struct Command: Decodable, Sendable {
    nonisolated enum Kind: String, Decodable, Sendable { case reset }
    let id: Int
    let type: Kind
  }
  let accepted: Bool
  let command: Command?
}

@MainActor
private final class SwiftFrameSession {
  let container = SwiftFrameContainer()
  private let request: CanvasFrameRequest
  private let client: CanvasRuntimeClient
  private var entry: [String: Any]
  private var context: CanvasPreviewContext
  private var codeVersion: String
  private var timer: Timer?
  private var acknowledged = 0
  private var reporting = false
  private let mountedAt = Date().timeIntervalSince1970 * 1000
  private var issue: String?
  init(_ request: CanvasFrameRequest) {
    self.request = request
    client = CanvasRuntimeClient(url: request.runtime)
    entry = request.entry
    codeVersion = request.codeVersion
    context = CanvasPreviewContext(entry: request.entry)
    mount()
    timer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.report() }
    }
  }
  func update(_ entry: [String: Any], _ version: String) {
    codeVersion = version
    let props = entry["props"] as? [String: Any] ?? [:]
    self.entry = entry
    if !NSDictionary(dictionary: props).isEqual(to: context.props) {
      context = CanvasPreviewContext(entry: entry)
      mount()
    } else if context.bounds != CanvasPreviewContext.frameBounds(entry) {
      context.bounds = CanvasPreviewContext.frameBounds(entry)
    }
  }
  func dispose() { timer?.invalidate(); timer = nil; client.cancelAll(); container.dismiss(animated: false) }
  private func mount() {
    let native = context.props["native"] as? [String: Any] ?? [:]
    issue = native["issue"] as? String
    if issue == nil, let factory = native["factory"] as? String, let make = CanvasSwiftRegistry.factories[factory] {
      container.install(make(context))
    } else {
      issue = issue ?? "This preview factory is not in the current build. Rebuild the canvas."
      container.install(UIHostingController(rootView: UnavailableSwiftPreview(context: context, issue: issue ?? "")))
    }
  }
  private func report() {
    guard !reporting else { return }
    reporting = true
    let navigation = context.navigation
    var state = context.state
    let dataIssue = issue ?? context.state["recipeMissing"] as? String
    state["nativePreview"] = ["status": dataIssue == nil ? "mounted" : "unavailable", "issue": dataIssue as Any? ?? NSNull(), "recipe": (context.props["native"] as? [String: Any])?["recipe"] ?? NSNull()]
    let payload: [String: Any] = ["kind": "screen", "workspaceId": request.workspaceId, "hostId": request.hostId,
      "screenId": request.id, "acknowledged": acknowledged, "codeVersion": codeVersion,
      "nativeVersion": CanvasSwiftRegistry.nativeVersion, "mountedAt": mountedAt,
      "state": state, "navigation": navigation as Any? ?? NSNull(), "error": NSNull()]
    client.request("studio/report", body: payload, as: SwiftFrameReceipt.self) { [weak self] result in
      guard let self else { return }
      self.reporting = false
      guard case .success(let response) = result, response.accepted else { return }
      if self.context.navigation == navigation { self.context.navigation = nil }
      if let command = response.command, command.id > self.acknowledged {
        self.acknowledged = command.id
        self.context = CanvasPreviewContext(entry: self.entry)
        self.mount()
      }
    }
  }
}

@MainActor
final class SwiftCanvasRenderer: CanvasRendering {
  let name = "Swift native"
  let maximumScreens = 128
  func makeFrame(_ request: CanvasFrameRequest) -> CanvasRenderedFrame {
    let session = SwiftFrameSession(request)
    return CanvasRenderedFrame(controller: session.container, resources: [session],
      update: { [weak session] entry, version in session?.update(entry, version) },
      dispose: { [weak session] in session?.dispose() })
  }
}


/// Decorative shapes hint at a missing design without impersonating app content.
private struct UnavailableSwiftPreview: View {
  let context: CanvasPreviewContext
  let issue: String
  var body: some View {
    let native = context.props["native"] as? [String: Any] ?? [:]
    let requirements = native["requirements"] as? [String] ?? []
    let destinations = native["destinations"] as? [[String: String]] ?? []
    let needsBuild = (native["blocker"] as? [String: String])?["kind"] == "build-integration"
    let needsStartup = (native["blocker"] as? [String: String])?["kind"] == "app-startup"
    ZStack {
      Color(uiColor: .systemGroupedBackground)
      VStack(alignment: .leading, spacing: 22) {
        RoundedRectangle(cornerRadius: 14).fill(.gray.opacity(0.12)).frame(width: 150, height: 28)
        RoundedRectangle(cornerRadius: 24).fill(.gray.opacity(0.1)).frame(height: 180)
        ForEach(0..<3) { _ in RoundedRectangle(cornerRadius: 12).fill(.gray.opacity(0.1)).frame(height: 52) }
        Spacer()
      }.padding(28).padding(.top, 80).blur(radius: 5)
      VStack(spacing: 16) {
        Image(systemName: "rectangle.dashed").font(.system(size: 30, weight: .light)).foregroundStyle(.secondary)
        Text(needsBuild ? "Native build support needed" : needsStartup ? "App service setup needed" : "Preview data needed").font(.headline)
        Text(native["symbol"] as? String ?? "Swift preview").font(.subheadline).foregroundStyle(.secondary)
        Text(issue).font(.system(size: 14)).multilineTextAlignment(.center).foregroundStyle(.secondary)
        if !requirements.isEmpty {
          if needsBuild {
            ScrollView {
              Text(requirements.joined(separator: "\n\n"))
                .font(.system(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(height: 150)
          } else {
            Text(requirements.prefix(4).joined(separator: "\n"))
              .font(.system(size: 12, design: .monospaced)).foregroundStyle(.secondary).multilineTextAlignment(.center)
          }
        }
        if !destinations.isEmpty {
          Divider().padding(.vertical, 4)
          Text("DESTINATIONS IN SOURCE").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
          ScrollView {
            VStack(spacing: 8) {
              ForEach(Array(destinations.enumerated()), id: \.offset) { _, destination in
                Button { context.navigate(destination["key"] ?? "") } label: {
                  HStack { Text(destination["name"] ?? "Screen").lineLimit(1); Spacer(); Image(systemName: "arrow.up.right") }
                    .font(.system(size: 13)).padding(.vertical, 5)
                }.tint(.secondary)
              }
            }
          }.frame(height: min(CGFloat(destinations.count) * 34, 210))
        }
      }.padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.gray.opacity(0.12), lineWidth: 0.5)).padding(24)
    }
  }
}


struct CanvasRecipeUnavailable: View {
  let message: String
  @Environment(\.canvasPreview) private var context
  init(_ message: String) { self.message = message }
  var body: some View {
    ContentUnavailableView("Local example needed", systemImage: "tray", description: Text(message))
      .onAppear { context?.state["recipeMissing"] = message }
      .onDisappear { context?.state.removeValue(forKey: "recipeMissing") }
  }
}
