import { inspectEnvironment } from "./environment";
import http from "node:http";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CommandSchema, Id, IdentitySchema } from "../shared/model";
import { CanvasError, errorBody } from "./errors";
import { ProjectStore } from "./project";
import { projectPath, repository } from "./paths";
import { NativeStudio } from "./studio";
import { originApply, originDiff } from "./origin";
import { arrangeByFlow } from "./arrange";
import { writeFileAtomically } from "./atomic-file";

export interface RuntimeOptions {
  project: string;
  port?: number;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The loopback URL of this project's running runtime, or null when none answers for this exact project. */
export async function discoverRuntime(project: string): Promise<string | null> {
  try {
    const directory = await realpath(project);
    const lease = JSON.parse(await readFile(await projectPath(directory, ".expo-canvas/runtime.json"), "utf8"));
    if (!Number.isInteger(lease.pid) || !alive(lease.pid) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(lease.url)) return null;
    const response = await fetch(`${lease.url}/api/session`, { signal: AbortSignal.timeout(1500) }).catch(() => {
      throw new CanvasError("runtime_unresponsive", "This project's runtime is still running but is not responding. No second runtime was started.", 503);
    });
    const session = (await response.json()) as { directory?: string; project?: { workspaceId?: string } };
    return response.ok && session.directory === directory && session.project?.workspaceId === lease.workspaceId ? lease.url : null;
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    return null;
  }
}

async function acquire(project: string) {
  const file = await projectPath(project, ".expo-canvas/runtime.lock", true);
  try {
    const handle = await open(file, "wx", 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(file, "utf8"));
    if (alive(pid)) throw new CanvasError("project_busy", "This project already has a local runtime. Connect through its CLI or MCP.", 409);
    await unlink(file);
    return acquire(project);
  }
  return () => unlink(file).catch(() => {});
}

const json = (response: http.ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
};

async function body(request: http.IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new CanvasError("content_type", "Use application/json", 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_000_000) throw new CanvasError("body_limit", "Request exceeds 32 MB", 413);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * One loopback runtime per project: the project store, the native canvas
 * session and the HTTP contract that the CLI, the MCP server and the native
 * app share. Only 127.0.0.1 may call it.
 */
export async function startRuntime(options: RuntimeOptions) {
  const directory = await realpath(options.project);
  const release = await acquire(directory);
  let store: ProjectStore;
  try {
    store = await ProjectStore.open(directory);
  } catch (error) {
    await release();
    throw error;
  }
  const studio = new NativeStudio(store);
  const readers = new Set<http.ServerResponse>();
  const server = http.createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "") || (request.headers.origin && request.headers.origin !== origin))
      return json(response, 403, { error: { code: "origin", message: "Use this runtime's loopback address" } });
    const url = new URL(request.url!, origin);
    const path = url.pathname;
    try {
      if (request.method === "GET") {
        if (path === "/api/session") return json(response, 200, store.session());
        if (path === "/api/tools")
          return json(response, 200, { command: process.execPath, args: [join(repository, "bin/expo-canvas.mjs"), "mcp", "--project", directory] });
        if (path === "/api/source") return json(response, 200, await store.readSource(url.searchParams.get("path") ?? ""));
        if (path === "/api/route-source") return json(response, 200, await store.readRouteSource(url.searchParams.get("screenId") ?? ""));
        if (path === "/api/events") {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
          response.write("data: connected\n\n");
          readers.add(response);
          request.on("close", () => readers.delete(response));
          return;
        }
        if (path === "/api/origin/diff") {
          const files = (url.searchParams.get("files") ?? "").split(",").map((file) => file.trim()).filter(Boolean);
          return json(response, 200, await originDiff(store, files));
        }
        if (path === "/api/environment") {
          const { appPreview, origin } = store.session().project.document;
          return json(response, 200, await inspectEnvironment({ project: directory, app: appPreview ? origin?.path : undefined, offline: appPreview?.offline }));
        }
        if (path === "/api/studio/state") return json(response, 200, studio.state());
      }
      if (request.method === "POST" && path.startsWith("/api/")) {
        const value = await body(request);
        if (path === "/api/studio/open") return json(response, 200, studio.start(value, origin));
        if (path === "/api/studio/report") return json(response, 200, studio.report(value));
        if (path === "/api/studio/snapshot") return json(response, 200, studio.snapshot(value));
        if (path === "/api/studio/control") return json(response, 200, studio.control(value));
        if (path === "/api/studio/inspect") return json(response, 200, await studio.inspect(value));
        if (path === "/api/studio/capture") return json(response, 200, await studio.capture(value));
        if (path === "/api/studio/stop") {
          store.assertIdentity(IdentitySchema.strict().parse(value));
          await studio.stop();
          return json(response, 200, studio.state());
        }
        if (path === "/api/command") return json(response, 200, await store.execute(CommandSchema.parse(value)));
        if (path === "/api/import") return json(response, 200, await store.importSources(value));
        if (path === "/api/origin/apply") return json(response, 200, await originApply(store, value));
        if (path === "/api/arrange") {
          const identity = IdentitySchema.strict().parse(value);
          const operations = arrangeByFlow(store.session().project.document);
          if (operations.length === 0) return json(response, 200, { session: store.session(), moved: 0 });
          const result = await store.execute(CommandSchema.parse({ ...identity, requestId: randomUUID(), label: "Arrange by flow", operations }));
          return json(response, 200, { session: result.session, moved: operations.length });
        }
        if (path === "/api/undo" || path === "/api/redo")
          return json(response, 200, await store.history(path.endsWith("undo") ? "undo" : "redo", IdentitySchema.strict().parse(value)));
        if (path === "/api/selection") {
          const selection = z.object({ workspaceId: z.uuid(), ids: z.array(Id).max(500) }).strict().parse(value);
          return json(response, 200, store.select(selection.workspaceId, selection.ids));
        }
      }
      if (path.startsWith("/api/")) throw new CanvasError("not_found", "Unknown canvas operation", 404);
      throw new CanvasError("native_canvas", "Expo Canvas opens in its native app. This loopback endpoint serves the CLI, the MCP server and the canvas.", 404);
    } catch (error) {
      json(response, error instanceof CanvasError ? error.status : 400, errorBody(error));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4182, "127.0.0.1", resolve);
    });
  } catch (error) {
    await store.close();
    await release();
    throw error;
  }
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const lease = await projectPath(directory, ".expo-canvas/runtime.json", true);
  await writeFileAtomically(lease, JSON.stringify({ pid: process.pid, url, workspaceId: store.session().project.workspaceId }), 0o600);
  const unsubscribe = store.subscribe(() => {
    for (const reader of readers) reader.write("data: changed\n\n");
  });
  const heartbeat = setInterval(() => {
    for (const reader of readers) reader.write(": heartbeat\n\n");
  }, 15_000);
  return {
    url,
    store,
    studio,
    close: async () => {
      clearInterval(heartbeat);
      unsubscribe();
      for (const reader of readers) reader.end();
      await studio.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
      await unlink(lease).catch(() => {});
      await release();
    },
  };
}
