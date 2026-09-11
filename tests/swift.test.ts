import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { scanSwift } from '../src/runtime/adapters/swift/scan';
import { importSwift } from '../src/runtime/adapters/swift/import';
import { ProjectStore } from '../src/runtime/project';
import { identityOf } from '../src/shared/model';
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const mac = { skip: process.platform !== 'darwin' };

test('Swift page scenes retain their parent composition and exclude decoration destinations', mac, async()=>{
  const {swiftScenes}=await import('../src/runtime/adapters/swift/scenes');
  const {compileSwiftPreviews}=await import('../src/runtime/adapters/swift/compile');
  const {buildSwiftFlow}=await import('../src/runtime/adapters/swift/flow');
  const code=await readFile(new URL('./fixtures/swift/SceneLab.swift',import.meta.url),'utf8');
  const inputs=[{path:'SceneLab.swift',code}];const scans=await scanSwift(inputs);
  const scenes=swiftScenes(scans);
  assert.deepEqual(scenes.map(s=>[s.owner,s.selector,s.value,s.target]),[
    ['LabShell','store.page','.first','SceneLab.swift:LabFirst'],['LabShell','store.page','.second','SceneLab.swift:LabSecond']]);
  assert.ok(scenes.every(s=>s.factory===scans[0].previews[0].factory));
  const compiled=await compileSwiftPreviews(inputs,new Set([scenes[0].factory]));
  assert.match(compiled.scanned[0].compiledSource,/CanvasSceneSelection<LabPage>/);
  assert.match(compiled.scanned[0].compiledSource,/Shared parent header/);
  assert.match(compiled.scanned[0].compiledSource,/ShaderLibrary.canvasTint/);
  const decorated=await scanSwift([{path:'Decorated.swift',code:`
struct Home: View { var body: some View { Text("Home").sheet(isPresented: $show) { Detail().background { Decoration() }.toolbar { CloseControl() } } } }
struct Detail: View { var body: some View { Text("Detail") } }
struct Decoration: View { var body: some View { Text("Decoration") } }
struct CloseControl: View { var body: some View { Text("Close") } }`}]);
  assert.deepEqual(buildSwiftFlow(decorated).nodes.map(n=>n.name),['Detail']);
});

test('Swift repeated page components become stable composed states', mac, async t=>{
  const {arrangeByFlow}=await import('../src/runtime/arrange');
  const root=await mkdtemp(join(tmpdir(),'canvas-scenes-')),app=join(root,'app');await mkdir(app);
  const code=`import SwiftUI
@main struct SampleApp: App { var body: some Scene { WindowGroup { Root() } } }
enum Page { case first, second, third }
struct Root: View {
 @State private var page: Page = .first
 var body: some View { switch page { case .first: First(); case .second: Reused(title: "Second"); case .third: Reused(title: "Third") } }
}
struct First: View { var body: some View { Text("First") } }
struct Reused: View { let title: String; var body: some View { Text(title) } }
#Preview { Root() }`;
  await writeFile(join(app,'App.swift'),code);
  const store=await ProjectStore.initialize(join(root,'canvas'),'Scenes',{app,spec:{adapter:'swift-ios',buildStrategy:'xcode',files:['App.swift'],resources:[],target:'App',overrides:{}}});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const map=()=>importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true});
  await map();const before=structuredClone(store.session().project);
  const screens=Object.values(before.document.screens),states=screens.filter(s=>(s.props.native as any).scene);
  assert.equal(states.length,3);
  assert.equal(new Set(states.map(s=>s.key)).size,3);
  const second=states.find(s=>(s.props.native as any).scene.value==='.second')!;
  const third=states.find(s=>(s.props.native as any).scene.value==='.third')!;
  assert.equal((second.props.native as any).scene.destinations['.third'],third.key);
  assert.ok(screens.find(s=>(s.props.native as any).root)?.links.includes(third.key));
  assert.equal(arrangeByFlow(before.document).length,0);
  await map();assert.deepEqual(store.session().project,before);
  assert.equal(await readFile(join(app,'App.swift'),'utf8'),code);
});

test('Swift motion adapter rewrites native managers only in CoreMotion sources', mac, async()=>{
  const [native,unrelated]=await scanSwift([
    {path:'Motion.swift',code:'import CoreMotion\nclass Motion { let first = CMMotionManager(); let second = CoreMotion.CMMotionManager() }'},
    {path:'Unrelated.swift',code:'struct Example { let manager = CMMotionManager() }'},
  ]);
  assert.equal(native.motionAdapter,true);
  assert.equal(native.compiledSource.match(/CanvasPreviewDeviceMotion.makeManager\(\)/g)?.length,2);
  assert.equal(unrelated.motionAdapter,false);
  assert.match(unrelated.compiledSource,/CMMotionManager\(\)/);
  const [preview]=await scanSwift([{path:'Preview.swift',code:'import SwiftUI\nimport CoreMotion\n#Preview { MotionView(manager: CMMotionManager()) }'}]);
  assert.match(preview.compiledSource,/MotionView\(manager: CanvasPreviewDeviceMotion.makeManager\(\)\)/);
});

test('Swift previews reuse an unambiguous authored environment, preserve existing providers and reject ambiguity', mac, async()=>{
  const {swiftPreviewProviders}=await import('../src/runtime/adapters/swift/providers');
  const {compileSwiftPreviews}=await import('../src/runtime/adapters/swift/compile');
  const code=`import SwiftUI
@Observable class Store { init(placement: String) {} }
struct Child: View { @Environment(Store.self) var store; var body: some View { Text("Child") } }
struct Wrapper: View { var body: some View { Child() } }
struct Configured: View { @State var store = Store(placement: "production"); var body: some View { Child().environment(store) } }
#Preview("Missing") { Wrapper() }
#Preview("Authored") { Child().environment(Store(placement: "sample")) }
#Preview("Configured") { Configured() }`;
  const scans=await scanSwift([{path:'App.swift',code}]);const plans=swiftPreviewProviders(scans);
  const [missing,authored,configured]=scans[0].previews;
  assert.deepEqual(plans.get(missing.factory)?.providers,[{type:'Store',kind:'typed',expression:'Store(placement: "sample")',file:'App.swift'}]);
  assert.deepEqual(plans.get(authored.factory),{providers:[],missing:[]});
  assert.deepEqual(plans.get(configured.factory),{providers:[],missing:[]});
  const compiled=await compileSwiftPreviews([{path:'App.swift',code}],new Set([missing.factory]));
  assert.match(compiled.scanned[0].compiledSource,/\(Wrapper\(\)\)\.environment\(Store\(placement: "sample"\)\)/);
  const ambiguous=await scanSwift([{path:'App.swift',code:code+'\n#Preview { Child().environment(Store(placement: "another")) }'}]);
  assert.deepEqual(swiftPreviewProviders(ambiguous).get(missing.factory),{providers:[],missing:['Store']});
});

