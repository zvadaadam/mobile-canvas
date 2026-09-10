import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectHrefs, buildRouteMap, matchesRoute } from "../src/runtime/frames";
import { ProjectStore } from "../src/runtime/project";
import { identityOf, CommandSchema } from "../src/shared/model";

test("navigation analysis follows imported router aliases, literal variables, templates and Link; excludes back, tabs and arbitrary paths", () => {
  const code = 'import { router as r, useRouter, Link as AppLink } from "expo-router"; const router = useRouter(); const href = date ? `/calendar?date=${date}` : "/calendar"; router.push(href); r.navigate({ pathname: "/exercise/[slug]" }); router.replace(`/workout/${id}`); const unrelated = { pathname: "/not-navigation" }; list.push("/not-a-route"); router.prefetch("/prefetched"); router.dismissTo("/back"); const view = <><AppLink href="/settings" /><a href="/web" /><Tabs.Screen name="/tab" /></>;';
  assert.deepEqual(collectHrefs("screen.tsx", code), ["/calendar", "/calendar?date=[dynamic]", "/exercise/[slug]", "/settings", "/workout/[dynamic]"]);
  assert.equal(matchesRoute("/workout/[dynamic]", { path: "/workout/[id]" }), true);
  assert.equal(matchesRoute("/workout/1?foo=yes", { path: "/workout/[id]" }), true);
  assert.equal(matchesRoute("/workout/1/details", { path: "/workout/[id]" }), false);
});

test("route-only app maps once, follows re-exports, excludes API/platform routes, and preserves edits across re-import and undo", async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "canvas-map-")));
  const app = join(temporary, "app"), project = join(temporary, "canvas");
  const write = async (path: string, code: string) => { await mkdir(join(app, path, ".."), { recursive: true }); await writeFile(join(app, path), code); };
  await write("package.json", JSON.stringify({ name: "route-only", dependencies: { expo: "~57.0.0" } }));
  await write("src/app/_layout.tsx", 'import { Stack } from "expo-router"; export default () => <Stack><Stack.Screen name="detail/[id]" options={{ title: "Details", presentation: "formSheet" }} /></Stack>;');
  await write("src/app/_layout.android.tsx", 'export default () => null;');
  await write("src/app/index.tsx", 'export { default } from "./entry";');
  await write("src/app/entry.tsx", 'import { router } from "expo-router"; export default function Home() { router.push("/detail/42"); return null; }');
  await write("src/app/detail/[id].tsx", 'export default () => null;');
  await write("src/app/detail/[id].ios.tsx", 'export default () => null;');
  await write("src/app/detail/[id].android.tsx", 'export default () => null;');
  await write("src/app/data+api.ts", 'export function GET() {}');
  await write("src/app/+not-found.tsx", 'export default () => null;');
  const map = await buildRouteMap({ app, routesDirectory: "src/app", aliases: {} });
  assert.equal(map.frames.length, 3);
  assert.equal(map.frames.find(frame => frame.key === "detail")?.file, "src/app/detail/[id].ios.tsx");
  assert.equal(map.frames.find(frame => frame.key === "detail")?.name, "Details");
  assert.deepEqual(map.frames.find(frame => frame.key === "index")?.links, ["detail"]);
  const store = await ProjectStore.initialize(project, "Test");
  t.after(async () => { await store.close(); await rm(temporary, { recursive: true, force: true }); });
  const result = await store.importSources({ ...identityOf(store.session()), requestId: "map-1", from: app, link: true, map: true });
  assert.equal(result.import.routeMap?.frames.length, 3);
  assert.equal(result.session.sources.length, 3);
  assert.ok(result.session.sources.every(source => source.path.startsWith("screens/")));
  assert.deepEqual(result.session.project.document.resolver?.modules, {});
  assert.ok(result.import.dependencies.some(dependency => dependency.specifier === "expo-router" && dependency.status === "missing"));
  const screens = Object.values(result.session.project.document.screens);
  const home = screens.find(screen => screen.key === "index")!;
  assert.deepEqual(home.links, ["detail"]);
  assert.match(await readFile(join(project, home.source), "utf8"), /NO LIVE PREVIEW/);
  await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: "edit", label: "Edit", operations: [{ type: "screen.update", id: home.id, patch: { notes: "Keep my notes", links: [], x: 123 } }] }));
  await store.importSources({ ...identityOf(store.session()), requestId: "map-2", from: app, link: true, map: true });
  const updated = store.session().project.document.screens[home.id];
  assert.equal(updated.notes, "Keep my notes");
  assert.deepEqual(updated.links, []);
  assert.equal(updated.x, 123);
  assert.equal(store.session().project.document.screenIds.length, 3);
  await store.history("undo", identityOf(store.session()));
  await store.history("undo", identityOf(store.session()));
  await store.history("undo", identityOf(store.session()));
  assert.equal(store.session().sources.length, 0);
  assert.equal(store.session().project.document.screenIds.length, 0);
  await store.history("redo", identityOf(store.session()));
  assert.equal(store.session().project.document.screenIds.length, 3);
  assert.match(await readFile(join(app, "src/app/index.tsx"), "utf8"), /export \{ default \}/);
});

