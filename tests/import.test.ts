import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/runtime/project";
import { moduleSpecifiers } from "../src/runtime/import";
import { CommandSchema, identityOf } from "../src/shared/model";

async function fakeApp() {
  const app = await mkdtemp(join(tmpdir(), "expo-canvas-app-"));
  const write = async (path: string, code: string) => {
    await mkdir(join(app, path, ".."), { recursive: true });
    await writeFile(join(app, path), code);
  };
  await write("package.json", JSON.stringify({ name: "fake-app", dependencies: { "expo-router": "~57.0.0", "react-native-svg": "15.15.4", "pure-lib": "1.2.3" } }));
  await write("app.json", JSON.stringify({ expo: { name: "Fake App" } }));
  await write("tsconfig.json", '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/assets/*": ["./assets/*"] } } }');
  await write("src/theme/colors.ts", "export const colors = { label: '#111' };\n");
  await write("src/components/card.tsx", 'import { View } from "react-native";\nimport type { Circle } from "react-native-svg";\nimport { colors } from "@/theme/colors";\nexport function Card() { return <View style={{ backgroundColor: colors.label }} />; }\n');
  await write("src/screens/home.tsx", 'import { Stack } from "expo-router/stack";\nimport { router } from "expo-router";\nimport { MenuView } from "@expo/ui/community/menu";\nimport { Host } from "@expo/ui/swift-ui";\nimport { Card } from "@/components/card";\nexport function HomeScreen() { return <><Stack.Title>Home</Stack.Title><Card /></>; }\n');
  await write("src/app/(tabs)/home/index.tsx", 'import { HomeScreen } from "@/screens/home";\nexport default function Route() { return <HomeScreen />; }\n');
  await write("src/app/_layout.tsx", 'export default function Layout() { return null; }\n');
  await write("src/db/huge.ts", "// " + "x".repeat(120_000) + "\n");
  await write("src/util.test.ts", "export const skipped = true;\n");
  await write("src/lib/pure.ts", 'import { value } from "pure-lib";\nexport const doubled = value * 2;\n');
  await write("node_modules/pure-lib/package.json", JSON.stringify({ name: "pure-lib", version: "1.2.3", main: "index.js" }));
  await write("node_modules/pure-lib/index.js", "exports.value = 21;\n");
  return app;
}

test("moduleSpecifiers ignores type-only imports and finds dynamic imports", () => {
  const specifiers = moduleSpecifiers("lib/a.tsx", 'import type { A } from "a"; import { type B } from "b"; import { c } from "c"; export { d } from "d"; const e = require("e"); const f = () => import("f");');
  assert.deepEqual(specifiers.sort(), ["c", "d", "e", "f"]);
});