test('Swift application context is explicit, source-only during import, and reversible with its factories', mac, async t=>{
  const {compileSwiftPreviews}=await import('../src/runtime/adapters/swift/compile');
  const root=await mkdtemp(join(tmpdir(),'canvas-app-context-')); const app=join(root,'app');await mkdir(app);
  const code=`import SwiftUI
@main struct ExampleApp: App {
 let config = ConfigService()
 init() { config.configure() }
 var body: some Scene { WindowGroup { HomeView() } }
}
class ConfigService { static let shared = ConfigService(); func configure() {} }
struct HomeView: View { var body: some View { Text(String(describing: ConfigService.shared)) } }
#Preview { HomeView() }`;
  await writeFile(join(app,'App.swift'),code);
  const store=await ProjectStore.initialize(join(root,'canvas'),'Context',{app,spec:{adapter:'swift-ios',buildStrategy:'xcode',files:['App.swift'],resources:[],target:'App',overrides:{}}});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const map=(swiftContext?:'isolated'|'application')=>importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true,swiftContext});
  await map(); const original=structuredClone(store.session().project);
  assert.equal((Object.values(original.document.screens)[0].props.native as any).blocker.kind,'app-startup');
  await map('application');
  const screen=Object.values(store.session().project.document.screens)[0];
  assert.ok((screen.props.native as any).factory);
  assert.equal(store.session().project.document.nativePreview!.context,'application');
  assert.equal(screen.id,Object.values(original.document.screens)[0].id);
  const sequence=store.session().project.sequence;await map();assert.equal(store.session().project.sequence,sequence);
  const isolated=await compileSwiftPreviews([{path:'App.swift',code}],new Set());
  const application=await compileSwiftPreviews([{path:'App.swift',code}],new Set(),'application');
  assert.equal(isolated.initialize,undefined);
  assert.match(application.scanned[0].compiledSource,/func canvasInitializeApplication\(\) -> Any \{ ExampleApp\(\) \}/);
  assert.doesNotMatch(application.scanned[0].compiledSource,/@main/);
  await store.history('undo',identityOf(store.session()));
  assert.deepEqual(store.session().project.document,original.document);
  assert.equal(await readFile(join(app,'App.swift'),'utf8'),code);
});