for (const sdk of [56, 57]) test(`Expo ${sdk} native route preview upgrades untouched cards atomically and preserves authored context through undo`, async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "canvas-native-map-")));
  const app = join(temporary, "app"), project = join(temporary, "canvas");
  await mkdir(join(app, "app"), { recursive: true });
  await mkdir(join(app, "node_modules/expo"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "preview", dependencies: { expo: `~${sdk}.0.0` } }));
  await writeFile(join(app, "node_modules/expo/package.json"), JSON.stringify({ version: `${sdk}.0.20` }));
  const source = 'throw new Error("Do not execute during import"); export default function App() { return null; }';
  await writeFile(join(app, "app/index.tsx"), source);
  const store = await ProjectStore.initialize(project, "Preview");
  t.after(async () => { await store.close(); await rm(temporary, { recursive: true, force: true }); });
  await store.importSources({ ...identityOf(store.session()), requestId: "map", from: app, link: true, map: true });
  const id = store.session().project.document.screenIds[0];
  await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: "notes", label: "Context", operations: [{ type: "screen.update", id, patch: { notes: "My context", x: 123 } }] }));
  const before = store.session();
  await store.importSources({ ...identityOf(before), requestId: "preview", from: app, link: true, map: true, preview: true });
  const after = store.session();
  assert.deepEqual(after.project.document.appPreview, { sdk, routesDirectory: "app" });
  assert.deepEqual(after.project.document.screenIds, before.project.document.screenIds);
  assert.equal(after.project.document.screens[id].notes, "My context");
  assert.equal(after.project.document.screens[id].x, 123);
  assert.deepEqual(after.project.document.resolver?.modules, {});
  assert.match(await readFile(join(project, "screens/route-index.tsx"), "utf8"), /require\("expo-canvas-linked-app"\)/);
  assert.match(await readFile(join(project, ".expo-canvas/route-context.ts"), "utf8"), /"\.\/index.tsx": \(\) => require\(/);
  assert.equal(await readFile(join(app, "app/index.tsx"), "utf8"), source);
  await store.history("undo", identityOf(after));
  assert.deepEqual(store.session().project.document, before.project.document);
  assert.match(await readFile(join(project, "screens/route-index.tsx"), "utf8"), /NO LIVE PREVIEW/);
});

test("shared route groups keep one frame per source with all contexts and canonical incoming links", async t => {
  const app = await realpath(await mkdtemp(join(tmpdir(), "canvas-shared-routes-")));
  t.after(() => rm(app, { recursive: true, force: true }));
  for (const group of ["(one)", "(two)", "(one,two)"]) await mkdir(join(app, "app", group), { recursive: true });
  await writeFile(join(app, "app/_layout.tsx"), 'import { NativeTabs } from "expo-router/unstable-native-tabs"; export default () => <NativeTabs />;');
  await writeFile(join(app, "app/(one,two)/_layout.tsx"), 'import { Stack } from "expo-router"; export default () => <Stack />;');
  await writeFile(join(app, "app/(one,two)/detail.tsx"), 'import { router } from "expo-router"; export default () => { router.push("/other"); return null; };');
  await writeFile(join(app, "app/(one,two)/other.tsx"), 'export default () => null;');
  for (const group of ["one", "two"]) await writeFile(join(app, `app/(${group})/index.tsx`), 'import { Link } from "expo-router"; export default () => <Link href="/detail" />;');
  const { frames } = await buildRouteMap({ app, routesDirectory: "app", aliases: {} });
  assert.equal(frames.length, 4);
  assert.ok(frames.every(frame => !frame.fullPath.includes(",")));
  for (const group of ["one", "two"]) {
    const root = frames.find(frame => frame.fullPath === `/(${group})`)!;
    const detail = frames.find(frame => frame.contexts?.some(context => context.fullPath === `/(${group})/detail`))!;
    const other = frames.find(frame => frame.contexts?.some(context => context.fullPath === `/(${group})/other`))!;
    assert.deepEqual(root.links, [detail.key]);
    assert.deepEqual(detail.links, [other.key]);
    assert.equal(detail.file, "app/(one,two)/detail.tsx");
    assert.deepEqual(detail.chain, ["app/_layout.tsx", "app/(one,two)/_layout.tsx"]);
  }
});