test("importing an existing app copies source into lib/, records provenance and classifies dependencies as one undoable transaction", async (t) => {
  const app = await fakeApp();
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-import-"));
  const store = await ProjectStore.initialize(directory, "Untitled app");
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(app, { recursive: true, force: true });
  });
  const request = { ...identityOf(store.session()), requestId: "import-1", from: app, modules: ["pure-lib"] };
  const result = await store.importSources(request);
  const report = result.import;
  assert.equal(report.name, "Fake App");
  assert.equal(report.root, "src");
  assert.deepEqual(report.aliases, { "@/": "lib/" });
  assert.deepEqual(report.files.map((file) => file.to).sort(), ["lib/components/card.tsx", "lib/lib/pure.ts", "lib/screens/home.tsx", "lib/theme/colors.ts"]);
  assert.ok(report.skipped.some((entry) => entry.from === "db/huge.ts" && /100 KB/.test(entry.reason)));
  assert.deepEqual(report.routes, [{ file: "src/app/(tabs)/home/index.tsx", route: "/home", imports: ["@/screens/home"] }]);
  const status = Object.fromEntries(report.dependencies.map((dependency) => [dependency.specifier, dependency.status]));
  assert.deepEqual(status, { "@expo/ui/community/menu": "missing", "@expo/ui/swift-ui": "host", "expo-router": "missing", "expo-router/stack": "missing", "pure-lib": "project", "react-native": "host" });
  const menu = report.dependencies.find((dependency) => dependency.specifier === "@expo/ui/community/menu");
  assert.ok(menu?.installed, "the host has @expo/ui installed");
  assert.match(menu?.note ?? "", /does not provide @expo\/ui\/community\/menu/);
  assert.equal(report.dependencies.find((dependency) => dependency.specifier === "expo-router")?.declared, "~57.0.0");
  assert.deepEqual(report.copiedModules, [{ name: "pure-lib", version: "1.2.3" }]);
  assert.equal(await readFile(join(directory, "node_modules/pure-lib/index.js"), "utf8"), "exports.value = 21;\n");
  assert.equal(JSON.parse(await readFile(join(directory, "package.json"), "utf8")).dependencies["pure-lib"], "1.2.3");
  assert.equal(await readFile(join(directory, "lib/theme/colors.ts"), "utf8"), "export const colors = { label: '#111' };\n");

  const session = store.session();
  assert.equal(session.project.document.name, "Fake App");
  assert.deepEqual(session.project.document.resolver, { aliases: { "@/": "lib/" }, modules: {} });
  assert.equal(session.project.document.origin?.path, await realpath(app));
  assert.equal(session.project.document.origin?.files["lib/theme/colors.ts"].from, "src/theme/colors.ts");
  assert.equal(session.project.document.origin?.files["lib/theme/colors.ts"].hash, session.sources.find((source) => source.path === "lib/theme/colors.ts")?.hash);
  assert.deepEqual(await store.importSources(request), result, "replaying the request returns its receipt");
  await assert.rejects(store.importSources({ ...request, requestId: "import-2" }), /changed/, "the sequence advanced");

  await store.history("undo", identityOf(store.session()));
  assert.equal(store.session().project.document.origin, undefined);
  await assert.rejects(readFile(join(directory, "lib/theme/colors.ts")));
  await store.history("redo", identityOf(store.session()));
  assert.equal(store.session().project.document.origin?.name, "Fake App");
  assert.match(await readFile(join(directory, "lib/screens/home.tsx"), "utf8"), /^import \{ Stack \} from "expo-router\/stack";/);
});

test("resolver.update maps a missing module to a project shim, changes the code version and can be undone", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-resolver-"));
  const store = await ProjectStore.initialize(directory, "Shims");
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const command = (operations: unknown[], requestId: string) =>
    CommandSchema.parse({ ...identityOf(store.session()), requestId, label: "Resolver", operations });
  await assert.rejects(
    store.execute(command([{ type: "resolver.update", modules: { "expo-router": "lib/shims/expo-router.tsx" } }], "missing")),
    /missing project file/,
  );
  const before = store.session().codeVersion;
  await store.execute(command([
    { type: "source.write", path: "lib/shims/expo-router.tsx", expectedHash: null, code: "export const router = { push() {} };\n" },
    { type: "resolver.update", modules: { "expo-router": "lib/shims/expo-router.tsx", "expo-router/stack": "lib/shims/expo-router.tsx" }, aliases: { "~/": "lib/" } },
  ], "shim"));
  assert.deepEqual(store.session().project.document.resolver, {
    aliases: { "~/": "lib/" },
    modules: { "expo-router": "lib/shims/expo-router.tsx", "expo-router/stack": "lib/shims/expo-router.tsx" },
  });
  assert.notEqual(store.session().codeVersion, before, "Metro resolution is part of the code version");
  await store.execute(command([{ type: "resolver.update", modules: { "expo-router/stack": null }, aliases: { "~/": null } }], "remove"));
  assert.deepEqual(store.session().project.document.resolver, { aliases: {}, modules: { "expo-router": "lib/shims/expo-router.tsx" } });
  assert.throws(() => command([{ type: "resolver.update", modules: { "../evil": "lib/shims/expo-router.tsx" } }], "invalid"));
  await store.history("undo", identityOf(store.session()));
  await store.history("undo", identityOf(store.session()));
  assert.equal(store.session().project.document.resolver, undefined);
  await assert.rejects(readFile(join(directory, "lib/shims/expo-router.tsx")));
});

