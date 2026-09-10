/**
 * Starts Metro for one project and opens the built native canvas against it.
 * The runtime spawns this per canvas session and reads its EXPO_CANVAS_ lines:
 * ERROR ends the session with a reason, NOTE explains a close.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFile, open, access } from "node:fs/promises";
import { reserveMetroPort } from "./ports";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { repository } from "../paths";
import { inspectEnvironment } from "../environment";
import { prepareMatchedHost } from "./matched";

let host = join(repository, "apps/native-host");
let output = join(repository, ".context/native-studio");
const { values } = parseArgs({ options: { project: { type: "string" }, runtime: { type: "string" }, "host-id": { type: "string" } } });
if (!values.project || !/^http:\/\/127\.0\.0\.1:\d+$/.test(values.runtime ?? "") || !values["host-id"])
  throw new Error("A project, loopback runtime and native host identity are required.");
const project = resolve(values.project);
const runtime = values.runtime!;
const hostId = values["host-id"]!;
let metro: ChildProcess | undefined;
let ipv4: ChildProcess | undefined;
let closing = false;
let nativePid: number | undefined;
let executable: string | undefined;
const preparation = new AbortController();

function close(code = 0, reason = "launcher exit"): never {
  if (!closing) {
    closing = true;
    preparation.abort();
    // The reason reaches studio state logs, so a silent native exit is never a mystery.
    console.error(`EXPO_CANVAS_NOTE: closing native studio (${reason})`);
    metro?.kill("SIGTERM");
    ipv4?.kill("SIGTERM");
    // A failed launch can leave the native process alive before its first receipt.
    // Its unique host-id still proves ownership; never stop another canvas session.
    if (!nativePid && executable) {
      try {
        const row = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n")
          .find(line => line.includes(`/${executable}.app/${executable} `) && line.trimEnd().endsWith(`--host-id ${hostId}`));
        if (row) nativePid = Number(row.trim().split(/\s+/)[0]);
      } catch {}
    }
    // Verify the actual executable before stopping our app; PID reuse must never target another process.
    if (nativePid && executable) {
      try {
        const command = execFileSync("ps", ["-p", String(nativePid), "-o", "comm="], { encoding: "utf8" }).trim();
        if (command.endsWith(`/${executable}.app/${executable}`)) process.kill(nativePid, "SIGTERM");
      } catch {}
    }
  }
  process.exit(code);
}
process.on("SIGTERM", () => close(0, "SIGTERM"));
process.on("SIGINT", () => close(0, "SIGINT"));

const listening = (url: string, timeout = 500) => fetch(url, { signal: AbortSignal.timeout(timeout) }).then((response) => response.ok, () => false);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));


try {
  const manifest = JSON.parse(await readFile(join(project, "expo-canvas.json"), "utf8"));
  if (manifest.document.appPreview && manifest.document.origin?.mode === "linked") {
    const hasBuild = await access(join(project, ".expo-canvas/native-build/build.json")).then(() => true, () => false);
    if (!hasBuild) {
      const environment = await inspectEnvironment({ project, app: manifest.document.origin.path, offline: manifest.document.appPreview.offline });
      const missing = environment.checks.filter(check => check.status === "missing");
      if (missing.length) throw new Error(`Native setup is incomplete. ${missing.map(check => `${check.id}: ${check.detail} ${check.action}`).join(" ")} Run expo-canvas setup --app <app> for the full checklist.`);
    }
    const matched = await prepareMatchedHost(project, manifest.document.origin.path, preparation.signal);
    host = matched.host;
    output = matched.output;
  }
  const build = JSON.parse(await readFile(join(output, "build.json"), "utf8").catch(error => {
    if (error.code === "ENOENT") throw new Error("Build the native host first with npm run studio:build -- --team <development-team>.");
    throw error;
  }));
  executable = build.executable;
  const { port } = await reserveMetroPort();
  const log = await open(join(output, "metro.log"), "a", 0o600);
  metro = spawn(process.execPath, ["node_modules/expo/bin/cli", "start", "--localhost", "--port", String(port)], {
    cwd: host,
    env: { ...process.env, EXPO_CANVAS_PROJECT: project, EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1" },
    stdio: ["ignore", log.fd, log.fd],
  });
  await log.close();
  metro.on("error", (error) => { console.error(`EXPO_CANVAS_ERROR: ${error.message}`); close(1); });
  metro.on("exit", (code) => { if (!closing) { console.error(`EXPO_CANVAS_ERROR: Metro stopped (${code}).`); close(1, "metro exit"); } });
  let ready = false;
  for (let attempt = 0; attempt < 240 && !ready; attempt++) {
    ready = (await listening(`http://[::1]:${port}/status`)) || (await listening(`http://127.0.0.1:${port}/status`));
    if (!ready) await wait(250);
  }
  if (!ready) throw new Error("Metro did not become ready. See .context/native-studio/metro.log.");
  if (!(await listening(`http://127.0.0.1:${port}/status`))) {
    ipv4 = spawn(process.execPath, ["--import", "tsx", join(repository, "src/runtime/host/metro-ipv4.ts")], {
      cwd: repository, env: { ...process.env, EXPO_CANVAS_METRO_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
    });
    ipv4.on("error", (error) => { console.error(`EXPO_CANVAS_ERROR: ${error.message}`); close(1); });
    ipv4.on("exit", (code) => { if (!closing) { console.error(`EXPO_CANVAS_ERROR: Metro loopback adapter stopped (${code}).`); close(1); } });
    for (let attempt = 0; attempt < 40 && !(await listening(`http://127.0.0.1:${port}/status`)); attempt++) await wait(50);
  }
  // A listening Metro process does not imply that the project's imports compile.
  const bundle = await fetch(`http://127.0.0.1:${port}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false`, { signal: AbortSignal.timeout(90_000) });
  if (!bundle.ok) {
    const details = await bundle.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(`Native bundle failed: ${String(details?.message ?? details?.error ?? bundle.statusText).slice(0, 1200)} See .context/native-studio/metro.log.`);
  }
  await bundle.arrayBuffer();
  execFileSync("open", ["-n", build.app, "--args", "--canvas-runtime", runtime, "--metro-port", String(port), "--host-id", hostId], { stdio: "pipe" });
  console.log(`Native Studio opened · Expo ${build.sdk} · Metro ${port}`);
  const started = Date.now();
  // The runtime is single-threaded and sometimes busy (imports, diffs, hashing); one slow answer
  // must not end the native session. Only repeated silence does.
  let misses = 0;
  setInterval(async () => {
    try {
      let state: { hostId?: string; host?: { pid?: number } };
      try {
        state = (await fetch(`${runtime}/api/studio/state`, { signal: AbortSignal.timeout(4000) }).then((response) => response.json())) as typeof state;
        misses = 0;
      } catch (error) {
        misses += 1;
        console.error(`EXPO_CANVAS_NOTE: runtime did not answer (${misses}/5): ${(error as Error).message}`);
        if (misses < 5) return;
        throw new Error(`The runtime stopped answering (${(error as Error).message}).`);
      }
      if (state.hostId !== hostId) return close(0, `runtime host changed to ${state.hostId}`);
      if (state.host?.pid) nativePid = state.host.pid;
      // Backgrounding, a debugger or a busy JS thread can delay receipts. Only
      // process exit ends this session; heartbeat age describes readiness, not ownership.
      if (nativePid) {
        try { process.kill(nativePid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return close(0, `native process ${nativePid} exited on its own`); throw error; }
      }
      if (!nativePid && Date.now() - started > 60_000) throw new Error("The native app did not connect. Check its window and development signing.");
    } catch (error) { console.error(`EXPO_CANVAS_ERROR: ${(error as Error).message}`); close(1); }
  }, 1000);
} catch (error) {
  console.error(`EXPO_CANVAS_ERROR: ${(error as Error).message}`);
  close(1);
}