test("native route URLs encode record IDs, catch-all paths and query parameters", async () => {
  const { routeLocation } = await import("../apps/linked-host/route-location");
  assert.equal(routeLocation("/(tabs)/exercise/[slug]", { slug: "a/b", unit: "lb" }).pathname, "/(tabs)/exercise/a%2Fb");
  assert.equal(routeLocation("/workout/[id]", { id: "plan", mode: "preview" }).search, "?mode=preview");
  assert.equal(routeLocation("/files/[...path]", { path: ["one", "two words"] }).pathname, "/files/one/two%20words");
  assert.equal(routeLocation("/exercise/[slug]").pathname, "/exercise/[slug]");
});

test('reimport merges untouched shared-context copies, rewires links and undo restores them', async t => {
  const {linkedRouteSource}=await import('../src/runtime/host/route-context');
  const directory=await realpath(await mkdtemp(join(tmpdir(),'canvas-merge-contexts-')));
  const app=join(directory,'app');
  await mkdir(join(app,'app/(one,two)'),{recursive:true});
  await mkdir(join(app,'node_modules/expo'),{recursive:true});
  await writeFile(join(app,'package.json'),JSON.stringify({name:'shared',dependencies:{expo:'56.0.0'}}));
  await writeFile(join(app,'node_modules/expo/package.json'),JSON.stringify({version:'56.0.0'}));
  await writeFile(join(app,'app/index.tsx'),'export default () => null;');
  await writeFile(join(app,'app/(one,two)/detail.tsx'),'export default () => null;');
  const store=await ProjectStore.initialize(join(directory,'canvas'),'Shared');
  t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true});});
  const imports=()=>store.importSources({...identityOf(store.session()),requestId:crypto.randomUUID(),from:app,link:true,map:true,preview:true});
  await imports();
  const detail=Object.values(store.session().project.document.screens).find(s=>s.key==='detail')!;
  const home=Object.values(store.session().project.document.screens).find(s=>s.key==='index')!;
  const route=detail.props.route as any;
  const original = await store.readRouteSource(detail.id);
  assert.equal(original.code, 'export default () => null;');
  assert.equal(original.overridden, false);
  assert.equal(original.appPath, 'app/(one,two)/detail.tsx');
  await assert.rejects(store.readRouteSource('missing'), /imported route/);
  await store.execute(CommandSchema.parse({...identityOf(store.session()),requestId:'old-copy',label:'Old expanded map',operations:[
    {type:'screen.create',screen:{key:'detail-2',name:detail.name,source:'screens/route-detail-2.tsx',code:linkedRouteSource,notes:detail.notes,props:{route:{...route,key:'detail-2',fullPath:'/(two)/detail'},params:{}},links:detail.links}},
    {type:'screen.update',id:home.id,patch:{notes:'Keep my context',links:['detail-2']}},
  ]}));
  const before=store.session().project.document;
  await imports();
  const after=store.session().project.document;
  assert.equal(after.screenIds.length,2);
  assert.equal(after.screens[detail.id].id,detail.id);
  assert.equal(after.screens[home.id].notes,'Keep my context');
  assert.deepEqual(after.screens[home.id].links,['detail']);
  assert.equal((after.screens[detail.id].props.route as any).contexts.length,2);
  await assert.rejects(readFile(join(store.directory,'screens/route-detail-2.tsx')));
  await store.history('undo',identityOf(store.session()));
  assert.deepEqual(store.session().project.document,before);
  assert.equal(await readFile(join(store.directory,'screens/route-detail-2.tsx'),'utf8'),linkedRouteSource);
});


test('Back fallback replacements are excluded while ordinary replacement navigation remains content flow', () => {
 const source = `import {router as r} from 'expo-router';
 const dismiss=()=>{if(r.canGoBack()){r.back()}else{r.replace('/fallback')}};
 function next(){r.replace('/next')}
 if(r.canGoBack()){showPrompt()}else{r.replace('/ordinary')}`;
 assert.deepEqual(collectHrefs('app/detail.tsx',source),['/next','/ordinary']);
});
