import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProjectStore } from "../src/runtime/project";
import { startRuntime, discoverRuntime } from "../src/runtime/server";
import { CanvasClient } from "../src/runtime/client";
import { repository } from "../src/runtime/paths";
import { identityOf } from "../src/shared/model";

test("MCP --app bootstraps a separate route map without executing or copying app code", async t => {
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-dropin-"));
  const app = join(directory, "source-app"), project = join(directory, "canvas");
  await mkdir(join(app, "app"), { recursive: true });
  await writeFile(join(app, "package.json"), '{"name":"dropin","dependencies":{"expo":"~57.0.0"}}');
  await mkdir(join(app, "node_modules/expo"), { recursive: true });
  await writeFile(join(app, "node_modules/expo/package.json"), '{"version":"57.0.20"}');
  const code = 'throw new Error("App source must never execute during MCP startup"); export default function Home(){return null;}';
  await writeFile(join(app, "app/index.tsx"), code);
  const mcp = new Client({ name: "dropin-test", version: "1" });
  t.after(async () => { await mcp.close(); await rm(directory, { recursive: true, force: true }); });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [join(repository, "bin/expo-canvas.mjs"), "mcp", "--app", app, "--project", project], stderr: "pipe" }));
  const result = await mcp.callTool({ name: "canvas_route_map", arguments: {} });
  assert.ok(!result.isError, JSON.stringify(result));
  const map = JSON.parse((result.content as any)[0].text);
  assert.equal(map.liveAppPreview, true);
  assert.equal(map.routes.length, 1);
  assert.equal(map.routes[0].route.file, "app/index.tsx");
  const read = await mcp.callTool({ name: "canvas_read", arguments: {} });
  const session = JSON.parse((read.content as any)[0].text);
  assert.equal(session.project.sequence, 1);
  assert.deepEqual(session.project.document.appPreview, { sdk: 57, routesDirectory: "app" });
  assert.match(await readFile(join(project, ".expo-canvas/route-context.ts"), "utf8"), /require\(/);
  assert.deepEqual(session.project.document.resolver.modules, {});
  assert.ok(session.sources.every((source: any) => source.path.startsWith("screens/")));
  const state = await mcp.callTool({ name: "canvas_studio_state", arguments: {} });
  assert.equal(JSON.parse((state.content as any)[0].text).hostId, null);
  assert.equal(await readFile(join(app, "app/index.tsx"), "utf8"), code);
});

test("CLI, MCP and HTTP share one project, transaction executor and human selection", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-mcp-"));
  const store = await ProjectStore.initialize(directory, "Agent integration");
  await store.close();
  const runtime = await startRuntime({ project: directory, port: 0 });
  const mcp = new Client({ name: "expo-canvas-test", version: "1" });
  t.after(async () => {
    await mcp.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = new CanvasClient(runtime.url);
  assert.equal(await discoverRuntime(directory), runtime.url);
  const attached = await promisify(execFile)(process.execPath, [
    join(repository, "bin/expo-canvas.mjs"), "serve", "--project", directory,
  ]);
  assert.ok(attached.stderr.includes(runtime.url));
  assert.match(attached.stderr, /already running/);
  assert.equal(await discoverRuntime(directory), runtime.url);
  await assert.rejects(
    startRuntime({ project: directory, port: 0 }),
    /already has a local runtime/,
  );
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        join(repository, "bin/expo-canvas.mjs"),
        "mcp",
        "--project",
        directory,
      ],
      stderr: "pipe",
    }),
  );
  const tools = await mcp.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "canvas_studio_control"));
  assert.ok(!tools.tools.some((tool) => tool.name.startsWith("canvas_preview")), "no simulator tools remain");
  const read = await mcp.callTool({ name: "canvas_read", arguments: {} });
  const initial = JSON.parse((read.content as any)[0].text);
  const created = await mcp.callTool({
    name: "canvas_create_screens",
    arguments: {
      ...identityOf(initial),
      requestId: "mcp-create",
      screens: [
        {
          key: "home",
          name: "Home",
          code: 'import {Text} from "react-native";export default function Home(){return <Text>Agent authored</Text>}',
        },
      ],
    },
  });
  assert.ok(!created.isError, JSON.stringify(created));
  const result = JSON.parse((created.content as any)[0].text),
    id = result.created.home;
  assert.equal((await client.read()).project.document.screens[id].name, "Home");
  const source = await mcp.callTool({
    name: "canvas_read_source",
    arguments: { path: "screens/home.tsx" },
  });
  const file = JSON.parse((source.content as any)[0].text);
  const changed = await mcp.callTool({
    name: "canvas_batch",
    arguments: {
      ...identityOf(result.session),
      requestId: "mcp-edit",
      label: "Explore a variation",
      operations: [
        {
          type: "source.write",
          path: file.path,
          expectedHash: file.hash,
          code: file.code.replace("Agent authored", "Agent iterated"),
        },
        {
          type: "screen.update",
          id,
          patch: { props: { enabled: false }, x: 490 },
        },
      ],
    },
  });
  assert.ok(!changed.isError, JSON.stringify(changed));
  assert.match(
    (await client.request("/source?path=screens/home.tsx")).code,
    /Agent iterated/,
  );
  const stale = await mcp.callTool({
    name: "canvas_batch",
    arguments: {
      ...identityOf(initial),
      requestId: "stale",
      operations: [{ type: "project.rename", name: "Wrong" }],
    },
  });
  assert.equal(stale.isError, true);
  await client.request("/selection", {
    workspaceId: initial.project.workspaceId,
    ids: [id],
  });
  const selection = await mcp.callTool({
    name: "canvas_selection",
    arguments: {},
  });
  assert.deepEqual(JSON.parse((selection.content as any)[0].text).ids, [id]);
  const cli = await promisify(execFile)(process.execPath, [
    join(repository, "bin/expo-canvas.mjs"),
    "read",
    "--project",
    directory,
  ]);
  assert.equal(
    JSON.parse(cli.stdout).project.workspaceId,
    initial.project.workspaceId,
  );
  const beforeUndo = await client.read();
  await client.request("/undo", identityOf(beforeUndo));
  assert.match(
    (await client.request("/source?path=screens/home.tsx")).code,
    /Agent authored/,
  );
  assert.equal((await client.read()).project.document.screens[id].x, 0);
  const origin = await fetch(`${runtime.url}/api/command`, {
    method: "POST",
    headers: {
      Origin: "https://example.com",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(origin.status, 403);
  const type = await fetch(`${runtime.url}/api/command`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(type.status, 415);
});

test("the default runtime is API-only and never serves a second human editor", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-canvas-native-only-"));
  const store = await ProjectStore.initialize(directory, "Native only");
  await store.close();
  const runtime = await startRuntime({ project: directory, port: 0 });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const root = await fetch(runtime.url);
  assert.equal(root.status, 404);
  assert.equal(((await root.json()) as { error: { code: string } }).error.code, "native_canvas");
  assert.equal((await fetch(`${runtime.url}/api/session`)).status, 200);
  assert.equal((await fetch(`${runtime.url}/api/tools`)).status, 200);
});
