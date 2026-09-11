import { detectProjectAdapter } from "./adapters/index";
import { loadSwiftProject } from "./adapters/swift/project";
import { parseArgs } from "node:util";
import { readFile, open, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { identityOf, type Screen, type Session } from "../shared/model";
import { CanvasClient } from "./client";
import { ProjectStore } from "./project";
import { discoverRuntime, startRuntime } from "./server";
import { repository } from "./paths";
import { doctor } from "./doctor";
import { setup, formatEnvironment } from "./setup";
import { appProject } from "./app-project";
import { projectContext } from "./project-context";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string" },
    app: { type: "string" },
    map: { type: "boolean" },
    preview: { type: "boolean" },
    offline: { type: "boolean" },
    "swift-context": { type: "string" },
    "swift-preview": { type: "string", multiple: true },
    port: { type: "string" },
    name: { type: "string" },
    key: { type: "string" },
    screen: { type: "string" },
    source: { type: "string" },
    file: { type: "string" },
    hash: { type: "string" },
    from: { type: "string" },
    include: { type: "string" },
    exclude: { type: "string" },
    modules: { type: "string" },
    files: { type: "string" },
    force: { type: "boolean" },
    link: { type: "boolean" },
    team: { type: "string" },
    install: { type: "boolean" },
    json: { type: "boolean" },
    incremental: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [command = "help", action, argument] = positionals;
const output = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
const list = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean);
const stdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};
/** A screen by key or ID; keys are what people and agents type. */
const screenIn = (session: Session, reference: string | undefined): Screen => {
  const screen = Object.values(session.project.document.screens).find((entry) => entry.key === reference || entry.id === reference);
  if (!screen) throw new Error(`Choose an existing screen key or ID${reference ? ` (${reference} is not one)` : ""}.`);
  return screen;
};

const help = `Mobile Canvas — design real Expo screens on a native canvas

  mobile-canvas setup [--app <app>] [--offline] [--team <id>] [--install] [--json]
  mobile-canvas build [--team <id>] [--incremental]            # build the authored-screen host
  mobile-canvas open|mcp [--app <app>] [--project <separate-dir>] # automatic native Expo 56/57 route previews
    --offline                                            # design preview: disconnected services, no API keys
    --swift-preview MindIcon                            # add an app-authored component preview; repeat to select more
    --swift-context application|isolated                  # Swift: app initializer/services or independent previews (default)
  mobile-canvas map [--app <app>] [--project <separate-dir>]     # source-only route mapping, no execution
  mobile-canvas init --project <dir> --name <name>
  mobile-canvas import --project <dir> --from <app> [--link] [--map] [--name <name>] [--include a,b] [--exclude a,b] [--modules pkg,pkg]
  mobile-canvas open --project <dir> [--screen <key>] [--port <n>]   # the native canvas; --screen reveals one screen at 100%
  mobile-canvas serve --project <dir> [--port 4182]                  # the runtime alone, for CLI and MCP
  mobile-canvas read|selection|doctor|undo|redo|arrange --project <dir>
  mobile-canvas previews --project <dir>                     # Swift previews, animation evidence and local image assets
  mobile-canvas batch --project <dir> [--file command.json]          # otherwise stdin; see docs/agents.md
  mobile-canvas screen add --project <dir> --key <key> --name <name> [--file component.tsx | --source screens/existing.tsx]
  mobile-canvas source read <screens/file.tsx> --project <dir>
  mobile-canvas source write <screens/file.tsx> --file <tsx> --hash <sha256|null> --project <dir>
  mobile-canvas diff --project <dir> [--files lib/a.tsx,lib/b.ts]    # what the experiment changed versus the imported app
  mobile-canvas apply --project <dir> --files lib/a.tsx [--force]    # copy chosen files back into the imported app
  mobile-canvas studio open|status|capture|stop|fit --project <dir>
  mobile-canvas studio zoom <scale> [--key <screen>] --project <dir>
  mobile-canvas studio focus|reset <screen> --project <dir>
  mobile-canvas mcp --project <dir>

Run setup, open, map or mcp from your Expo app root; no path flag is needed.
Canvas project roots are also detected. Explicit --app / --project paths take precedence.
CLI and MCP attach to the project runtime or start one.
import brings an existing Expo app onto the canvas: with --link the app's source runs in place and
lib/ holds only the files you override; without it the source is copied into lib/ with provenance.
The canvas is a native app for Apple silicon; use setup for prerequisites and build for authored screens.`;

