import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile, open, access, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { repository } from "../paths";
import { appDependencies, dependencyIssue } from "../adapters/expo/app-dependencies";
import { createRequire } from "node:module";
import { sharedFontLoader } from "./fonts";
import { copyTemplate } from "./copy-template";
import { stageNativeCanvas } from "./canvas-template";
import { writeFileAtomically } from "../atomic-file";
const { excluded, iconPackages } = createRequire(import.meta.url)(join(repository, "apps/linked-host/design/environment.cjs")) as { excluded: string[]; iconPackages: string[] };

export const matchedHostPaths = (project: string) => ({
  host: join(project, ".expo-canvas/native-host"),
  output: join(project, ".expo-canvas/native-build"),
});

async function run(command: string, args: string[], cwd: string, log: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const file = await open(log, "w", 0o600);
  const child = spawn(command, args, { cwd, detached: true, env: { ...process.env, EXPO_NO_TELEMETRY: "1" }, stdio: ["ignore", file.fd, file.fd] });
  const stop = () => { if (child.pid) try { process.kill(-child.pid, "SIGTERM"); } catch {} };
  signal?.addEventListener("abort", stop, { once: true });
  await file.close();
  let code;
  try { code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); }); }
  finally { signal?.removeEventListener("abort", stop); }
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(`Native app host preparation failed (${code}). See ${log}:\n${(await readFile(log, "utf8")).split("\n").slice(-12).join("\n")}`);
}