test('Xcode strategy retains packages, shaders and app resources without executing uploads or changing the source project', mac, async t => {
  const {writeXcodeProject} = await import('../src/runtime/adapters/swift/standalone');
  const {writeDerivedXcodeProject,readAppInfo} = await import('../src/runtime/adapters/swift/xcode-build');
  const {loadSwiftProject,swiftInputFiles} = await import('../src/runtime/adapters/swift/project');
  const {execFileSync} = await import('node:child_process');
  const root=await mkdtemp(join(tmpdir(),'canvas-xcode-derived-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'app'),host=join(root,'host'); await mkdir(app); await mkdir(host);
  await writeFile(join(app,'App.swift'),'import SwiftUI');
  await writeFile(join(app,'Ripple.metal'),'// shader');
  await writeFile(join(app,'Info.plist'),JSON.stringify({UIAppFonts:['AppFont.ttf']}));
  await writeXcodeProject(app,[join(app,'App.swift'),join(app,'Ripple.metal')],[],'TEST','example.app');
  const file=join(app,'CanvasSwift.xcodeproj/project.pbxproj');
  const pbx=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',file],{encoding:'utf8'}));
  const target:any=Object.values(pbx.objects).find((o:any)=>o.isa==='PBXNativeTarget');
  pbx.objects.package={isa:'XCSwiftPackageProductDependency',productName:'ExampleSDK'};
  pbx.objects.upload={isa:'PBXShellScriptBuildPhase',name:'Symbols',shellScript:'"${BUILD_DIR}/Crashlytics/run"'};
  target.packageProductDependencies=['package']; target.buildPhases.push('upload');
  for(const object of Object.values(pbx.objects) as any[]) if(object.isa==='XCBuildConfiguration') {
    object.buildSettings.INFOPLIST_FILE='Info.plist';object.buildSettings.OTHER_SWIFT_FLAGS=['$(inherited)','-DAPP_FEATURE'];
    object.buildSettings.CODE_SIGN_ENTITLEMENTS='App.entitlements';
  }
  await writeFile(file,JSON.stringify(pbx)); const original=await readFile(file,'utf8');
  const spec=await loadSwiftProject(app);
  assert.equal(spec.buildStrategy,'xcode'); assert.equal(spec.buildIssues,undefined);
  assert.ok(spec.buildInputs?.includes('Ripple.metal'));
  assert.ok(spec.buildNotes?.some(note=>note.includes('symbol upload')));
  assert.ok((await swiftInputFiles(app,spec)).some(input=>input.path==='Info.plist'));
  assert.deepEqual(await readAppInfo(app,spec),{UIAppFonts:['AppFont.ttf']});
  const result=await writeDerivedXcodeProject({app,spec,host,sourceFiles:[join(host,'Registry.swift')],resourceFiles:[],team:'TEST',bundleId:'canvas.preview'});
  const derived=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',join(result.project,'project.pbxproj')],{encoding:'utf8'}));
  const derivedTarget:any=Object.values(derived.objects).find((o:any)=>o.isa==='PBXNativeTarget');
  assert.deepEqual(derivedTarget.packageProductDependencies,['package']);
  assert.ok(!derivedTarget.buildPhases.includes('upload'));
  const settings:any=(Object.values(derived.objects) as any[]).find(o=>o.isa==='XCBuildConfiguration').buildSettings;
  assert.deepEqual(settings.OTHER_SWIFT_FLAGS,['$(inherited)','-DAPP_FEATURE']);
  assert.equal(settings.CODE_SIGN_ENTITLEMENTS,undefined);
  assert.equal(settings.SUPPORTED_PLATFORMS,'iphoneos iphonesimulator');
  assert.ok((Object.values(derived.objects) as any[]).some(o=>o.path===join(host,'inputs','Ripple.metal')));
  assert.equal(await readFile(file,'utf8'),original);
});

test('Swift discovery is source-only and preserves private and Unicode preview expressions', mac, async () => {
  const code = `import SwiftUI\nprivate struct Café: View { var body: some View { Text("café") } }\n#Preview { Café() }\n#Preview("Dark") { Café().preferredColorScheme(.dark) }\n#Preview { @Previewable @State var count = 0; Text("State") }`;
  const [scan] = await scanSwift([{path:'Views/Café.swift',code}]);
  assert.equal(scan.previews.length,3);
  assert.equal(scan.previews[0].titled,false);
  assert.equal(scan.previews[1].name,'Dark');
  assert.equal(scan.previews[1].titled,true);
  assert.match(scan.previews[2].issue!,/explicit factory/);
  assert.match(scan.compiledSource,/private struct Café/);
  assert.match(scan.compiledSource,/CanvasPreviewHost.make\(Café\(\)/);
  assert.doesNotMatch(scan.compiledSource,/#Preview|@Previewable/);
  assert.deepEqual(await scanSwift([{path:'Views/Café.swift',code}]),[scan]);
});

test('Swift compilation preserves availability guards and distinguishes optional bindings from optional values', mac, async () => {
  const [scan]=await scanSwift([{path:'Versioned.swift',code:`import SwiftUI
struct RatingView: View { @Binding var rating: Int?; var body: some View { Text("Rating") } }
@available(iOS 18.0, *)
#Preview { RatingView(rating: .constant(nil)) }`}]);
  assert.deepEqual(scan.declarations[0].requirements,['rating: Binding<Int?>']);
  assert.match(scan.compiledSource,/guard #available\(iOS 18.0, \*\)/);
  assert.match(scan.compiledSource,/CanvasPreviewHost.unavailable/);
  const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
  assert.ok(!swiftRecipes([scan]).some(r=>r.expression.includes('rating: nil')));
});

test('Swift startup diagnostics follow app configuration through extensions and environment defaults without executing it', mac, async () => {
  const {swiftStartupRequirements}=await import('../src/runtime/adapters/swift/state');
  const scans=await scanSwift([{path:'App.swift',code:`import SwiftUI
@main struct Demo: App {
 let config = ConfigService()
 var body: some Scene { WindowGroup { HomeView() } }
}
extension Demo { func prepare() { config.configure() } }
class ConfigService { func configure() {} }
struct StoreKey { static let defaultValue = ConfigService() }
extension EnvironmentValues { var store: ConfigService { self[StoreKey.self] } }
struct HomeView: View { @Environment(\\.store) var store; var body: some View { Text("Home") } }
struct PureView: View { var body: some View { Text("Pure") } }`}]);
  const requirements=swiftStartupRequirements(scans);
  assert.deepEqual(requirements(['HomeView']),['ConfigService']);
  assert.deepEqual(requirements(['PureView']),[]);
});

test('Swift import reads experiment overrides, preserves screen identity and never edits the app', mac, async t => {
  const root = await mkdtemp(join(tmpdir(),'canvas-swift-test-'));
  const app = join(root,'app'); await mkdir(app);
  const original = 'import SwiftUI\n#Preview { Text("Original") }';
  await writeFile(join(app,'Example.swift'),original);
  const store = await ProjectStore.initialize(join(root,'canvas'),'Swift', {app,spec:{adapter:'swift-ios',files:['Example.swift'],resources:[],target:'Test',overrides:{}}});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const map = () => importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true});
  await map();
  const first=store.session().project.document.screenIds[0];
  assert.equal(store.session().project.document.screens[first].name,'Example');
  const override=original+'\n#Preview("Workspace") { Text("Fixture") }';
  await assert.rejects(store.execute({...identityOf(store.session()),requestId:randomUUID(),label:'Stale original',operations:[{type:'native.override',appPath:'Example.swift',source:null,expectedHash:'0'.repeat(64)}]}),/original Swift source changed/);
  await store.execute({...identityOf(store.session()),requestId:randomUUID(),label:'Preview fixture',operations:[{type:'source.write',path:'lib/Example.swift',code:override,expectedHash:null},{type:'native.override',appPath:'Example.swift',source:'lib/Example.swift',expectedHash:hash(original)}]});
  await map();
  const doc=store.session().project.document;
  assert.equal(doc.screenIds.length,2);
  assert.equal(doc.screenIds[0],first);
  assert.equal(doc.screens[doc.screenIds[1]].name,'Workspace');
  const sequence=store.session().project.sequence;
  await map();
  assert.equal(store.session().project.sequence,sequence);
  assert.equal(await readFile(join(app,'Example.swift'),'utf8'),original);
  await store.history('undo',identityOf(store.session()));
  await store.history('undo',identityOf(store.session()));
  assert.deepEqual(store.session().project.document.nativePreview?.overrides,{});
  assert.equal(await readFile(join(app,'Example.swift'),'utf8'),original);
});

test('Swift flow follows value routes, callbacks, computed sheets and panes without mapping every component', mac, async () => {
  const {buildSwiftFlow} = await import('../src/runtime/adapters/swift/flow');
  const code = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { RootView() } } }
struct RootView: View {
 var body: some View {
  NavigationStack {
   HomeView(onOpen: { coordinator.openDetail() })
    .navigationDestination(for: DetailRoute.self) { _ in DetailScreen(model: model) }
    .sheet(isPresented: $showSettings, content: { SettingsView() })
  }
 }
}
class Coordinator { func openDetail() { path.append(DetailRoute(id: id)) } }
struct HomeView: View {
 var onOpen: () -> Void
 var body: some View { NavigationLink(value: DetailRoute(id: 1)) { RowView() } }
}
struct DetailScreen: View {
 let model: Model
 var body: some View {
  VStack { switch pane { case .files: FilesView(); case .chat: ChatView() } }
   .sheet(isPresented: $showPicker) { picker }
 }
 var picker: some View { PickerSheet() }
}
struct SettingsView: View { var body: some View { Text("Settings") } }
struct PickerSheet: View { var body: some View { Text("Picker") } }
struct FilesView: View { var body: some View { Text("Files") } }
struct ChatView: View { var body: some View { RowView() } }
struct RowView: View { var body: some View { switch icon { case .a: IconView(); case .b: Text("b") } } }
struct IconView: View { var body: some View { Text("Icon") } }
struct PreviewWrapper: View { var body: some View { DetailScreen(model: .fixture) } }
#Preview("Detail") { NavigationStack { PreviewWrapper() } }
`;
  const scans = await scanSwift([{path:'App.swift', code}]);
  const flow = buildSwiftFlow(scans);
  const id = (name: string) => `App.swift:${name}`;
  const edge = (from: string, to: string, kind?: string) => flow.edges.some(e => e.from === id(from) && e.to === id(to) && (!kind || e.kind === kind));
  assert.ok(edge('HomeView','DetailScreen','NavigationLink(value:)') || edge('HomeView','DetailScreen','callback'));
  assert.ok(edge('RootView','SettingsView','sheet'));
  assert.ok(edge('DetailScreen','PickerSheet','sheet'));
  assert.ok(edge('DetailScreen','FilesView','content'));
  assert.ok(!flow.nodes.some(n => n.name === 'IconView'));
  assert.ok(!flow.nodes.some(n => n.kind === 'presentation'));
  assert.deepEqual(flow.roots, [id('RootView')]);
  assert.deepEqual(flow.previews[scans[0].previews[0].factory], [id('DetailScreen')]);
  assert.deepEqual(flow.nodes.find(n => n.name === 'DetailScreen')?.requirements, ['model: Model']);
  const sheet = flow.edges.find(e=>e.from===id('RootView') && e.to===id('SettingsView'))!;
  assert.equal(code.split('\n')[sheet.line-1].trim(), '.sheet(isPresented: $showSettings, content: { SettingsView() })');
});

test('Swift import retains destinations without previews and preserves authored context on re-import', mac, async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-swift-flow-'));
  const app = join(root, 'app'); await mkdir(app);
  const code = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { HomeView() } } }
struct HomeView: View { var body: some View { NavigationLink("Detail", destination: DetailScreen(model: model)) } }
struct DetailScreen: View { let model: Model; var body: some View { Text("Detail") } }
#Preview { HomeView() }`;
  await writeFile(join(app, 'App.swift'), code);
  const store = await ProjectStore.initialize(join(root, 'canvas'), 'Swift', {app, spec: {adapter:'swift-ios', files:['App.swift'], resources:[], target:'Test', overrides:{}}});
  t.after(async () => {await store.close(); await rm(root, {recursive:true, force:true});});
  const map = () => importSwift(store, {...identityOf(store.session()), requestId:randomUUID(), from:app, link:true, map:true});
  await map();
  const screens = Object.values(store.session().project.document.screens);
  assert.equal(screens.length, 2);
  const home = screens.find(s => s.name === 'HomeView')!;
  const detail = screens.find(s => s.name === 'DetailScreen')!;
  assert.deepEqual(home.links, [detail.key]);
  assert.ok((detail.props.native as any).issue);
  assert.ok((home.props.native as any).factory);
  await store.execute({...identityOf(store.session()), requestId:randomUUID(), label:'Author context', operations:[{type:'screen.update', id:home.id, patch:{notes:'Keep this note', x:99, links:[detail.key, home.key]}}]});
  await map();
  const updated = store.session().project.document.screens[home.id];
  assert.equal(updated.notes, 'Keep this note');
  assert.equal(updated.x,99);
  assert.deepEqual(updated.links,[home.key, detail.key]);
  const sequence = store.session().project.sequence;
  await map();
  assert.equal(store.session().project.sequence, sequence);
  assert.equal(await readFile(join(app,'App.swift'),'utf8'),code);
});

test('Swift factory generation retains the app type and its extensions without making it the host entry point', mac, async () => {
  const [scan] = await scanSwift([{path:'App.swift',code:`import SwiftUI
@main struct ExampleApp: App { @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate; var body: some Scene { WindowGroup { HomeScreen() } } }
extension ExampleApp { func configure() {} }
private struct HomeScreen: View { var body: some View { Text("Home") } }
#Preview { HomeScreen() }`}]);
  assert.equal(scan.main, true);
  assert.match(scan.compiledSource, /private struct HomeScreen/);
  assert.match(scan.compiledSource, /CanvasPreviewHost.make\(HomeScreen\(\)/);
  assert.doesNotMatch(scan.compiledSource, /@main/);
  assert.match(scan.compiledSource, /struct ExampleApp/);
  assert.match(scan.compiledSource, /extension ExampleApp/);
  assert.doesNotMatch(scan.compiledSource, /@UIApplicationDelegateAdaptor/);
  assert.match(scan.compiledSource, /var delegate = AppDelegate\(\)/);
});

test('Swift flow discovers extension-defined onboarding steps through composed screens without expanding icon switches', mac, async () => {
  const {buildSwiftFlow}=await import('../src/runtime/adapters/swift/flow');
  const [scan]=await scanSwift([{path:'App.swift',code:`import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { RootView() } } }
struct RootView: View { var body: some View { NavigationStack { OnboardingView() } } }
struct OnboardingView: View { var body: some View { pages } }
extension OnboardingView {
 var pages: some View { switch store.page { case .first: FirstView(); case .last: LastView() } }
}
struct FirstView: View { var body: some View { RowView() } }
struct LastView: View { var body: some View { Text("Last") } }
struct RowView: View { var body: some View { switch icon { case .a: IconView(); case .b: Text("b") } } }
struct IconView: View { var body: some View { Text("Icon") } }`}]);
  const flow=buildSwiftFlow([scan]);
  for(const name of ['FirstView','LastView']) {
    assert.ok(flow.nodes.some(n=>n.name===name));
    assert.ok(flow.edges.some(e=>e.to==='App.swift:'+name));
  }
  assert.ok(!flow.nodes.some(n=>n.name==='IconView'));
  assert.ok(scan.calls.some(c=>c.owner==='OnboardingView' && c.name==='FirstView' && c.stateSelector==='store.page'));
});

test('Swift target refresh includes added source files and is undoable', mac, async t => {
  const {writeXcodeProject} = await import('../src/runtime/adapters/swift/build');
  const {loadSwiftProject} = await import('../src/runtime/adapters/swift/project');
  const root = await mkdtemp(join(tmpdir(), 'canvas-swift-membership-'));
  const app = join(root,'app'); await mkdir(app);
  const original = join(app,'Original.swift'), added = join(app,'Added.swift');
  await writeFile(original, 'import SwiftUI\n#Preview { Text("Hello") }');
  await writeXcodeProject(app,[original],[],'TEST','test.canvas');
  const spec = await loadSwiftProject(app);
  const store = await ProjectStore.initialize(join(root,'canvas'),'Swift',{app,spec});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  await writeFile(added,'import SwiftUI\nstruct AddedScreen: View { var body: some View { Text("Added") } }');
  await writeXcodeProject(app,[original,added],[],'TEST','test.canvas');
  await assert.rejects(store.execute({...identityOf(store.session()),requestId:randomUUID(),label:'Stale target',operations:[{type:'native.refresh',expectedHash:'0'.repeat(64)}]}),/Xcode project changed/);
  await importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true});
  assert.ok(store.session().project.document.nativePreview!.files.includes('Added.swift'));
  assert.ok(Object.values(store.session().project.document.screens).some(s=>s.name==='AddedScreen'));
  await store.history('undo',identityOf(store.session()));
  assert.deepEqual(store.session().project.document.nativePreview?.files,['Original.swift']);
});

