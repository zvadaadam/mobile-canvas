import SwiftUI
import UIKit

@main struct RecipeLabApp: App {
  var body: some Scene {
    WindowGroup { RecipeDemo() }
  }
}

struct LocalRecord { let title: String; let details: String }

@Observable @MainActor final class RecordModel {
  private(set) var records: [LocalRecord] = []
  func load() async {
    try? await Task.sleep(for: .milliseconds(100))
    records = [LocalRecord(title: "Loaded locally", details: "This detail came from the parent's asynchronous preview state.")]
  }
}

struct RecipeDemo: View {
  @State private var model = RecordModel()
  var body: some View {
    NavigationStack {
      List {
        ForEach(model.records, id: \.title) { record in
          NavigationLink("Open record") { RecordScreen(model: model, record: record) }
        }
        NavigationLink("Service settings") { ServiceScreen(client: PreviewSettingsClient()) }
        NavigationLink("Native control") { NativeControlForm() }
      }.navigationTitle("Automatic recipe lab")
    }.task { await model.load() }
  }
}

struct RecordScreen: View {
  let model: RecordModel
  let record: LocalRecord
  @State private var enabled = false
  var body: some View {
    Form {
      Text(record.title).accessibilityIdentifier("recipe.record")
      Text(record.details)
      Toggle("Independent state", isOn: $enabled)
      NavigationLink("Open nested detail") { RecordDetail(record: record) }
    }.navigationTitle("Record")
  }
}

struct RecordDetail: View {
  let record: LocalRecord
  var body: some View { Text(record.details).padding().navigationTitle("Nested detail") }
}

@MainActor protocol SettingsServing { func load() async -> String }
struct ProductionSettingsClient: SettingsServing { func load() async -> String { "Production default" } }
struct PreviewSettingsClient: SettingsServing { func load() async -> String { "App-local preview service" } }
struct ServiceScreen: View {
  let client: any SettingsServing
  @State private var message = "Loading"
  init(client: any SettingsServing = ProductionSettingsClient()) { self.client = client }
  var body: some View {
    Text(message).padding().navigationTitle("Settings").task { message = await client.load() }
  }
}

struct NativeLabel: UIViewRepresentable {
  func makeUIView(context: Context) -> UILabel {
    let label = UILabel()
    label.text = "Actual UIKit label"
    label.textAlignment = .center
    return label
  }
  func updateUIView(_ view: UILabel, context: Context) {}
}
struct NativeControlForm: View {
  var body: some View { NativeLabel().frame(height: 60).navigationTitle("Native control") }
}