/** Build inputs live in the experiment. The linked application's files are only read. */
export async function prepareMatchedHost(project: string, app: string, signal?: AbortSignal) {
  const installedApp = await appDependencies(app);
  const document = JSON.parse(await readFile(join(project, "expo-canvas.json"), "utf8").catch(() => "{}"))?.document;
  const offline = !!document?.appPreview?.offline;
  const substitutes = offline ? [...excluded, ...iconPackages] : [];
  const installIssue = dependencyIssue({ ...installedApp, missing: installedApp.missing.filter(name => !substitutes.includes(name)) });
  if (installIssue) throw new Error(installIssue);
  const { host, output } = matchedHostPaths(project);
  await mkdir(host, { recursive: true });
  await mkdir(output, { recursive: true });
  const source = join(repository, "apps/native-host");
  const previousPlugin = await readFile(join(host, "with-native-canvas.cjs"), "utf8").catch(() => "");
  const previousConfig = await readFile(join(host, "app.json"), "utf8").catch(() => "");
  const hashModules = async (directory: string) => {
    const hash = createHash("sha256");
    const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const file of entries.filter(file => file.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)))) {
      hash.update(join(file.parentPath, file.name).slice(directory.length));
      hash.update(await readFile(join(file.parentPath, file.name)));
    }
    return hash.digest("hex");
  };
  const modulesChanged = await hashModules(join(app, "modules")) !== await hashModules(join(host, "modules"));
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  const dependencies: Record<string, string> = {};
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    // Canvas owns launch and reload; app deployment clients must not replace its root.
    if (name === "expo-dev-client" || name === "expo-updates") continue;
    if (substitutes.includes(name)) continue;
    dependencies[name] = installedApp.versions[name];
  }
  if (offline && iconPackages.some(name => pkg.dependencies?.[name])) dependencies["@hugeicons/core-free-icons"] = "4.3.2";
  const sdk = Number(dependencies.expo?.split(".")[0]);
  if (sdk !== 56 && sdk !== 57) throw new Error(`Automatic app rendering currently supports Expo 56 and 57; this app uses Expo ${sdk}. The Expo 54 authored-screen host remains available.`);
  if (!dependencies["expo-router"]) throw new Error("Automatic app rendering requires Expo Router.");
  // Package patches are part of the app, including when they only affect JS.
  // Preserve Bun's declared patches in the separate host and invalidate its cache.
  const patchedDependencies: Record<string, string> = {};
  const dependencyHash = createHash("sha256").update("shared-fonts-v1").update(JSON.stringify(dependencies));
  let lock: { name: string; contents: Buffer } | undefined;
  for (const name of ["bun.lock", "bun.lockb", "package-lock.json"]) {
    try { lock = { name, contents: await readFile(join(app, name)) }; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (lock) dependencyHash.update(lock.name).update(lock.contents);
  for (const [name, patch] of Object.entries(pkg.patchedDependencies ?? {}).sort()) {
    if (typeof patch !== "string" || !resolve(app, patch).startsWith(app + sep)) throw new Error(`Invalid package patch path for ${name}.`);
    const contents = await readFile(resolve(app, patch));
    const target = `patches/${createHash("sha256").update(name).digest("hex")}.patch`;
    await mkdir(join(host, "patches"), { recursive: true });
    await writeFile(join(host, target), contents);
    patchedDependencies[name] = target;
    dependencyHash.update(name).update(contents);
  }
  const dependencyKey = dependencyHash.digest("hex");
  let installedKey = "";
  try { installedKey = await readFile(join(host, ".dependencies"), "utf8"); } catch {}
  if (installedKey !== dependencyKey) {
    const patched = Object.keys(patchedDependencies).length > 0;
    const bun = patched || lock?.name.startsWith("bun.lock");
    // Pin transitive packages too: mixing a newer modules-core with an app's
    // older precompiled Expo modules can build successfully but fail in dyld.
    if (lock) await writeFile(join(host, lock.name), lock.contents);
    await writeFile(join(host, "package.json"), JSON.stringify({ name: "expo-canvas-linked-host", version: "0.1.0", private: true, main: "index.tsx", dependencies, expo: { autolinking: { ios: { buildFromSource: ["expo-font"] } } }, ...(patched ? { patchedDependencies } : {}) }, null, 2));
    console.log(`Installing the app's Expo ${sdk} dependencies in its separate canvas host…`);
    await run(bun ? "bun" : "npm", bun ? ["install"] : ["install", "--no-audit", "--no-fund"], host, join(output, "install.log"), signal);
    await writeFile(join(host, ".dependencies"), dependencyKey);
  }
  let fontSource = "";
  if (dependencies["expo-font"]) {
    const fontFile = join(host, "node_modules/expo-font/ios/FontLoaderModule.swift");
    fontSource = sharedFontLoader(await readFile(fontFile, "utf8"));
    // Atomic replacement avoids modifying a package-manager hardlink in the source app.
    await writeFileAtomically(fontFile, fontSource);
  }
  for (const name of ["index.tsx", "Screen.tsx", "Boundary.tsx", "UnavailablePreview.tsx", "frame-errors.ts", "console.ts", "registry.d.ts", "with-native-canvas.cjs", "native"])
    await copyTemplate(join(source, name), join(host, name));
  await stageNativeCanvas(host);
  for (const name of ["metro.cjs", "LinkedApp.tsx", "RouteObserver.ts", "PagerPreview.ts", "GuardPreview.ts", "FrameNavigation.ts", "route-location.ts", "babel.config.cjs", "preview-routes.cjs", "SQLite.ts", "MMKV.ts", "FrameDimensions.ts", "context.d.ts", "design"])
    await copyTemplate(join(repository, "apps/linked-host", name), join(host, name === "metro.cjs" ? "metro.config.cjs" : name));
  if (offline) await writeFile(join(host, "index.tsx"), "import './design/Network';\n" + await readFile(join(source, "index.tsx"), "utf8"));
  await copyTemplate(join(repository, "src/shared/route-samples.ts"), join(host, "route-samples.ts"));
  const tsconfig = JSON.parse(await readFile(join(source, "tsconfig.json"), "utf8"));
  tsconfig.compilerOptions.paths["@expo-canvas/preview"] = [join(repository, "packages/preview/index.tsx")];
  tsconfig.include = ["*.ts", "*.tsx"];
  await writeFile(join(host, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  if (modulesChanged) await rm(join(host, "modules"), { recursive: true, force: true });
  try { await access(join(app, "modules")); if (modulesChanged) await cp(join(app, "modules"), join(host, "modules"), { recursive: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = JSON.parse(await readFile(join(source, "app.json"), "utf8"));
  config.expo.name = "Expo Canvas Linked";
  config.expo.slug = "expo-canvas-linked";
  config.expo.scheme = "expo-canvas-linked";
  config.expo.ios.bundleIdentifier = "dev.expocanvas.linked.p" + createHash("sha256").update(project).digest("hex").slice(0, 12);
  config.expo.ios.infoPlist.CanvasExpoSDK = sdk;
  config.expo.plugins = ["./with-native-canvas.cjs", ...["expo-sqlite", "expo-font", "expo-video", "expo-web-browser", "expo-asset", "expo-location"].filter(name => dependencies[name])];
  await writeFile(join(host, "app.json"), JSON.stringify(config, null, 2));
  const design = offline ? { services: [...excluded, "convex", "expo-speech-recognition"].filter(name => pkg.dependencies?.[name]), auth: "signed-out local state", data: "app local data; remote queries disconnected", icons: iconPackages.filter(name => pkg.dependencies?.[name]), iconReplacement: "public Hugeicons stroke icons; Pro styling differs", network: "external JavaScript fetch/XHR disabled", storeUI: "unavailable placeholder", recording: "disconnected; permission-denied UI" } : null;
  const pagers = [...new Map(Object.values(document.screens ?? {}).map((screen: any) => screen.props?.route?.step?.pager).filter(Boolean).map((pager: any) => [pager.file, pager])).values()];
  const guardEdges = Object.values(document.screens ?? {}).flatMap((screen: any) => screen.props?.route?.guardTransitions ?? []);
  const guards = [...new Set(guardEdges.map((edge: any) => edge.file))].map(file => ({ file, atoms: [...new Set(guardEdges.filter((edge: any) => edge.file === file).flatMap((edge: any) => Object.keys(edge.before)))] }));
  const routeFiles = [...new Set(Object.values(document.screens ?? {}).map((screen: any) => screen.props?.route?.file).filter(Boolean))];
  await writeFile(join(host, "canvas-host.json"), JSON.stringify({ repository, app, project, sdk, design, pagers, guards, routeFiles, frameMMKV: dependencies["react-native-mmkv"]?.startsWith("4.") ?? false }));
  const nativeHash = createHash("sha256").update("quoted-build-paths-v1").update(dependencyKey).update(JSON.stringify(config)).update(fontSource);
  for (const folder of ["native", "assets", "modules"]) {
    const files = await readdir(join(host, folder), { recursive: true, withFileTypes: true }).catch(() => []);
    for (const file of files.filter(file => file.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name))))
      nativeHash.update(join(file.parentPath, file.name)).update(await readFile(join(file.parentPath, file.name)));
  }
  nativeHash.update(await readFile(join(host, "with-native-canvas.cjs")));
  const fingerprint = nativeHash.digest("hex");
  const builtDependencies = await readFile(join(output, "dependencies"), "utf8").catch(() => "");
  try {
    if (builtDependencies === dependencyKey && await readFile(join(output, "fingerprint"), "utf8") === fingerprint) {
      await access(JSON.parse(await readFile(join(output, "build.json"), "utf8")).app);
      return { host, output, sdk };
    }
  } catch {}
  console.log(`Building the app's native canvas host (Expo ${sdk})…`);
  const incremental = builtDependencies === dependencyKey && !modulesChanged && previousPlugin === await readFile(join(host, "with-native-canvas.cjs"), "utf8") && previousConfig === JSON.stringify(config, null, 2)
    && await access(join(host, "ios/Podfile.lock")).then(() => true, () => false);
  if (!incremental) {
    // This generated target's pod snapshot belongs to the old native inputs.
    await rm(join(host, "ios/Podfile.lock"), { force: true });
    await rm(join(host, "ios/Pods/Manifest.lock"), { force: true });
  }
  await run(process.execPath, ["--import", "tsx", join(repository, "src/runtime/host/build.ts"), "--host", host, "--output", output, ...(incremental ? ["--incremental"] : [])], repository, join(output, "prepare.log"), signal);
  await writeFile(join(output, "fingerprint"), fingerprint);
  await writeFile(join(output, "dependencies"), dependencyKey);
  return { host, output, sdk };
}
