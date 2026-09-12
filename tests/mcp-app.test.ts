import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CommandSchema } from "../src/shared/model";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProjectStore } from "../src/runtime/project";
import { startRuntime } from "../src/runtime/server";
import { CanvasClient } from "../src/runtime/client";
import { createMcpServer } from "../src/runtime/mcp";
import { canvasAppUri } from "../src/runtime/mcp-app";
import type { CanvasAppView } from "../src/shared/mcp-app";

test("MCP App is additive, serves a self-contained view and preserves runtime identity", async (t) => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "canvas-mcp-app-")),
  );
  const store = await ProjectStore.initialize(directory, "MCP App test");
  await store.close();
  const runtime = await startRuntime({ project: directory, port: 0 });
  const server = createMcpServer(new CanvasClient(runtime.url));
  // Deliberately no UI capability: plain MCP clients must keep working.
  const client = new Client({ name: "plain-client", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some((tool) => tool.name === "canvas_read_skill"));
  assert.equal(
    (tools.find((tool) => tool.name === "canvas_view")?._meta?.ui as any)
      .resourceUri,
    canvasAppUri,
  );
  assert.deepEqual(
    (tools.find((tool) => tool.name === "canvas_app_action")?._meta?.ui as any)
      .visibility,
    ["app"],
  );
  const resource = (await client.readResource({ uri: canvasAppUri }))
    .contents[0];
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  assert.ok("text" in resource);
  assert.ok(resource.text.includes("Mobile Canvas"));
  assert.ok(
    !resource.text.includes("/* CANVAS_SCRIPT */"),
    "The shipped UI must be built",
  );
  assert.deepEqual((resource._meta?.ui as any).csp.connectDomains, []);
  const initial = CallToolResultSchema.parse(
    await client.callTool({ name: "canvas_view", arguments: {} }),
  );
  assert.ok(!initial.isError);
  assert.equal(initial.content[0].type, "text");
  const view = initial.structuredContent?.view as CanvasAppView;
  assert.equal(view.screens.length, 0);
  assert.equal(view.host.id, null);
  const { workspaceId, sequence } = view;
  await runtime.store.execute(
    CommandSchema.parse({
      workspaceId,
      sequence,
      requestId: randomUUID(),
      label: "Add frame",
      operations: [
        {
          type: "screen.create",
          screen: {
            key: "home",
            name: "Home",
            notes: "A real authored frame",
            links: [],
          },
        },
      ],
    }),
  );
  const refreshed = CallToolResultSchema.parse(
    await client.callTool({
      name: "canvas_app_action",
      arguments: { workspaceId, sequence, action: "refresh" },
    }),
  );
  const next = refreshed.structuredContent?.view as CanvasAppView;
  assert.equal(
    next.screens.length,
    1,
    "Authored frames must appear even without linked routes",
  );
  assert.equal(
    next.sequence,
    1,
    "Refresh can recover a stale view without changing the document",
  );
  const staleOpen = await client.callTool({
    name: "canvas_app_action",
    arguments: { workspaceId, sequence, action: "open" },
  });
  assert.ok(staleOpen.isError, "A stale widget must not open native code");
  const wrongProject = await client.callTool({
    name: "canvas_app_action",
    arguments: { workspaceId: randomUUID(), sequence: 1, action: "refresh" },
  });
  assert.ok(wrongProject.isError);
  const disconnected = await client.callTool({
    name: "canvas_app_action",
    arguments: {
      workspaceId,
      sequence: 1,
      action: "inspect",
      screenId: next.screens[0].id,
      hostId: randomUUID(),
    },
  });
  assert.ok(
    disconnected.isError,
    "An unavailable capture must not return a placeholder image as native pixels",
  );
  assert.equal(runtime.studio.state().hostId, null);
  assert.equal(runtime.store.session().project.sequence, 1);
});
