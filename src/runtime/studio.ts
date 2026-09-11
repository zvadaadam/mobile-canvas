import { adapterForDocument } from "./adapters/index";
import { nativeCanvas } from "./host/canvas-template";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StudioControlSchema, StudioInspectSchema, StudioReportSchema, StudioCaptureSchema, StudioOpenSchema, SnapshotSchema, type StudioReport } from "../shared/studio";
import { digest, type ProjectStore } from "./project";
import { CanvasError } from "./errors";
import { repository } from "./paths";
import { cacheDirectory, nativeAppPath } from "./installation";
import { identityOf, type Operation, type Screen } from "../shared/model";
import { chooseRouteExample, routeExamples } from "./adapters/expo/route-examples";
import { paramsForScreenRoute } from "../shared/route-samples";

type Receipt = StudioReport & { receivedAt: number };
/** Frames are created for every screen; the host mounts React roots as they scroll into view and keeps them. */

type Pending = { id: number; type: "focus" | "reset" | "fit" | "stop" | "capture" | "zoom"; screenId?: string; scale?: number; from?: string };

/** Disposable native-host presence over the existing project, never another document. */
export class NativeStudio {
  private child?: ChildProcess;
  private hostId: string | null = null;
  private host?: Receipt;
  private screens = new Map<string, Receipt>();
  private commands = new Map<string, Pending>();
  private commandId = 0;
  private error: string | null = null;
  private logs: string[] = [];
  private capturing = false;
  private inspecting = false;
  private inspection: { screenId: string; status: "capturing" | "captured"; expiresAt: number } | null = null;
  private snapshots = new Map<number, Buffer>();
  private resolverVersion: string | null = null;
  private sdk = 54;
  private exampleTimer?: ReturnType<typeof setTimeout>;
  private applyingExamples = false;
  // Undo must stay undone for this session. Reset state explicitly retries discovery.
  private sampledScreens = new Set<string>();
  /** A screen to reveal at 100% once the host has laid out its frames, like opening a URL. */
  private reveal: string | null = null;
  constructor(private store: ProjectStore, private launch: typeof spawn = spawn) {}
  private get maxScreens() { return this.store.session().project.document.nativePreview ? 128 : 32; }
  private buildOutput() {
    const document = this.store.session().project.document;
    return adapterForDocument(document).paths(this.store.directory, document).output;
  }
  private foreground() {
    return new Promise<void>((resolve, reject) => {
      const child = this.launch("open", ["-a", nativeAppPath(this.buildOutput())], { stdio: "ignore" });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new CanvasError("studio_activation", "Could not bring this native canvas forward.")));
    });
  }
  private currentResolverVersion() {
    const { resolver, appPreview, origin, screens } = this.store.session().project.document;
    const pagers = [...new Map(Object.values(screens).map((screen: any) => screen.props?.route?.step?.pager).filter(Boolean).map((pager: any) => [pager.file, pager])).values()];
    const guards = Object.values(screens).flatMap((screen: any) => screen.props?.route?.guardTransitions ?? []);
    const routeFiles = [...new Set(Object.values(screens).map((screen: any) => screen.props?.route?.file).filter(Boolean))];
    return digest(JSON.stringify({ resolver: resolver ?? null, appPreview, pagers, guards, routeFiles, origin: origin ? { path: origin.path, mode: origin.mode } : undefined }));
  }

  state() {
    const now = Date.now();
    const session = this.store.session();
    const maxScreens = this.maxScreens;
    const candidates = session.project.document.screenIds.slice(0, maxScreens);
    const connected = !!this.child && !!this.host && now - this.host.receivedAt < 3000;
    // Readiness is judged over the frames the host has actually mounted; unmounted frames wait offscreen.
    const mounted = connected && this.host?.kind === "host" ? new Set(this.host.screenIds) : null;
    const expected = mounted ? candidates.filter((id) => mounted.has(id)) : candidates;
    const screens = [...this.screens.values()].filter((screen) => screen.kind === "screen" && expected.includes(screen.screenId)).map((screen) => ({ ...screen,
      current: connected && screen.kind === "screen" && screen.codeVersion === session.codeVersion && (!session.nativeVersion || screen.nativeVersion === session.nativeVersion) && now - screen.receivedAt < 3000 }));
    const readyCount = screens.filter((screen) => screen.current && !screen.error).length;
    const waitingCount = screens.filter(screen => screen.current && screen.kind === "screen" && (screen.state.routePreview as any)?.status === "waiting-for-link").length;
    const needsStateCount = screens.filter(screen => screen.current && screen.kind === 'screen' && ((screen.state.routePreview as any)?.status === 'needs-state' || (screen.state.nativePreview as any)?.status === 'unavailable')).length;
    const screenErrorCount = screens.filter(screen => screen.current && screen.error).length;
    const error = this.error ?? this.host?.error
      ?? (session.project.document.screenIds.length > maxScreens ? `This host supports ${maxScreens} screens. Remove extra frames or split the project.` : null);
    const ready = connected && !error && readyCount === expected.length;
    const phase = error ? "error" : !this.child ? "stopped" : !this.host ? "starting" : !connected ? "paused" : ready ? "ready" : readyCount + screenErrorCount === expected.length ? "degraded" : "loading";
    // Metro reads the project's module resolver once per session; a later change needs a reopen.
    const resolverCurrent = !this.child || this.resolverVersion === this.currentResolverVersion();
    // The JavaScript runtime is shared, so console output is reported once, not per frame.
    const consoleLines = [...new Set(screens.flatMap((screen) => (screen.kind === "screen" ? screen.console ?? [] : [])))].slice(-8);
    return { renderer: "ios-on-mac", experimental: true, adapter: session.project.document.nativePreview ? "swift-ios" : "expo", sdk: session.project.document.nativePreview ? null : this.child ? this.sdk : session.project.document.appPreview?.sdk ?? 54, maxScreens, mountedCount: mounted ? expected.length : 0, screenCount: session.project.document.screenIds.length, console: consoleLines,
      hostId: this.hostId, starting: !!this.child && !this.host, connected, ready, phase, readyCount, waitingCount, needsStateCount, screenErrorCount, expectedCount: expected.length,
      resolverCurrent, notice: resolverCurrent ? null : "The project's module resolver changed after this canvas opened. Stop and reopen the canvas to apply it.",
      previewEnvironment: session.project.document.appPreview?.offline ? "design" : "app",
      inspection: this.inspection && this.inspection.expiresAt > now ? this.inspection : null, host: this.host ?? null, screens, error, logs: this.logs.slice(-8) };
  }
  start(value: unknown, runtimeUrl: string) {
    const request = StudioOpenSchema.parse(value);
    this.store.assertIdentity(request);
    if (request.screen && !this.store.session().project.document.screens[request.screen]) throw new CanvasError("invalid_screen", "Choose an existing screen.");
    if (this.child) {
      // Already open: bring the window forward and reveal the requested screen.
      if (request.screen) this.commands.set("host", { id: ++this.commandId, type: "focus", screenId: request.screen });
      void this.foreground().catch(error => { this.error = error.message; });
      return this.state();
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new CanvasError("studio_unavailable", "Native Studio requires an Apple-silicon Mac.");
    const maxScreens = this.maxScreens;
    if (this.store.session().project.document.screenIds.length > maxScreens)
      throw new CanvasError("studio_capacity", `This native host supports up to ${maxScreens} screens.`);
    this.hostId = randomUUID(); this.host = undefined; this.screens.clear(); this.commands.clear(); this.error = null; this.logs = [];
    this.sampledScreens.clear();
    this.resolverVersion = this.currentResolverVersion();
    this.sdk = this.store.session().project.document.appPreview?.sdk ?? 54;
    this.reveal = request.screen ?? null;
    const child = this.launch(process.execPath, ["--import", "tsx", "src/runtime/host/launch.ts", "--project", this.store.directory, "--runtime", runtimeUrl, "--host-id", this.hostId], { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    const log = (chunk: Buffer) => {
      this.logs.push(...String(chunk).trim().split("\n").map((line) => line.slice(0, 500)));
      this.logs = this.logs.slice(-30);
      const failure = this.logs.filter((line) => line.startsWith("EXPO_CANVAS_ERROR: ")).at(-1);
      if (failure) this.error = failure.slice(19);
    };
    child.stdout?.on("data", log); child.stderr?.on("data", log);
    child.on("error", (error) => { this.error = error.message; });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      const note = this.logs.filter((line) => line.startsWith("EXPO_CANVAS_NOTE: ")).at(-1);
      if (code && !this.error) this.error = `Native Studio stopped (${code}). ${this.logs.at(-1) ?? ""}`;
      else if (!this.error && note && !note.includes("SIGTERM")) this.error = `The native canvas closed: ${note.slice(18)}. Open it again.`;
    });
    return this.state();
  }
  report(value: unknown) {
    const report = StudioReportSchema.parse(value);
    if (report.workspaceId !== this.store.session().project.workspaceId || report.hostId !== this.hostId)
      throw new CanvasError("studio_identity", "This native host does not belong to the open studio session.", 409);
    const receipt = { ...report, receivedAt: Date.now() };
    if (report.kind === "host") {
      if (this.host?.kind === "host" && this.host.pid !== report.pid) this.screens.clear();
      this.host = receipt;
      // The host reports after its first layout, so the requested screen's frame exists by now.
      if (this.reveal) {
        this.commands.set("host", { id: ++this.commandId, type: "focus", screenId: this.reveal });
        this.reveal = null;
      }
    } else {
      if (!this.store.session().project.document.screens[report.screenId])
        throw new CanvasError("invalid_screen", "This screen was removed.", 409);
      this.screens.set(report.screenId, receipt);
      this.scheduleExamples();
      if (report.navigation) {
        const target = Object.values(this.store.session().project.document.screens).find((screen) => screen.key === report.navigation);
        if (!target) throw new CanvasError("invalid_screen", `Unknown destination: ${report.navigation}`);
        // The origin frame lets the host draw the edge this navigation took.
        void this.navigateToFrame(report, target);
      }
    }
    const key = report.kind === "host" ? "host" : report.screenId;
    const command = this.commands.get(key);
    if (command && report.acknowledged >= command.id) this.commands.delete(key);
    const state = this.state();
    return { accepted: true, command: this.commands.get(key) ?? null, phase: state.phase, readyCount: state.readyCount, waitingCount: state.waitingCount, needsStateCount: state.needsStateCount, screenErrorCount: state.screenErrorCount, inspection: state.inspection, error: state.error };
  }
  control(value: unknown) {
    const control = StudioControlSchema.parse(value);
    this.store.assertIdentity(control);
    if (control.hostId !== this.hostId || !this.child)
      throw new CanvasError("studio_disconnected", "Open Native Studio before controlling its frames.", 409);
    if (!this.state().connected) this.start({ workspaceId: control.workspaceId, sequence: control.sequence }, "");
    const { action } = control;
    if ("screenId" in action && action.screenId && !this.store.session().project.document.screens[action.screenId])
      throw new CanvasError("invalid_screen", "Choose an existing screen.");
    const command = { ...action, id: ++this.commandId };
    if (action.type === "reset") { this.sampledScreens.delete(action.screenId); this.scheduleExamples(); }
    this.commands.set(action.type === "reset" ? action.screenId : "host", command);
    return { accepted: true, command, hostId: this.hostId };
  }
  private scheduleExamples() {
    if (this.exampleTimer || this.applyingExamples || !this.child || !this.store.session().project.document.appPreview) return;
    this.exampleTimer = setTimeout(() => {
      this.exampleTimer = undefined;
      void this.applyExamples();
    }, 250);
    this.exampleTimer.unref();
  }
  private async navigateToFrame(report: Extract<StudioReport, { kind: "screen" }>, target: Screen) {
    try {
      // Route guards and mount effects in background frames must not steal the
      // camera when another frame navigates or a source edit reloads the map.
      if ((this.store.session().project.document.appPreview || this.store.session().project.document.nativePreview) && (this.host?.kind !== "host" || this.host.focusedScreenId !== report.screenId)) return;
      const request = report.state.navigationTarget;
      const route = target.props.route;
      if (request && typeof request === "object" && !Array.isArray(request) && request.key === target.key && typeof request.href === "string"
        && route && typeof route === "object" && !Array.isArray(route) && typeof route.fullPath === "string") {
        const params = paramsForScreenRoute(route, request.href);
        if (params && JSON.stringify(params) !== JSON.stringify(target.props.params ?? {})) {
          const session = this.store.session();
          const source = session.project.document.screens[report.screenId];
          await this.store.execute({ ...identityOf(session), requestId: randomUUID(), label: `Open ${target.name} on canvas`, operations: [{ type: "screen.update", id: target.id, patch: {
            props: { ...target.props, params, routeExample: { href: request.href, from: source.key, file: String((source.props.route as any)?.file ?? source.source) } },
          } }] });
        }
      }
      if (this.hostId === report.hostId) this.commands.set("host", { id: ++this.commandId, type: "focus", screenId: target.id, from: report.screenId });
    } catch (error) { this.logs.push(`Canvas navigation: ${(error as Error).message}`); }
  }
  private async applyExamples() {
    const session = this.store.session();
    if (!this.child || !session.project.document.appPreview) return;
    const examples = [...this.screens.values()].flatMap(receipt => {
      if (receipt.kind !== "screen" || receipt.error || receipt.codeVersion !== session.codeVersion || Date.now() - receipt.receivedAt > 3000 || receipt.state.previewKind !== "linked-app") return [];
      const source = session.project.document.screens[receipt.screenId];
      return source ? routeExamples(source.key, receipt.state.routeDestinations) : [];
    });
    const operations: Operation[] = [];
    for (const screen of Object.values(session.project.document.screens)) {
      if (this.sampledScreens.has(screen.id)) continue;
      const props = chooseRouteExample(screen, examples);
      if (props) operations.push({ type: "screen.update", id: screen.id, patch: { props } });
    }
    if (!operations.length) return;
    this.applyingExamples = true;
    try {
      await this.store.execute({ ...identityOf(session), requestId: randomUUID(), label: "Use rendered route examples", operations });
      for (const operation of operations) if (operation.type === "screen.update") this.sampledScreens.add(operation.id);
    } catch (error) {
      // Concurrent edits win; the next fresh receipt can retry against their sequence.
      if (!(error instanceof CanvasError && error.status === 409)) this.logs.push(`Route examples: ${(error as Error).message}`);
    } finally { this.applyingExamples = false; }
  }
  async inspect(value: unknown) {
    const input = StudioInspectSchema.parse(value);
    this.store.assertIdentity(input);
    const screen = this.store.session().project.document.screens[input.screenId];
    if (!screen) throw new CanvasError("invalid_screen", "Choose a screen from the sitemap.");
    if (input.hostId !== this.hostId || !this.child || this.host?.kind !== "host")
      throw new CanvasError("studio_disconnected", "Open the native canvas before inspecting a screen.", 409);
    if (!this.host.screenCapture) throw new CanvasError("studio_upgrade", "Rebuild and reopen the native canvas for screen inspection.");
    if (this.inspecting || this.capturing) throw new CanvasError("studio_busy", "A native inspection or capture is already in progress.", 409);
    this.inspecting = true;
    this.inspection = { screenId: screen.id, status: "capturing", expiresAt: Date.now() + 20_000 };
    const command: Pending = { id: ++this.commandId, type: "focus", screenId: screen.id };
    this.commands.set("host", command);
    let completed = false;
    try {
      // iOS-on-Mac can keep stale pixels while inactive even as model receipts
      // advance. Activate this project's window before waiting for fresh output.
      await this.foreground();
      const activatedAt = Date.now();
      const deadline = Date.now() + 15_000;
      while (true) {
        this.store.assertIdentity(input);
        if (this.hostId !== input.hostId || !this.child) throw new CanvasError("studio_disconnected", "The canvas closed during inspection.", 409);
        const host = this.host;
        const receipt = this.screens.get(screen.id);
        if (host?.kind === "host" && host.acknowledged >= command.id && host.focusedScreenId !== screen.id)
          throw new CanvasError("inspection_interrupted", "Focus moved to another screen. Inspect again when ready.", 409);
        if (host?.kind === "host" && host.acknowledged >= command.id && host.focusedScreenId === screen.id && host.settled
          && receipt?.kind === "screen" && receipt.receivedAt >= activatedAt && receipt.codeVersion === this.store.session().codeVersion && (!this.store.session().nativeVersion || receipt.nativeVersion === this.store.session().nativeVersion) && Date.now() - receipt.receivedAt < 3000) break;
        if (Date.now() >= deadline) throw new CanvasError("inspection_timeout", "The screen did not settle in time. Check its native state and try again.");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const capture = await this.capture(input, true);
      const receipt = this.screens.get(screen.id);
      this.inspection = { screenId: screen.id, status: "captured", expiresAt: Date.now() + 1800 };
      completed = true;
      return { ...capture, screen: { id: screen.id, key: screen.key, name: screen.name, source: screen.source,
        width: screen.width, height: screen.height, props: screen.props, notes: screen.notes, links: screen.links },
        state: receipt?.kind === "screen" ? receipt.state : {}, error: receipt?.error ?? null,
        inspection: "Captured for agent; the presence indicator clears automatically." };
    } finally {
      this.inspecting = false;
      if (!completed) this.inspection = null;
      if (this.commands.get("host")?.id === command.id) this.commands.delete("host");
    }
  }
  async capture(value: unknown, fromInspection = false) {
    const input = StudioCaptureSchema.parse(value);
    this.store.assertIdentity(input);
    const before = this.state();
    if (input.hostId !== this.hostId || !this.child || this.host?.kind !== "host")
      throw new CanvasError("studio_disconnected", "Open Native Studio before capturing its window.", 409);
    if (input.screenId && !this.host.screenCapture) throw new CanvasError("studio_upgrade", "Rebuild and reopen the native canvas for screen capture.");
    if (this.capturing || (this.inspecting && !fromInspection)) throw new CanvasError("studio_busy", "A native inspection or capture is already in progress.", 409);
    if (input.screenId && !this.store.session().project.document.screens[input.screenId]) throw new CanvasError("invalid_screen", "Choose an existing screen.");
    this.capturing = true;
    const codeVersion = this.store.session().codeVersion;
    const temporary = join(this.store.directory, ".expo-canvas", `studio-${randomUUID()}.png`);
    let method: "host" | "screen" = "host";
    try {
      const run = promisify(execFile);
      // The host renders its own window and frame windows first; ScreenCaptureKit remains the
      // fallback that also includes natively presented sheets when screen recording is available.
      await mkdir(join(this.store.directory, ".expo-canvas"), { recursive: true });
      const rendered = await this.renderSnapshot(temporary, input.screenId);
      if (!rendered) {
        if (input.screenId) throw new CanvasError("screen_capture", "The native screen snapshot did not arrive. Inspect again; no canvas image was substituted.");
        method = "screen";
        const { stdout } = await run("ps", ["-p", String(this.host.pid), "-o", "command="], { timeout: 3000 });
        const output = this.buildOutput();
        const { executable } = JSON.parse(await readFile(join(output, "build.json"), "utf8"));
        if (typeof executable !== "string" || !/^[A-Za-z0-9_-]+$/.test(executable)
          || !stdout.includes(`/${executable}.app/${executable} `) || !stdout.includes(`--host-id ${this.hostId}`))
          throw new CanvasError("studio_identity", "The reported process is not this native canvas.", 409);
        const source = nativeCanvas.capture;
        const helper = join(cacheDirectory, `capture-${digest(await readFile(source)).slice(0, 16)}`);
        const built = await stat(helper).catch(() => null);
        if (!built) {
          await mkdir(cacheDirectory, { recursive: true });
          await run("xcrun", ["swiftc", "-parse-as-library", source, "-o", helper], { timeout: 30_000 });
        }
        await run(helper, [String(this.host.pid), temporary], { timeout: 15_000 });
      }
      this.store.assertIdentity(input);
      if (this.hostId !== input.hostId || this.store.session().codeVersion !== codeVersion)
        throw new CanvasError("stale_capture", "The native project changed while capturing. Capture again.", 409);
      const bytes = await readFile(temporary);
      if (bytes.length > 8 * 1024 * 1024) throw new CanvasError("capture_size", "Native window capture exceeded 8 MB.");
      const path = join(this.store.directory, input.screenId ? `.expo-canvas/screen-${input.screenId}.png` : ".expo-canvas/native-canvas.png");
      await rename(temporary, path);
      return { path, mimeType: "image/png", data: bytes.toString("base64"), hostId: this.hostId, codeVersion, method,
        scope: input.screenId ? "screen" : "canvas", screenId: input.screenId, capturedAt: Date.now(), ready: input.screenId ? before.screens.some(screen => screen.kind === "screen" && screen.screenId === input.screenId && screen.current && !screen.error) : before.ready, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    } catch (error) {
      if (error instanceof CanvasError) throw error;
      throw new CanvasError("studio_capture", `Could not capture the native window: ${(error as Error).message.slice(0, 1200)}`);
    } finally { this.capturing = false; await rm(temporary, { force: true }); }
  }
  /** The host posts its rendered canvas here in answer to a capture command. */
  snapshot(value: unknown) {
    const report = SnapshotSchema.parse(value);
    if (report.workspaceId !== this.store.session().project.workspaceId || report.hostId !== this.hostId)
      throw new CanvasError("studio_identity", "This native host does not belong to the open studio session.", 409);
    const bytes = Buffer.from(report.png, "base64");
    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw new CanvasError("invalid_snapshot", "The host snapshot is not a PNG.");
    this.snapshots.set(report.id, bytes);
    if (this.snapshots.size > 4) this.snapshots.delete(this.snapshots.keys().next().value!);
    return { accepted: true };
  }
  /** Asks the host to render itself and writes the result to `path`; false when the host does not answer in time. */
  private async renderSnapshot(path: string, screenId?: string) {
    const command: Pending = { id: ++this.commandId, type: "capture", ...(screenId ? { screenId } : {}) };
    this.commands.set("host", command);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const bytes = this.snapshots.get(command.id);
      if (bytes) {
        this.snapshots.delete(command.id);
        await writeFile(path, bytes);
        return true;
      }
      if (this.host?.kind === "host" && this.host.acknowledged > command.id) return false;
    }
    if (this.commands.get("host") === command) this.commands.delete("host");
    return false;
  }
  async stop() {
    this.inspection = null;
    clearTimeout(this.exampleTimer); this.exampleTimer = undefined;
    if (this.child) {
      this.commands.set("host", { id: ++this.commandId, type: "stop" });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const child = this.child; this.child = undefined;
      child?.kill("SIGTERM");
    }
    this.host = undefined; this.screens.clear(); this.hostId = null; this.commands.clear(); this.error = null; this.reveal = null;
  }
}