test('Swift dependency-heavy targets retain a source map without claiming executable previews', mac, async t => {
  const {writeXcodeProject} = await import('../src/runtime/adapters/swift/build');
  const {loadSwiftProject} = await import('../src/runtime/adapters/swift/project');
  const root = await mkdtemp(join(tmpdir(),'canvas-swift-dependencies-'));
  const app = join(root,'app'); await mkdir(app);
  const code = `import SwiftUI
import ExternalUI
@main struct Demo: App { var body: some Scene { WindowGroup { HomeView() } } }
struct HomeView: View { var body: some View { NavigationLink("Detail") { DetailScreen() } } }
struct DetailScreen: View { var body: some View { Text("Detail") } }
#Preview { HomeView() }
#Preview("Component") { Text("Separate component") }`;
  await writeFile(join(app,'App.swift'),code);
  await writeXcodeProject(app,[join(app,'App.swift')],[],'TEST','test.dependencies');
  const file=join(app,'CanvasSwift.xcodeproj/project.pbxproj');
  const {execFileSync}=await import('node:child_process');
  const pbx=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',file],{encoding:'utf8'}));
  const target:any=Object.values(pbx.objects).find((v:any)=>v.isa==='PBXNativeTarget');
  pbx.objects.package={isa:'XCSwiftPackageProductDependency',productName:'ExternalUI'};
  pbx.objects.script={isa:'PBXShellScriptBuildPhase',name:'Custom generation',shellScript:'exit 71'};
  target.packageProductDependencies=['package'];target.buildPhases.push('script');
  await writeFile(file,JSON.stringify(pbx));
  const spec=await loadSwiftProject(app);
  assert.equal(spec.buildStrategy,'xcode');
  assert.ok(spec.buildIssues?.some(issue=>issue.includes('Custom generation')));
  assert.deepEqual(spec.files,['App.swift']);
  const store=await ProjectStore.initialize(join(root,'canvas'),'Dependency map',{app,spec});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const map=()=>importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true});
  const result=await map();
  const document=store.session().project.document;
  const screens=Object.values(document.screens);
  assert.equal(screens.length,2);
  assert.equal(result.import.unmappedPreviews.length,1,'unrenderable component variations remain disclosed in the import inventory');
  assert.ok(screens.find(s=>s.name==='HomeView')!.links.includes(screens.find(s=>s.name==='DetailScreen')!.key));
  for(const screen of screens) {
    const native=screen.props.native as any;
    assert.equal(native.factory,null);
    assert.equal(native.blocker.kind,'build-integration');
    assert.ok(native.requirements.some((issue:string)=>issue.includes('Custom generation')));
  }
  const sequence=store.session().project.sequence;
  await map();assert.equal(store.session().project.sequence,sequence);
  assert.equal(await readFile(join(app,'App.swift'),'utf8'),code);
});

