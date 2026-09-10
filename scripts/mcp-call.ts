/**
 * A terminal client for the real stdio MCP server, for hosts without attached
 * tools: lists tools or calls one with JSON arguments from a file.
 *
 *   node --import tsx scripts/mcp-call.ts <project> [list|tool-name] [arguments.json]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { repository } from "../src/runtime/paths";

const [project, tool = "list", file] = process.argv.slice(2);
if (!project) throw new Error("Usage: node --import tsx scripts/mcp-call.ts <project> [list|tool-name] [arguments.json]");
const client = new Client({ name: "expo-canvas-terminal", version: "1" });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(repository, "bin/expo-canvas.mjs"), "mcp", "--project", resolve(project)],
    stderr: "inherit",
  }));
  if (tool === "list") {
    console.log(JSON.stringify(await client.listTools(), null, 2));
  } else {
    const args = file ? JSON.parse(await readFile(file, "utf8")) : {};
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 140_000 });
    for (const block of (result.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[]) {
      if (block.type === "text") console.log(block.text);
      else if (block.type === "image" && block.data) {
        const folder = join(repository, ".context/mcp-images");
        await mkdir(folder, { recursive: true });
        const path = join(folder, `${Date.now()}-${randomUUID()}.${block.mimeType === "image/png" ? "png" : "jpg"}`);
        await writeFile(path, Buffer.from(block.data, "base64"));
        console.log(JSON.stringify({ image: path, mimeType: block.mimeType }));
      }
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