test("origin diff reviews diverged and added lib files, and apply writes them back only on request", async (t) => {
  const { originApply, originDiff } = await import("../src/runtime/origin");
  const app = await fakeApp();
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-origin-"));
  const store = await ProjectStore.initialize(directory, "Origin review");
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(app, { recursive: true, force: true });
  });
  await store.importSources({ ...identityOf(store.session()), requestId: "import", from: app });
  const command = (operations: unknown[], requestId: string) =>
    CommandSchema.parse({ ...identityOf(store.session()), requestId, label: "Direction", operations });
  const colorsHash = store.session().sources.find((source) => source.path === "lib/theme/colors.ts")!.hash;
  await store.execute(command([
    { type: "source.write", path: "lib/theme/colors.ts", expectedHash: colorsHash, code: "export const colors = { label: '#222', accent: '#e2c373' };\n" },
    { type: "source.write", path: "lib/screens/week.tsx", expectedHash: null, code: "export function WeekScreen() { return null; }\n" },
  ], "direction"));
  const review = await originDiff(store);
  const byPath = Object.fromEntries(review.entries.map((entry) => [entry.path, entry]));
  assert.equal(review.origin.root, "src");
  assert.equal(byPath["lib/theme/colors.ts"].status, "diverged");
  assert.equal(byPath["lib/theme/colors.ts"].target, "src/theme/colors.ts");
  assert.match(byPath["lib/theme/colors.ts"].diff, /^--- a\/src\/theme\/colors\.ts\n\+\+\+ b\/src\/theme\/colors\.ts\n@@ -1,1 \+1,1 @@\n-export const colors = \{ label: '#111' \};\n\+export const colors = \{ label: '#222', accent: '#e2c373' \};\n$/);
  assert.equal(byPath["lib/screens/week.tsx"].status, "added");
  assert.equal(byPath["lib/screens/week.tsx"].target, "src/screens/week.tsx");
  assert.match(byPath["lib/screens/week.tsx"].diff, /^--- \/dev\/null\n/);
  assert.equal(byPath["lib/components/card.tsx"].status, "unchanged");
  assert.equal(byPath["lib/screens/week.tsx"].candidate, true);
  await store.execute(command([{ type: "source.write", path: "lib/shims/expo-router.tsx", expectedHash: null, code: "export const router = {};\n" }], "shim"));
  const shim = (await originDiff(store)).entries.find((entry) => entry.path === "lib/shims/expo-router.tsx");
  assert.equal(shim?.status, "added");
  assert.equal(shim?.candidate, false, "shims never belong in the app");
  await assert.rejects(originApply(store, { ...identityOf(store.session()), files: ["lib/shims/expo-router.tsx"] }), /canvas-only/);
  assert.equal((await originDiff(store, ["lib/screens/week.tsx"])).entries.length, 1);

  const applied = await originApply(store, { ...identityOf(store.session()), files: ["lib/theme/colors.ts", "lib/screens/week.tsx"] });
  assert.deepEqual(applied.written.map((file) => file.to).sort(), ["src/screens/week.tsx", "src/theme/colors.ts"]);
  assert.equal(await readFile(join(app, "src/theme/colors.ts"), "utf8"), "export const colors = { label: '#222', accent: '#e2c373' };\n");
  assert.equal(await readFile(join(app, "src/screens/week.tsx"), "utf8"), "export function WeekScreen() { return null; }\n");
  assert.equal(await readFile(join(app, "src/components/card.tsx"), "utf8"), 'import { View } from "react-native";\nimport type { Circle } from "react-native-svg";\nimport { colors } from "@/theme/colors";\nexport function Card() { return <View style={{ backgroundColor: colors.label }} />; }\n', "untouched files stay untouched");

  await writeFile(join(app, "src/theme/colors.ts"), "// edited in the app meanwhile\n");
  await assert.rejects(originApply(store, { ...identityOf(store.session()), files: ["lib/theme/colors.ts"] }), /changed in the app since the import/);
  await assert.rejects(originApply(store, { ...identityOf(store.session()), files: ["lib/screens/week.tsx"] }), /already exists/);
  await originApply(store, { ...identityOf(store.session()), files: ["lib/theme/colors.ts"], force: true });
  assert.equal(await readFile(join(app, "src/theme/colors.ts"), "utf8"), "export const colors = { label: '#222', accent: '#e2c373' };\n");
  await assert.rejects(originApply(store, { ...identityOf(store.session()), files: ["screens/home.tsx"] }), /not an imported or added lib/);
});