test('Swift recipes reuse typed demo state without assigning unrelated identifiers or starting lifecycle-only roots', mac, async () => {
  const {swiftRecipes} = await import('../src/runtime/adapters/swift/recipes');
  const code = `import SwiftUI
protocol Serving {}
class LocalSource: Serving { let connection: Connection = .connected; let records: [Record] = [] }
class Model {}
struct WorkspaceDemo: View {
 @State private var source: LocalSource = LocalSource()
 @State private var model: Model = Model()
 let unrelated: String = "Not a server identifier"
 var body: some View { Text("Demo") }
}
struct HomeScreen: View { let source: any Serving; let connection: Connection; let onOpen: (String) -> Void; var body: some View { Text("Home") } }
struct FilesScreen: View { let model: Model; let isActive: Bool; var body: some View { Text("Files") } }
struct RecordsScreen: View { let record: Record; var body: some View { Text("Record") } }
struct PairScreen: View { let serverId: String; var body: some View { Text("Pair") } }
struct LoginScreen: View { let onLogin: () -> Void; var body: some View { Text("Login").task { await authenticate() } } }
struct CameraBridge: UIViewControllerRepresentable {}
struct CameraScreen: View { var body: some View { CameraBridge() } }
`;
  const scans = await scanSwift([{path:'Views.swift',code}]);
  const recipes = swiftRecipes(scans);
  const home = recipes.find(r=>r.target==='Views.swift:HomeScreen')!;
  assert.match(home.projections[0].expression,/source: source, connection: source.connection, onOpen: \{ _ in/);
  assert.match(recipes.find(r=>r.target==='Views.swift:FilesScreen')!.projections[0].expression,/model: model, isActive: true/);
  assert.match(recipes.find(r=>r.target==='Views.swift:RecordsScreen')!.projections[0].expression,/if let .*source.records.first/);
  assert.ok(!recipes.some(r=>r.target==='Views.swift:PairScreen'));
  assert.ok(!recipes.some(r=>r.target==='Views.swift:LoginScreen'));
  assert.ok(!recipes.some(r=>r.target==='Views.swift:CameraScreen'));
  const [compiled] = await scanSwift([{path:'Views.swift',code,projections:JSON.stringify(home.projections)}]);
  assert.match(compiled.compiledSource,/@State private var source/);
  assert.match(compiled.compiledSource,/@Environment\(\\.canvasProjection\)/);
  assert.match(compiled.compiledSource,/_canvasOriginalBody/);
  assert.match(compiled.compiledSource,/HomeScreen\(source: source/);
  assert.match(compiled.compiledSource,/Text\("Demo"\)/);
});

test('Swift projection excludes shadowed optional bindings and closure parameters', mac, async () => {
  const {swiftRecipes} = await import('../src/runtime/adapters/swift/recipes');
  const scans = await scanSwift([{path:'Scopes.swift',code:`import SwiftUI
struct ExampleDemo: View {
 let model: Model? = nil
 var body: some View {
  if let model { ChildScreen(model: model) }
  ForEach(models) { model in ChildScreen(model: model) }
 }
}
struct ChildScreen: View { let model: Model; var body: some View { Text("Child") } }
class Model {}
`}]);
  const child = swiftRecipes(scans).find(r=>r.target==='Scopes.swift:ChildScreen')!;
  assert.match(child.projections[0].expression, /if let model = model/);
  assert.match(child.projections[0].expression, /ChildScreen\(model: model\)/);
  assert.match(child.projections[0].expression, /CanvasRecipeUnavailable/);
});

test('Swift recipes supply required app environment through visible modifiers and reject unavailable providers', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const code=`import SwiftUI
@Observable class Coordinator { init() {} }
class MissingService { init(token: Token) {} }
class Model {}
struct LocalDemo: View { @State var model: Model = Model(); var body: some View { Text("Demo") } }
struct EnvModifier: ViewModifier { @Environment(Coordinator.self) var coordinator; func body(content: Content) -> some View { content } }
struct HomeScreen: View { let model: Model; var body: some View { Text("Home").modifier(EnvModifier()) } }
struct UnavailableScreen: View { let model: Model; @Environment(MissingService.self) var service; var body: some View { Text("Missing") } }
`;
 const scans=await scanSwift([{path:'Environment.swift',code}]);
 const recipes=swiftRecipes(scans),home=recipes.find(r=>r.target==='Environment.swift:HomeScreen')!;
 assert.deepEqual(home.projections[0].environment?.map(e=>e.type),['Coordinator']);
 assert.ok(!recipes.some(r=>r.target==='Environment.swift:UnavailableScreen'));
 const [compiled]=await scanSwift([{path:'Environment.swift',code,projections:JSON.stringify(home.projections)}]);
 assert.match(compiled.compiledSource,/@State private var _canvasEnvironment_Coordinator = Coordinator\(\)/);
 assert.match(compiled.compiledSource,/\.environment\(_canvasEnvironment_Coordinator\)/);
});

test('Swift recipes use protocol-extension collections and expose computed presentation content', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const code=`import SwiftUI
protocol Serving {}
extension Serving { var projects: [Project] { [] } }
class DemoSource: Serving { let repoGroups: [Project] = [] }
struct ExampleDemo: View {
 @State var source: DemoSource = DemoSource()
 var body: some View { Text("Demo").sheet(isPresented: $showingTabs) { tabs } }
 var tabs: some View { Text("Tabs") }
 @State var showingTabs = false
}
struct ProjectScreen: View { let project: Project; var body: some View { Text("Project") } }
class Project {}
`;
 const scans=await scanSwift([{path:'Collections.swift',code}]);
 const recipes=swiftRecipes(scans);
 assert.match(recipes.find(r=>r.target==='Collections.swift:ProjectScreen')!.projections[0].expression,/source.projects.first/);
 const tabs=recipes.find(r=>r.target==='Collections.swift:ExampleDemo.sheet:$showingTabs')!;
 assert.equal(tabs.projections[0].expression,'tabs');
});