async function main() {
  if (values.help || command === "help") {
    console.log(help);
    return;
  }
  if (!values.project && !values.app && !["init", "build"].includes(command)) {
    const context = await projectContext(process.cwd());
    if (context.project) values.project = context.project;
    else if (["setup", "open", "map", "mcp"].includes(command)) values.app = context.app;
  }
  if (command === "setup") {
    const report = await setup({ app: values.app && resolve(values.app), project: values.project && resolve(values.project), offline: values.offline, team: values.team, install: values.install, json: values.json });
    if (values.json) output(report); else console.log(formatEnvironment(report, values.app === process.cwd() || values.project === process.cwd()));
    if (!report.readyToBuild) process.exitCode = 1;
    return;
  }
  if (command === "build") {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/host/build.ts', ...(values.team ? ['--team', values.team] : []), ...(values.incremental ? ['--incremental'] : [])], { cwd: repository, stdio: 'inherit' });
    const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw new Error('Native build failed. See the build output above.');
    return;
  }
  if (!values.project && !values.app) throw new Error("Run this command from an Expo app or Canvas project root, or pass --project <directory> / --app <directory>.");
  const hasSwiftImportOptions = values['swift-context'] !== undefined || values['swift-preview'] !== undefined;
  if (hasSwiftImportOptions) {
    if (!['open', 'map', 'mcp', 'import'].includes(command)) throw new Error('Use --swift-context and --swift-preview with open, map, mcp or import.');
    if (values['swift-context'] !== undefined && !['isolated', 'application'].includes(values['swift-context'])) throw new Error('Choose --swift-context isolated or application.');
    if (values.offline && values['swift-context'] === 'application') throw new Error('Application context runs real app services; it cannot be combined with --offline.');
    if (!values.app && values.project && ['open', 'map', 'mcp'].includes(command)) {
      const manifest = JSON.parse(await readFile(resolve(values.project, 'expo-canvas.json'), 'utf8'));
      if (!manifest.document.nativePreview) throw new Error('--swift-context and --swift-preview require a Swift project.');
      values.app = manifest.document.origin.path;
    }
  }
  if (command === "map" && !values.app) throw new Error("Pass --app <Expo app directory> to map its routes.");
  if (values.app && !["open", "map", "mcp"].includes(command)) throw new Error("Use --app with open, map or mcp; use --project for other commands.");
  const app = values.app ? await appProject(resolve(values.app)) : undefined;
  const project = values.project ? resolve(values.project) : app!.project;
  if (app) {
    if (project === app.from || project.startsWith(app.from + "/") || app.from.startsWith(project + "/"))
      throw new Error("Choose a project outside the source app. By default --app uses ~/.expo-canvas/apps/.");
    if (!await readFile(resolve(project, "expo-canvas.json")).then(() => true, () => false)) {
      const swift = await detectProjectAdapter(app.from) === "swift-ios";
      const store = await ProjectStore.initialize(project, "App screen map", swift ? {app: app.from, spec: await loadSwiftProject(app.from)} : undefined);
      await store.close();
    }
  }
  const mapApp = async (client: CanvasClient) => {
    const session = await client.read();
    if (hasSwiftImportOptions && !session.project.document.nativePreview) throw new Error('--swift-context and --swift-preview require a Swift project.');
    if (session.project.document.origin && session.project.document.origin.path !== app!.from)
      throw new Error("This project is linked to a different app.");
    if (command === "map" || hasSwiftImportOptions || session.project.document.screenIds.length === 0 || !session.project.document.origin || (!session.project.document.appPreview && !session.project.document.nativePreview) || (values.offline !== undefined && !!session.project.document.appPreview?.offline !== values.offline)) {
      const result = await client.request("/import", { ...identityOf(session), requestId: randomUUID(), from: app!.from, link: true, map: true, preview: command !== "map", offline: values.offline ?? false, swiftContext:values['swift-context'],swiftPreviews:values['swift-preview'] });
      console.error(`Mapped ${(result.import.routeMap.frames?.length ?? result.import.routeMap.nodes.length)} ${session.project.document.nativePreview ? "Swift destinations" : "routes"} · ${project}${command === "map" ? " · static map" : " · native app preview"}.`);
      return result;
    }
  };
  if (command === "init") {
    const store = await ProjectStore.initialize(project, values.name ?? "Untitled app");
    output(store.session());
    await store.close();
    return;
  }
  if (command === "serve" || command === "open") {
    const existing = await discoverRuntime(project);
    if (existing) {
      if (app) await mapApp(new CanvasClient(existing));
      if (command === "open") await openNativeCanvas(new CanvasClient(existing), values.screen);
      else console.error(`Mobile Canvas: ${existing} (already running for this project)`);
      return;
    }
    const runtime = await startRuntime({ project, port: Number(values.port ?? (command === "open" ? 0 : 4182)) });
    if (app) {
      try { await mapApp(new CanvasClient(runtime.url)); }
      catch (error) { await runtime.close(); throw error; }
    }
    if (command === "serve") console.error(`Mobile Canvas API: ${runtime.url}`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await runtime.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void close());
    process.on("SIGTERM", () => void close());
    if (command === "open") {
      try {
        await openNativeCanvas(new CanvasClient(runtime.url), values.screen);
      } catch (error) {
        await runtime.close();
        throw error;
      }
    }
    return;
  }
  if (command === "import") {
    if (!values.from) throw new Error("Pass --from <existing app directory>");
    // A missing project is created first, exactly like init.
    const exists = await readFile(resolve(project, "expo-canvas.json")).then(() => true, () => false);
    if (!exists) {
      const store = await ProjectStore.initialize(project, values.name ?? "Imported app");
      await store.close();
    }
  }
  let url = await discoverRuntime(project);
  let owned: Awaited<ReturnType<typeof startRuntime>> | undefined;
  if (!url && command === "mcp") {
    owned = await startRuntime({ project, port: 0 });
    url = owned.url;
  }
  if (!url) {
    // Other commands leave a detached runtime behind so later calls, and the canvas, share it.
    await mkdir(resolve(project, ".expo-canvas"), { recursive: true });
    const log = await open(resolve(project, ".expo-canvas/runtime.log"), "a", 0o600);
    const child = spawn(process.execPath, ["--import", "tsx", "src/runtime/cli.ts", "serve", "--project", project, "--port", "0"], {
      cwd: repository, detached: true, stdio: ["ignore", log.fd, log.fd],
    });
    child.unref();
    await log.close();
    for (let i = 0; i < 300 && !url; i++) {
      await new Promise((done) => setTimeout(done, 100));
      url = await discoverRuntime(project);
    }
    if (!url) throw new Error("Could not start the runtime. See this project's .expo-canvas/runtime.log.");
  }
  const client = new CanvasClient(url);
  if (app) {
    try {
      const result = await mapApp(client);
      if (command === "map") return output({ project, ...result });
    } catch (error) { await owned?.close(); throw error; }
  }
  if (command === "mcp") {
    const { startMcp } = await import("./mcp");
    const mcp = await startMcp(client);
    const close = async () => {
      await mcp.close();
      await owned?.close();
      process.exit(0);
    };
    process.stdin.on("end", () => void close());
    process.on("SIGTERM", () => void close());
    process.on("SIGINT", () => void close());
    return;
  }
  if (command === "read") return output(await client.read());
  if (command === "previews") return output(await client.request('/native/catalog',{}));
  if (command === "doctor") return output(await doctor(client));
  if (command === "selection") return output((await client.read()).selection);
  if (command === "batch")
    return output(await client.request("/command", JSON.parse(values.file ? await readFile(values.file, "utf8") : await stdin())));
  if (command === "diff") {
    const result = await client.request(`/origin/diff?files=${encodeURIComponent(values.files ?? "")}`);
    const changed = result.entries.filter((entry: { status: string }) => entry.status !== "unchanged");
    console.error(`${result.origin.name} (${result.origin.path}) · ${changed.length} file${changed.length === 1 ? "" : "s"} differ from the app`);
    for (const entry of changed)
      process.stdout.write(`# ${entry.status}${entry.candidate ? "" : " (canvas-only, not for the app)"}: ${entry.path} → ${entry.target}${entry.originChanged ? " (origin changed since import)" : ""}\n${entry.candidate ? entry.diff : ""}\n`);
    return;
  }
  if (command === "apply") {
    if (!values.files) throw new Error("Pass --files lib/a.tsx,lib/b.ts to choose what to carry back into the app");
    return output(await client.request("/origin/apply", { ...identityOf(await client.read()), files: list(values.files), force: values.force ?? false }));
  }
  if (command === "import") {
    return output(
      await client.request("/import", {
        ...identityOf(await client.read()),
        requestId: randomUUID(),
        from: resolve(values.from!),
        ...(values.name ? { name: values.name } : {}),
        ...(values.include ? { include: list(values.include) } : {}),
        ...(values.exclude ? { exclude: list(values.exclude) } : {}),
        ...(values.modules ? { modules: list(values.modules) } : {}),
        link: values.link ?? false,
        map: values.map ?? false,
        preview: values.preview ?? false,
        offline: values.offline ?? false,
        swiftContext: values['swift-context'],
        swiftPreviews: values['swift-preview'],
      }),
    );
  }
  if (command === "source" && action === "read") return output(await client.request(`/source?path=${encodeURIComponent(argument ?? "")}`));
  if (command === "source" && action === "write") {
    if (!values.file || !values.hash || !argument) throw new Error("Source writes need a path, --file and --hash (or null for a new file)");
    const code = await readFile(values.file, "utf8");
    return output(await client.batch([{ type: "source.write", path: argument, code, expectedHash: values.hash === "null" ? null : values.hash }], `Edit ${argument}`));
  }
  if (command === "screen" && action === "add") {
    if (!values.key || !values.name) throw new Error("Screen creation needs --key and --name");
    const { CreateScreenSchema } = await import("../shared/model");
    const screen = CreateScreenSchema.parse({
      key: values.key,
      name: values.name,
      ...(values.source ? { source: values.source } : {}),
      ...(values.file ? { code: await readFile(values.file, "utf8") } : {}),
    });
    return output(await client.batch([{ type: "screen.create", screen }], `Create ${values.name}`));
  }
  const session = await client.read();
  const identity = identityOf(session);
  if (command === "undo" || command === "redo") return output(await client.request(`/${command}`, identity));
  if (command === "arrange") {
    const result = await client.request("/arrange", identity);
    console.error(`Arranged ${result.moved} frame${result.moved === 1 ? "" : "s"} by flow.`);
    return output({ moved: result.moved, sequence: result.session.project.sequence });
  }
  if (command === "studio") {
    if (action === "status") return output(await client.request("/studio/state"));
    if (action === "open") return output(await client.request("/studio/open", { ...identity, ...(values.screen ? { screen: screenIn(session, values.screen).id } : {}) }));
    if (action === "stop") return output(await client.request("/studio/stop", identity));
    const state = await client.request("/studio/state");
    const control = (type: string, extra: Record<string, unknown> = {}) =>
      client.request("/studio/control", { ...identity, hostId: state.hostId, action: { type, ...extra } });
    if (action === "capture") {
      const { data, ...capture } = await client.request("/studio/capture", { ...identity, hostId: state.hostId });
      return output(capture);
    }
    if (action === "fit") return output(await control("fit"));
    if (action === "zoom") {
      const scale = Number(argument);
      if (!Number.isFinite(scale)) throw new Error("Pass a zoom scale between 0.25 and 1.5, optionally with --key <screen>");
      return output(await control("zoom", { scale, ...(values.key ? { screenId: screenIn(session, values.key).id } : {}) }));
    }
    if (action === "focus" || action === "reset") return output(await control(action, { screenId: screenIn(session, argument).id }));
    throw new Error("Use studio open, status, capture, stop, fit, zoom, focus or reset.");
  }
  throw new Error("Unknown command. Run mobile-canvas --help.");
}

