import SwiftUI
import CoreMotion

@main struct ContextLabApp: App {
  init() { LocalConfiguration.shared.configure() }
  var body: some Scene { WindowGroup { ContextHome() } }
}

@Observable @MainActor final class LocalConfiguration {
  static let shared = LocalConfiguration()
  var title = "Startup has not run"
  func configure() { title = "Original app startup ran" }
}

@Observable final class ExampleStore {
  let title: String
  init(title: String) { self.title = title }
}

struct ContextHome: View {
  private let motion = CMMotionManager()
  var body: some View {
    NavigationStack {
      Form {
        Text(LocalConfiguration.shared.title)
        LabeledContent("Device motion", value: motion.isDeviceMotionAvailable ? "Available" : "Unavailable")
        NavigationLink("Provider example") { ExampleDetail() }
      }.navigationTitle("Application context")
    }.environment(ExampleStore(title: "App-authored sample"))
  }
}

struct ExampleDetail: View {
  @Environment(ExampleStore.self) private var store
  var body: some View {
    VStack(spacing: 24) {
      Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
      Text(store.title).font(.title2)
      Text(LocalConfiguration.shared.title)
    }.padding()
  }
}

#Preview("Missing provider") { ExampleDetail() }
#Preview("Authored provider") { ExampleDetail().environment(ExampleStore(title: "App-authored sample")) }
