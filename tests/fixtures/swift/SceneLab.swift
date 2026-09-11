import SwiftUI
import MessageUI

enum LabPage { case first, second }
@Observable class LabStore { var page: LabPage = .first }

@main struct SceneLabApp: App {
  var body: some Scene { WindowGroup { LabRoot() } }
}
struct LabRoot: View {
  @State private var store = LabStore()
  var body: some View { NavigationStack { LabShell().environment(store) } }
}
struct LabShell: View {
  @Environment(LabStore.self) private var store
  var body: some View {
    VStack(spacing: 24) {
      Text("Shared parent header").font(.title2.bold())
      Circle().fill(.red).frame(width: 90, height: 90)
        .colorEffect(ShaderLibrary.canvasTint())
      Group {
        switch store.page {
        case .first: LabFirst()
        case .second: LabSecond()
        }
      }
      Button("Continue to second") { store.page = .second }
        .buttonStyle(.borderedProminent)
      Text("Shared parent footer")
      Text("Screen width \(Int(UIScreen.main.bounds.width))")
    }.frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(LinearGradient(colors: [.purple.opacity(0.8), .cyan.opacity(0.35)], startPoint: .top, endPoint: .bottom))
  }
}
struct LabFirst: View {
  @Environment(\.openURL) private var openURL
  var body: some View {
    VStack {
      Text("First page").font(.largeTitle)
      Text(MFMailComposeViewController.canSendMail() ? "Mail available" : "Mail disabled")
    }.task { openURL(URL(string: "mailto:preview@example.invalid")!) }
  }
}
struct LabSecond: View { var body: some View { Text("Second page").font(.largeTitle) } }
#Preview { LabRoot() }
#Preview { LabFirst() }
#Preview { LabSecond() }