/** Opens the native canvas and waits until its mounted screens render; --screen reveals one at 100%. */
async function openNativeCanvas(client: CanvasClient, screenKey?: string) {
  console.error("Opening Mobile Canvas…");
  const session = await client.read();
  const screen = screenKey ? screenIn(session, screenKey) : undefined;
  const opened = await client.request("/studio/open", { ...identityOf(session), ...(screen ? { screen: screen.id } : {}) });
  const deadline = Date.now() + ((session.project.document.appPreview || session.project.document.nativePreview) ? 30 * 60_000 : 150_000);
  let lastProgress = "";
  while (Date.now() < deadline) {
    const state = await client.request("/studio/state");
    const progress = state.logs?.filter((line: string) => !line.startsWith("EXPO_CANVAS_")).at(-1);
    if (progress && progress !== lastProgress) { console.error(progress); lastProgress = progress; }
    if (state.error) throw new Error(state.error);
    if (state.hostId !== opened.hostId) throw new Error("The native session changed while opening. Try again.");
    if (state.ready || state.phase === "degraded") {
      const mapped = !session.project.document.appPreview && Object.values(session.project.document.screens).every(entry => entry.props.route && entry.source === `screens/route-${entry.key}.tsx`);
      const noun = mapped ? "route card" : "running frame";
      console.error(`Mobile Canvas is open · ${state.readyCount} ${noun}${state.readyCount === 1 ? "" : "s"}${screen ? ` · showing ${screen.name}` : ""}${mapped ? " · no live app preview" : ""}${state.screenErrorCount ? ` · ${state.screenErrorCount} frame errors` : ""}.`);
      return;
    }
    if (state.phase === "stopped") throw new Error("The native canvas closed before it was ready.");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("The native canvas did not become ready. Check studio status and the native build logs.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