test('Swift nested recipes read private-set models, guard optional data, and retain parent lifecycle once', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const code=`import SwiftUI
struct Detail: View { let record: Record; var body: some View { Nested(record: record) } }
struct Nested: View { let record: Record; var body: some View { Text(record.title) } }
struct SampleDemo: View {
 @State private var model = Model()
 let direct: [Record] = []
 var body: some View { Text("Root").padding().task { await model.load() }.onDisappear { model.stop() } }
}
struct Record { let title: String; let detail: DetailModel }
class DetailModel {}
struct DetailModelScreen: View { let detail: DetailModel; var body: some View { Text("Nested record") } }
class Model {
 private(set) var container: Container? = nil
 private var hidden: Secret? = nil
 static let shared: Secret = Secret()
 func load() async {}; func stop() {}
}
class Container { var records: [Record] = [] }
class Secret {}
struct SecretScreen: View { let secret: Secret; var body: some View { Text("Secret") } }
`;
 const scans=await scanSwift([{path:'Nested.swift',code}]);
 const recipes=swiftRecipes(scans), detail=recipes.find(r=>r.target==='Nested.swift:Detail')!;
 assert.match(detail.projections[0].expression,/model.container\?\.records.first/);
 assert.match(detail.projections[0].expression,/if let/);
 // Getter privacy is respected across files (private-set remains readable).
 const model=scans[0].declarations.find(d=>d.name==='Model')!;
 assert.equal(model.fields.find(f=>f.name==='container')?.accessible,true);
 assert.equal(model.fields.find(f=>f.name==='hidden')?.accessible,false);
 assert.ok(!model.fields.some(f=>f.name==='shared'));
 assert.ok(recipes.some(r=>r.target==='Nested.swift:Nested'));
 assert.match(recipes.find(r=>r.target==='Nested.swift:DetailModelScreen')!.projections[0].expression,/direct\.first\?\.detail/);
 const [compiled]=await scanSwift([{path:'Nested.swift',code,projections:JSON.stringify(detail.projections)}]);
 assert.match(compiled.compiledSource,/if !_canvasProjection.isEmpty/);
 assert.match(compiled.compiledSource,/\.task \{ await model.load\(\) \}\.onDisappear \{ model.stop\(\) \}.*else \{ _canvasOriginalBody/s);
 assert.equal((compiled.compiledSource.match(/await model.load\(\)/g) ?? []).length,2); // mutually exclusive branches
 assert.deepEqual(swiftRecipes(scans),recipes);
});

test('Swift coverage distinguishes native controllers, generic content, lifecycle work and missing inputs', mac, async () => {
 const {swiftPreviewBlocker}=await import('../src/runtime/adapters/swift/coverage');
 const scans=await scanSwift([{path:'Coverage.swift',code:`import SwiftUI
struct Camera: UIViewControllerRepresentable {}
struct Container<Content: View>: View { let content: Content; var body: some View { content } }
struct Login: View { var body: some View { Text("Login").task { await login() } } }
struct Detail: View { let record: Record; var body: some View { Text("Detail") } }
`}]);
 assert.equal(swiftPreviewBlocker(scans,'Coverage.swift','Camera').kind,'native-bridge');
 assert.equal(swiftPreviewBlocker(scans,'Coverage.swift','Container').kind,'generic-content');
 assert.equal(swiftPreviewBlocker(scans,'Coverage.swift','Login').kind,'lifecycle');
 assert.equal(swiftPreviewBlocker(scans,'Coverage.swift','Detail').kind,'inputs');
});

