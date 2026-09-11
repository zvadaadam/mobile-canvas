import SwiftUI
import UIKit

struct CounterScreen: View {
  @State private var count = 0
  @State private var name = ""
  @State private var enabled = true
  @State private var sheet = false
  @Environment(\.canvasPreview) private var canvas

  var body: some View {
    NavigationStack {
      Form {
        Section("Independent frame state") {
          Text("Counter: \(count)").accessibilityIdentifier("counter.value")
          Button("Increment") { count += 1 }
          TextField("Your name", text: $name)
          Toggle("Notifications", isOn: $enabled)
        }
        Section("Native presentation") {
          Button("Show sheet") { sheet = true }
          Button("Open details on canvas") { canvas?.navigate("details") }
        }
        Section("Fixture inputs") {
          Text(canvas?.props["message"] as? String ?? "Original Swift source")
        }
      }
      .navigationTitle("Preview lab")
      .sheet(isPresented: $sheet) { SheetContent() }
      .onAppear { canvas?.state["count"] = count }
      .onChange(of: count) { _, value in canvas?.state["count"] = value }
      .onChange(of: name) { _, value in canvas?.state["name"] = value }
    }
  }
}

struct SheetContent: View {
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      List {
        Label("A real native sheet", systemImage: "checkmark.circle.fill")
        Text("Presentation remains inside this preview frame.")
      }
      .navigationTitle("Sheet")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }
}

struct DetailsScreen: View {
  @Environment(\.canvasPreview) private var canvas
  var body: some View {
    VStack(spacing: 24) {
      Image(systemName: "square.stack.3d.up.fill").font(.system(size: 52)).foregroundStyle(.blue)
      Text("Details stay here").font(.largeTitle.bold())
      Text("Opening this screen leaves both counters unchanged.").multilineTextAlignment(.center)
      Button("Return to Counter A") { canvas?.navigate("counter-a") }
    }.padding(28)
  }
}

final class NativeControlScreen: UIViewController {
  private var count = 0
  private let label = UILabel()
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    label.text = "UIKit counter: 0"
    label.font = .preferredFont(forTextStyle: .title1)
    label.accessibilityIdentifier = "uikit.counter"
    let button = UIButton(type: .system)
    button.setTitle("Increment UIKit", for: .normal)
    button.addAction(UIAction { [weak self] _ in
      guard let self else { return }; count += 1; label.text = "UIKit counter: \(count)"
    }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [label, button, UISwitch()])
    stack.axis = .vertical; stack.spacing = 24; stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
  }
}

#Preview("Counter A") { CounterScreen() }
#Preview("Counter B") { CounterScreen() }
#Preview("Details") { DetailsScreen() }
#Preview("UIKit") { NativeControlScreen() }
#Preview("Sheet") { SheetContent() }
#Preview("Needs fixture") {
  @Previewable @State var name = ""
  TextField("Unsupported preview-local state", text: $name)
}
