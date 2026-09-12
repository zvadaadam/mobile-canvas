import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { IdentitySchema, Id } from "../shared/model";
import type { CanvasAppView, CanvasAppCapture } from "../shared/mcp-app";
import type { CanvasClient } from "./client";
import { repository } from "./paths";

export const canvasAppUri = "ui://mobile-canvas/review.html";

export async function readCanvasAppView(
  client: CanvasClient,
): Promise<CanvasAppView> {
  const session = await client.read();
  const state = await client.request("/studio/state");
  const document = session.project.document;
  return {
    workspaceId: session.project.workspaceId,
    sequence: session.project.sequence,
    codeVersion: session.codeVersion,
    name: document.name,
    kind: document.nativePreview ? "swift" : "expo",
    host: {
      id: state.phase === "stopped" ? null : state.hostId,
      connected: state.connected,
      ready: state.ready,
      starting: state.starting,
      error: state.error,
    },
    screens: document.screenIds.map((id) => {
      const screen = document.screens[id];
      const native = screen.props.native;
      const origin = document.nativePreview ? native : screen.props.route;
      const file =
        origin && typeof origin === "object" && !Array.isArray(origin)
          ? origin.file
          : null;
      const issue =
        native && typeof native === "object" && !Array.isArray(native)
          ? native.issue
          : null;
      return {
        id,
        key: screen.key,
        name: screen.name,
        source: typeof file === "string" ? file : screen.source,
        notes: screen.notes,
        links: screen.links,
        x: screen.x,
        y: screen.y,
        width: screen.width,
        height: screen.height,
        issue: typeof issue === "string" ? issue : null,
      };
    }),
  };
}

export function registerCanvasApp(server: McpServer, client: CanvasClient) {
  registerAppResource(
    server,
    "mobile-canvas-review",
    canvasAppUri,
    {
      description:
        "Embedded screen map and native capture review. The iOS renderer stays on this Mac.",
    },
    async () => ({
      contents: [
        {
          uri: canvasAppUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(
            join(repository, "apps/mcp-app/dist/index.html"),
            "utf8",
          ),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "canvas_view",
    {
      description:
        "Show the interactive screen map and native screenshot review inside an MCP Apps-compatible client. Lists every frame, including unavailable ones. This reads project data; Open native and Inspect are explicit UI actions. Clients without MCP Apps still receive a text summary. Native rendering requires the local Mac host.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: canvasAppUri } },
    },
    async () => {
      const view = await readCanvasAppView(client);
      return {
        content: [
          {
            type: "text",
            text: `${view.name}: ${view.screens.length} mapped frames. Native canvas ${view.host.connected ? "connected" : view.host.starting ? "starting" : view.host.id ? "paused" : "closed"}. A map is not evidence of rendered pixels. Use canvas_read, canvas_route_map and canvas_inspect_screen when an embedded UI is unavailable.`,
          },
        ],
        structuredContent: { view },
      };
    },
  );

  registerAppTool(
    server,
    "canvas_app_action",
    {
      description:
        "UI actions for the embedded review. Refresh reads metadata; open executes native project code; inspect focuses the native window and returns a fresh image. Uses the current workspace/sequence and host identity; never edits source or applies files.",
      inputSchema: IdentitySchema.extend({
        action: z.enum(["refresh", "open", "inspect"]),
        screenId: Id.optional(),
        hostId: z.uuid().optional(),
      }).shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ action, screenId, hostId, ...identity }) => {
      try {
        // Even reads reject a widget left over from another project. Refresh may
        // read a newer sequence; actions always pass the widget's identity through.
        const current = await client.read();
        if (current.project.workspaceId !== identity.workspaceId)
          throw new Error(
            "This view belongs to a different workspace. Open a new canvas_view.",
          );
        let capture: CanvasAppCapture | undefined;
        if (action === "open")
          await client.request("/studio/open", {
            ...identity,
            ...(screenId ? { screen: screenId } : {}),
          });
        if (action === "inspect") {
          const result = await client.request("/studio/inspect", {
            ...identity,
            hostId,
            screenId,
          });
          capture = {
            data: result.data,
            screenId: result.screen.id,
            codeVersion: result.codeVersion,
            sequence: identity.sequence,
            capturedAt: result.capturedAt,
            width: result.width,
            height: result.height,
            error: result.error,
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                action === "inspect"
                  ? "Native frame captured."
                  : `Canvas ${action} complete.`,
            },
          ],
          structuredContent: { view: await readCanvasAppView(client) },
          ...(capture ? { _meta: { capture } } : {}),
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );
}