test("a linked import runs the app in place: no copies, an absolute alias, app-path overrides, and review against the app", async (t) => {
  const { originApply, originDiff } = await import("../src/runtime/origin");
  const app = await fakeApp();
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-linked-"));
  const store = await ProjectStore.initialize(directory, "Linked");
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(app, { recursive: true, force: true });
  });
  const result = await store.importSources({ ...identityOf(store.session()), requestId: "link", from: app, link: true });
  const root = await realpath(app);
  assert.equal(result.import.mode, "linked");
  assert.deepEqual(result.import.files, [], "nothing is copied");
  assert.deepEqual(result.import.aliases, { "@/": `${root}/src/` });
  assert.equal(store.session().sources.length, 0);
  assert.equal(store.session().project.document.origin?.mode, "linked");
  assert.equal(store.session().project.document.origin?.root, "src");
  const status = Object.fromEntries(result.import.dependencies.map((dependency) => [dependency.specifier, dependency.status]));
  assert.equal(status["pure-lib"], "app", "the app's own JavaScript-only package serves it in place");
  assert.equal(status["react-native"], "host");
  assert.equal(status["expo-router"], "missing");

  const command = (operations: unknown[], requestId: string) =>
    CommandSchema.parse({ ...identityOf(store.session()), requestId, label: "Overrides", operations });
  await assert.rejects(
    store.execute(command([{ type: "resolver.update", aliases: { "~/": "/somewhere/else/" } }], "outside")),
    /inside the linked app/,
  );
  await store.execute(command([
    { type: "source.write", path: "lib/theme/colors.ts", expectedHash: null, code: "export const colors = { label: '#222' };\n" },
    { type: "source.write", path: "lib/screens/week.tsx", expectedHash: null, code: "export function WeekScreen() { return null; }\n" },
    { type: "resolver.update", modules: { "src/theme/colors.ts": "lib/theme/colors.ts", "src/screens/week.tsx": "lib/screens/week.tsx" } },
  ], "override"));
  const review = await originDiff(store);
  const byPath = Object.fromEntries(review.entries.map((entry) => [entry.path, entry]));
  assert.equal(review.origin.mode, "linked");
  assert.equal(byPath["lib/theme/colors.ts"].status, "diverged");
  assert.equal(byPath["lib/theme/colors.ts"].target, "src/theme/colors.ts");
  assert.match(byPath["lib/theme/colors.ts"].diff, /^--- a\/src\/theme\/colors\.ts\n\+\+\+ b\/src\/theme\/colors\.ts\n/);
  assert.equal(byPath["lib/screens/week.tsx"].status, "added");
  assert.equal(byPath["lib/screens/week.tsx"].target, "src/screens/week.tsx");
  assert.equal(review.entries.length, 2, "only overrides are reviewable in a linked project");
  await assert.rejects(originApply(store, { ...identityOf(store.session()), files: ["lib/other.ts"] }), /does not stand for an app file/);
  const applied = await originApply(store, { ...identityOf(store.session()), files: ["lib/screens/week.tsx"] });
  assert.deepEqual(applied.written, [{ path: "lib/screens/week.tsx", to: "src/screens/week.tsx" }]);
  assert.equal(await readFile(join(app, "src/screens/week.tsx"), "utf8"), "export function WeekScreen() { return null; }\n");
  await store.history("undo", identityOf(store.session()));
  await store.history("undo", identityOf(store.session()));
  assert.equal(store.session().project.document.origin, undefined, "the linked import undoes like any transaction");
});
