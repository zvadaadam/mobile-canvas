/** Local test transport for the official MCP Apps basic-host. Production uses stdio. */
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { startRuntime, discoverRuntime } from "../src/runtime/server";
import { CanvasClient } from "../src/runtime/client";
import { createMcpServer } from "../src/runtime/mcp";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    port: { type: "string", default: "43182" },
    origin: { type: "string", default: "http://localhost:43180" },
  },
});
if (!values.project)
  throw new Error(
    "Pass --project <existing experiment>. Native code runs only when Open is requested.",
  );
const origin = new URL(values.origin!);
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("This test server accepts a loopback host only.");
const project = resolve(values.project);
const existing = await discoverRuntime(project);
const owned = existing ? undefined : await startRuntime({ project, port: 0 });
const canvas = new CanvasClient(existing ?? owned!.url);
const http = createServer(async (request, response) => {
  if (
    !/^(localhost|127\.0\.0\.1):\d+$/.test(request.headers.host ?? "") ||
    (request.headers.origin && request.headers.origin !== origin.origin)
  ) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", origin.origin);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  );
  response.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS",
  );
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.url !== "/mcp") {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const server = createMcpServer(canvas);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500).end();
  }
});
http.listen(Number(values.port), "127.0.0.1", () =>
  console.log(`MCP Apps test endpoint: http://127.0.0.1:${values.port}/mcp`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    http.close();
    await owned?.close();
    process.exit(0);
  });
