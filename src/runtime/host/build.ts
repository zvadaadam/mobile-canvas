/**
 * Builds the native canvas: an Expo 54 iOS app compiled and signed to run
 * directly on this Apple-silicon Mac. Installed builds use the user's cache.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, cp, symlink, rm, copyFile, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { repository } from "../paths";
import { prepareBuildScripts } from "./build-scripts";
import { copyTemplate } from "./copy-template";
import { authoredHostPaths, signingTeam, sourceCheckout, nativeAppPath } from "../installation";

const { values } = parseArgs({ options: { team: { type: "string" }, incremental: { type: "boolean" }, host: { type: "string" }, output: { type: "string" } } });
const host = values.host ?? authoredHostPaths.host;
const output = values.output ?? authoredHostPaths.output;
await mkdir(output, { recursive: true });
const saved = JSON.parse(await readFile(join(output, 'signing.json'), 'utf8').catch(() => '{}'));
const team = values.team ?? await signingTeam() ?? saved.team;
if (!team || !/^[A-Z0-9]{10}$/.test(team))
  throw new Error("Run expo-canvas setup --team YOURTEAMID before building. Native iOS-on-Mac execution needs development signing.");
await writeFile(join(output, "signing.json"), JSON.stringify({ team }), { mode: 0o600 });

async function run(command: string, args: string[], cwd: string, logName: string, extraEnv: Record<string, string> = {}) {
  const outputLog = await open(join(output, logName), "w", 0o600);
  const child = spawn(command, args, { cwd, env: { ...process.env, EXPO_NO_TELEMETRY: "1", ...extraEnv }, stdio: ["ignore", outputLog.fd, outputLog.fd] });
  await outputLog.close();
  const code = await new Promise<number | null>((done, fail) => { child.on("error", fail); child.on("exit", done); });
  const log = await readFile(join(output, logName), "utf8");
  if (code !== 0) throw new Error(`${command} failed (${code}). ${log.split("\n").slice(-15).join("\n")} See ${join(output, logName)}`);
}
// Installed templates stay immutable; only the per-user host copy is built.
if (!values.host && !sourceCheckout) {
  await mkdir(host, { recursive: true });
  for (const name of await readdir(join(repository, 'apps/native-host')))
    await copyTemplate(join(repository, 'apps/native-host', name), join(host, name));
  await copyTemplate(join(repository, 'apps/native-host/dependencies.lock'), join(host, 'package-lock.json'));
  const tsconfig = JSON.parse(await readFile(join(host, 'tsconfig.json'), 'utf8'));
  tsconfig.compilerOptions.paths['@expo-canvas/preview'] = [join(repository, 'packages/preview/index.tsx')];
  await writeFile(join(host, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  if (!existsSync(join(host, 'node_modules/expo/package.json'))) {
    console.log('Installing the authored-screen host dependencies…');
    await run('npm', ['ci', '--no-audit', '--no-fund'], host, 'install.log');
  }
}
const sdk = Number(JSON.parse(await readFile(join(host, 'node_modules/expo/package.json'), 'utf8')).version.split('.')[0]);
const plist = (file: string) => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));

const scriptsChanged = await prepareBuildScripts(host);
if (!values.incremental) {
  console.log(`Preparing the Expo ${sdk} native host…`);
  await run(process.execPath, ["node_modules/expo/bin/cli", "prebuild", "--platform", "ios", "--no-install"], host, "prebuild.log");
  await run("pod", ["install"], join(host, "ios"), "pods.log");
} else {
  if (scriptsChanged) await run("pod", ["install"], join(host, "ios"), "pods.log");
  // Swift sources and assets are copied over the generated project; native dependencies are untouched.
  const appDirectory = (await readdir(join(host, "ios"))).find((name) => existsSync(join(host, "ios", name, "AppDelegate.swift")));
  if (!appDirectory) throw new Error("Run one full native host build before --incremental.");
  await copyFile(join(host, "native/CanvasHost.swift"), join(host, "ios", appDirectory, "AppDelegate.swift"));
  for (const name of ["CanvasInspector.swift", "CanvasRenderer.swift", "ExpoRenderer.swift"])
    await copyFile(join(host, "native", name), join(host, "ios", appDirectory, name));
  for (const asset of (await readdir(join(host, "assets"))).filter((name) => /\.(imageset|dataset)$/.test(name)))
    await cp(join(host, "assets", asset), join(host, "ios", appDirectory, "Images.xcassets", asset), { recursive: true });
}
const workspace = (await readdir(join(host, "ios"))).find((file) => file.endsWith(".xcworkspace"));
if (!workspace) throw new Error("Expo did not generate an Xcode workspace.");
const scheme = workspace.slice(0, -".xcworkspace".length);
console.log("Compiling and signing for iOS on Mac…");
await run("xcodebuild", ["-workspace", join(host, "ios", workspace), "-scheme", scheme,
  "-configuration", "Debug", "-destination", "platform=macOS,variant=Designed for iPad",
  "-derivedDataPath", join(output, "DerivedData"), "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration",
  "-jobs", "4", `DEVELOPMENT_TEAM=${team}`, "CODE_SIGN_STYLE=Automatic", "ENABLE_USER_SCRIPT_SANDBOXING=NO",
  ...(values.host ? ["OTHER_SWIFT_FLAGS=$(inherited) -D CANVAS_MATCHED_HOST"] : []), "build"], repository, "build.log", { SKIP_BUNDLING: "1" });
const products = join(output, "DerivedData/Build/Products/Debug-iphoneos");
const bundleId = JSON.parse(await readFile(join(host, "app.json"), "utf8")).expo.ios.bundleIdentifier;
const matches = (await readdir(products)).filter((file) => file.endsWith(".app") && plist(join(products, file, "Info.plist")).CFBundleIdentifier === bundleId);
if (matches.length !== 1) throw new Error("Expected exactly one built native canvas application.");
const built = matches[0];
const wrapper = nativeAppPath(output);
await rm(wrapper, { recursive: true, force: true });
await mkdir(join(wrapper, "Wrapper"), { recursive: true });
await cp(join(products, built), join(wrapper, "Wrapper", built), { recursive: true });
await symlink(`Wrapper/${built}`, join(wrapper, "WrappedBundle"));
const info = plist(join(products, built, "Info.plist"));
await writeFile(join(output, "build.json"), JSON.stringify({ app: wrapper, bundleId: info.CFBundleIdentifier, executable: info.CFBundleExecutable, sdk, builtAt: new Date().toISOString() }, null, 2));
console.log(`Built ${wrapper}`);