test('Swift recipes replace a service default only with one accessible app-local preview implementation', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const scans=await scanSwift([{path:'Screen.swift',code:`import SwiftUI
struct Settings: View {
 init(client: any Serving = ProductionClient()) {}
 var body: some View { Text("Settings").task { await load() } }
}
struct Unrelated: View {
 init(client: any OtherServing = OtherClient()) {}
 var body: some View { Text("Other").task { await load() } }
}
`},{path:'Fixtures.swift',code:`class PreviewClient: Serving { init() {} }
private class PreviewOtherClient: OtherServing { init() {} }
`}]);
 const recipes=swiftRecipes(scans);
 assert.equal(recipes.find(r=>r.target==='Screen.swift:Settings')?.expression,'Settings(client: PreviewClient())');
 assert.ok(!recipes.some(r=>r.target==='Screen.swift:Unrelated'));
 const ambiguous=await scanSwift([{path:'Other.swift',code:'class DemoClient: Serving { init() {} }'}]);
 assert.ok(!swiftRecipes([...scans,...ambiguous]).some(r=>r.target==='Screen.swift:Settings'));
});

test('Swift default previews allow native controls without launching camera destinations', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const scans=await scanSwift([{path:'Controls.swift',code:`import SwiftUI
struct PasteControl: UIViewRepresentable { func makeUIView(context: Context) -> UIPasteControl { UIPasteControl() } }
struct CameraBridge: UIViewControllerRepresentable {}
struct Camera: View { var body: some View { CameraBridge() } }
struct Pairing: View {
 @State var scanner=false
 var body: some View { PasteControl().sheet(isPresented: $scanner) { Camera() } }
}
struct NestedCamera: View { var body: some View { Camera() } }
`}]);
 const recipes=swiftRecipes(scans);
 assert.ok(recipes.some(r=>r.target==='Controls.swift:Pairing'));
 assert.ok(!recipes.some(r=>['Controls.swift:Camera','Controls.swift:NestedCamera'].includes(r.target)));
});

test('Swift binding prefers available demo values over an earlier optional presentation state', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const scans=await scanSwift([{path:'Selection.swift',code:`import SwiftUI
class Selection {}
struct FirstDemo: View { let selection: Selection? = nil; var body: some View { Text("First") } }
struct SecondDemo: View { let selection = Selection(); var body: some View { Text("Second") } }
struct Picker: View { let selection: Selection; var body: some View { Text("Picker") } }
`}]);
 const recipe=swiftRecipes(scans).find(r=>r.target==='Selection.swift:Picker')!;
 assert.equal(recipe.root,'Selection.swift:SecondDemo');
 assert.doesNotMatch(recipe.projections[0].expression,/if let/);
});

test('Swift list-detail recipes preserve the owning loader before optional global record guesses', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const code=`import SwiftUI
struct LocalDemo: View { @State var model=Model(); var body: some View { Text("Demo") } }
class Model { var records: [Record] = []; func load() async {} }
struct Record { var title: String }
struct Detail: View { let record: Record; var body: some View { Text(record.title) } }
struct ListScreen: View {
 let model: Model
 var body: some View {
  List { ForEach(model.records) { record in NavigationLink { Detail(record: record) } label: { Text(record.title) } } }
   .task { await model.load() }
 }
}
struct UnknownScope: View { var body: some View { customCallback { unknown in Detail(record: unknown) } } }
`;
 const scans=await scanSwift([{path:'Ownership.swift',code}]);
 const recipe=swiftRecipes(scans).find(r=>r.target==='Ownership.swift:Detail')!;
 assert.deepEqual(recipe.projections.map(p=>p.owner),['LocalDemo','ListScreen']);
 assert.match(recipe.projections[1].expression,/if let record = \(model.records\)\.first/);
 assert.ok(!recipe.projections.some(p=>p.owner==='UnknownScope'));
 const [compiled]=await scanSwift([{path:'Ownership.swift',code,projections:JSON.stringify(recipe.projections)}]);
 assert.match(compiled.compiledSource,/await model.load\(\)/);
 assert.match(compiled.compiledSource,/if let record = \(model.records\)\.first/);
});

test('Swift scoped constructors guard nested optional bindings and reject unknown closure inputs', mac, async () => {
 const {projectConstructor}=await import('../src/runtime/adapters/swift/projection');
 const scans=await scanSwift([{path:'Scope.swift',code:`struct Demo: View {
 let model: Model?
 var body: some View {
  if let model, let record = model.record { Detail(record: record) }
  run { record in Detail(record: record) }
 }
}`}]);
 const calls=scans[0].calls.filter(c=>c.name==='Detail');
 const expression=projectConstructor(calls[0],['model','Detail'],'Detail')!.expression;
 assert.match(expression,/if let model = model.*if let record = model.record.*Detail\(record: record\)/);
 assert.equal(projectConstructor(calls[1],['model','Detail'],'Detail'),undefined);
});


test('Swift source recipe ranking prefers a complete child constructor over guarded record fragments', mac, async () => {
 const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
 const scans=await scanSwift([{path:'Ranking.swift',code:`import SwiftUI
struct Demo: View { let model = Model(); var body: some View { A(model:model); B(model:model) } }
class Model { var record: Record? = nil }
struct Record { let text: String }
struct A: View { let model: Model; var body: some View { if let record = model.record { Target(text: record.text) } } }
struct B: View { let model: Model; var body: some View { Target(text: "App-authored example") } }
struct Target: View { let text: String; var body: some View { Text(text) } }
`}]);
 const recipe=swiftRecipes(scans).find(r=>r.target==='Ranking.swift:Target')!;
 assert.equal(recipe.projections.at(-1)?.owner,'B');
 assert.equal(recipe.guards,0);
});

test('Swift component catalog preserves explicit choices and separates animation hints from routes', mac, async t=>{
  const {swiftPreviewCatalog,swiftImageAssets}=await import('../src/runtime/adapters/swift/catalog');
  const root=await mkdtemp(join(tmpdir(),'canvas-preview-catalog-')),app=join(root,'app');await mkdir(app);
  const code=`import SwiftUI
@main struct Example: App { var body: some Scene { WindowGroup { Home() } } }
struct Home: View { var body: some View { Text("Home") } }
struct Motion: View { @State var moving=false; var body: some View { Circle().onAppear { withAnimation(.linear.repeatForever()) { moving=true } } } }
#Preview("Motion example") { Motion() }
#Preview { Home() }`;
  await writeFile(join(app,'App.swift'),code);
  const scans=await scanSwift([{path:'App.swift',code}]);
  const catalog=swiftPreviewCatalog(scans);
  assert.ok(catalog[0].animationEvidence.some(e=>e.api==='withAnimation'));
  assert.equal(catalog[1].animationEvidence.length,0);
  const store=await ProjectStore.initialize(join(root,'canvas'),'Catalog',{app,spec:{adapter:'swift-ios',buildStrategy:'xcode',files:['App.swift'],resources:[],target:'App',overrides:{}}});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const map=(swiftPreviews?:string[])=>importSwift(store,{...identityOf(store.session()),requestId:randomUUID(),from:app,link:true,map:true,swiftPreviews});
  await map();const before=store.session().project;
  await assert.rejects(map(['missing-preview']),/not found/);assert.deepEqual(store.session().project,before);
  await map(['Motion example']);const chosen=Object.values(store.session().project.document.screens).find(s=>(s.props.native as any).component)!;
  assert.ok(chosen);assert.deepEqual(chosen.links,[]);
  await store.execute({...identityOf(store.session()),requestId:randomUUID(),label:'Choose image fixture',operations:[{type:'screen.update',id:chosen.id,patch:{props:{...chosen.props,native:{...(chosen.props.native as any),imageFixtures:{'*':'photo'}}}}}]});
  const selected=structuredClone(store.session().project);await map();assert.deepEqual(store.session().project,selected);
  const asset=join(app,'Assets.xcassets','Samples','photo.imageset');await mkdir(asset,{recursive:true});
  await writeFile(join(app,'Assets.xcassets','Samples','Contents.json'),JSON.stringify({properties:{'provides-namespace':true}}));
  await writeFile(join(asset,'Contents.json'),JSON.stringify({images:[{filename:'photo.png'}]}));
  assert.deepEqual(await swiftImageAssets(app,['Assets.xcassets']),[{name:'Samples/photo',catalog:'Assets.xcassets',file:'Assets.xcassets/Samples/photo.imageset'}]);
});

test('Swift image fixtures adapt supported Kingfisher views without changing other calls', mac, async()=>{
  const code='import SwiftUI\nimport Kingfisher\nstruct Photo: View { let url: URL?; var body: some View { KFImage.url(url).resizable().frame(width: 100) } }';
  const [scan,other]=await scanSwift([{path:'Photo.swift',code},{path:'Other.swift',code:code.replace('import Kingfisher','')}]);
  assert.equal(scan.imageAdapter,true);
  assert.match(scan.compiledSource,/CanvasPreviewImages.kingfisher\(url, context: _canvasPreviewContext\)\.resizable\(\)\.frame/);
  assert.equal(scan.compiledSource.match(/private var _canvasPreviewContext/g)?.length,1);
  assert.equal(other.imageAdapter,false);
  const [unsupported]=await scanSwift([{path:'Photo.swift',code:code.replace('KFImage.url(url)','KFImage.url(url, cacheKey: "own")')}]);
  assert.equal(unsupported.imageAdapter,false);
});

test('Swift screen bounds belong to the frame only in supported view contexts', mac, async()=>{
  const [scan]=await scanSwift([{path:'Bounds.swift',code:`import SwiftUI
struct Photo: View { static let globalWidth = UIScreen.main.bounds.width
var body: some View { Color.red.frame(width: UIScreen.main.bounds.width, height: UIKit.UIScreen.main.bounds.height) }
func unrelated() -> CGRect { UIScreen.main.bounds }
}
struct Particles: UIViewRepresentable {
func makeUIView(context: Context) -> UIView { UIView(frame: UIScreen.main.bounds) }
func updateUIView(_ uiView: UIView, context: Context) { uiView.frame = UIScreen.main.bounds }
}`}]);
  assert.equal(scan.boundsAdapter,true);assert.equal(scan.imageAdapter,false);
  assert.equal(scan.compiledSource.match(/_canvasPreviewContext\?\.bounds/g)?.length,4);
  assert.equal(scan.compiledSource.match(/private var _canvasPreviewContext/g)?.length,2);
  assert.match(scan.compiledSource,/static let globalWidth = UIScreen.main.bounds.width/);
  assert.match(scan.compiledSource,/func unrelated\(\) -> CGRect \{ UIScreen.main.bounds \}/);
});

test('Swift scene selection requires a setter usable from an immutable View body', mac, async()=>{
  const {swiftScenes}=await import('../src/runtime/adapters/swift/scenes');
  const {compileSwiftPreviews}=await import('../src/runtime/adapters/swift/compile');
  const code=`import SwiftUI
import Observation
enum Page { case first, second }
struct First: View { var body: some View { Text("First") } }
struct Second: View { var body: some View { Text("Second") } }
struct ValueRoot: View {
 var page: Page = .first
 var body: some View { switch page { case .first: First(); case .second: Second() } }
}
struct StateRoot: View {
 @State var page: Page = .first
 var body: some View { switch page { case .first: First(); case .second: Second() } }
}
struct BindingRoot: View {
 @Binding var page: Page
 var body: some View { switch page { case .first: First(); case .second: Second() } }
}
@Observable class Store { var page: Page = .first }
struct ReferenceRoot: View {
 let store = Store()
 var body: some View { switch store.page { case .first: First(); case .second: Second() } }
}
#Preview { ValueRoot() }
#Preview { StateRoot() }
#Preview { BindingRoot(page: .constant(.first)) }
#Preview { ReferenceRoot() }`;
  const inputs=[{path:'Setters.swift',code}],scans=await scanSwift(inputs);
  const scenes=swiftScenes(scans);
  assert.deepEqual([...new Set(scenes.map(scene=>scene.owner))],['StateRoot','BindingRoot','ReferenceRoot']);
  const compiled=await compileSwiftPreviews(inputs,new Set(scans[0].previews.map(preview=>preview.factory)));
  assert.doesNotMatch(compiled.scanned[0].compiledSource,/id: "Setters.swift:ValueRoot.page"/);
  assert.match(compiled.scanned[0].compiledSource,/id: "Setters.swift:StateRoot.page"/);
});

test('Swift recipe calls omit positional initializer labels', mac, async()=>{
  const {swiftRecipes}=await import('../src/runtime/adapters/swift/recipes');
  const scans=await scanSwift([{path:'Positional.swift',code:`import SwiftUI
struct ActionScreen: View {
 let action: () -> Void
 init(_ action: @escaping () -> Void) { self.action = action }
 var body: some View { Button("Tap", action: action) }
}
struct OptionalScreen: View {
 let value: String?
 init(_ value: String?) { self.value = value }
 var body: some View { Text(value ?? "Empty") }
}`}]);
  const recipes=swiftRecipes(scans);
  assert.equal(recipes.find(recipe=>recipe.target==='Positional.swift:ActionScreen')?.expression,'ActionScreen({  })');
  assert.equal(recipes.find(recipe=>recipe.target==='Positional.swift:OptionalScreen')?.expression,'OptionalScreen(nil)');
});
