import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CommandSchema,
  CreateScreenSchema,
  Id,
  IdentitySchema,
  SourcePath,
} from "../shared/model";
import type { CanvasClient } from "./client";
import { doctor } from "./doctor";
import { StudioControlSchema, StudioCaptureSchema, StudioInspectSchema, StudioOpenSchema } from "../shared/studio";
import { ImportSchema, OriginApplySchema } from "../shared/import";

export async function startMcp(client: CanvasClient) {
  const server = new McpServer(
    { name: "mobile-canvas", version: "0.1.0" },
    {
      instructions:
        "Mobile Canvas is a native macOS canvas that runs real Expo screens side by side. Read the canvas before editing; carry workspaceId and sequence into every mutation. Screens are ordinary TSX under screens/, components/ or lib/; @expo-canvas/preview gives mock state and navigation by screen key, and each screen's links draw the app flow. One canvas_batch is one undoable transaction; source.write needs the hash from canvas_read_source. canvas_studio_open opens the canvas (authored Expo 54 or linked Expo 56/57, iOS on Mac, up to 32 frames); pass screen to fit and center one whole frame. Use canvas_route_map for linked app screen IDs, then canvas_inspect_screen to focus a frame and receive its native image and metadata with visible agent presence. Use canvas_studio_capture for a canvas overview; use native computer tools for pointer interaction. canvas_import brings an existing Expo app onto the canvas: prefer link so the app's own source runs in place and lib/ holds only overrides keyed by app path; keep the original app untouched, review with canvas_origin_diff and carry files back only with canvas_origin_apply when asked. Keep themes scoped per screen, never global. Each screen's notes describe purpose, fixture states, interactions and destinations. No cloud or media generation is involved. Experimental Swift projects use nativePreview metadata: canvas_import discovers source-backed screen flows and reuses existing preview factories; missing preview data remains visible. Swift source overrides use source.write plus native.override with the original source hash. Re-import refreshes Xcode target membership. Swift edits require native rebuild/relaunch; ordinary Swift app navigation is not yet pinned.",
    },
  );
  const register = (
    name: string,
    description: string,
    schema: z.ZodObject<any>,
    handler: (args: any) => Promise<unknown>,
    readOnly = false,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await handler(args)),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    );
  };
  register(
    "canvas_read",
    "Read the project, ordered screens, source hashes, human selection, history and code version.",
    z.object({}),
    () => client.read(),
    true,
  );
  register("canvas_environment", "Check Mac prerequisites without installing anything: architecture, Node, Xcode, CocoaPods, signing configuration and linked app dependencies. Returns actionable missing/manual checks; successful checks do not prove a native build or pixels.", z.object({}), () => client.request("/environment"), true);
  register("canvas_studio_open", "Open the native canvas (authored Expo 54 or linked Expo 56/57 on Apple silicon) for this project, or bring it forward if it is already open. Up to 32 frames mount live as they scroll into view. Pass screen (an ID) to fit and center that whole frame as soon as it renders, like opening a URL. Requires the built, signed native host and runs the project's code.", StudioOpenSchema, (value) => client.request("/studio/open", value));
  register("canvas_studio_state", "Read native studio host identity, SDK, mounted screen instances, current source versions, isolated mock state, readiness, waitingCount for missing route examples and errors. This reports runtime state, not screenshot evidence.", z.object({}), () => client.request("/studio/state"), true);
  register("canvas_studio_control", "Focus a live canvas frame, reset only that frame's mock state, fit all frames, or zoom the canvas (scale 0.25 to 1.5, optionally revealing one screen) before a capture. Commands are asynchronous; inspect subsequent studio state or the native UI for completion.", StudioControlSchema, (value) => client.request("/studio/control", value));
  register("canvas_studio_stop", "Close this project's owned native canvas and Metro session.", IdentitySchema.strict(), (value) => client.request("/studio/stop", value));
  server.registerTool("canvas_studio_capture", {
    description: "Capture this native canvas's actual composited Mac window as an image, including all visible frames and native sheets. This is visual evidence, not a replacement for live interaction. Requires the window to be visible and macOS screen capture access; does not start project code. The local PNG is disposable and is not document history.",
    inputSchema: StudioCaptureSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (value) => {
    try {
      const { data, ...capture } = await client.request("/studio/capture", value);
      return { content: [{ type: "text" as const, text: JSON.stringify(capture) }, { type: "image" as const, mimeType: "image/png", data }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  server.registerTool("canvas_inspect_screen", {
    description: "Look at one screen from the sitemap. Visibly focuses and fits the whole frame, shows an Agent inspecting ring, waits for current rendering and returns a native screen image plus props, route, source, notes, links and runtime state. The indicator changes to Captured for agent then clears. Requires an open native canvas; does not execute new project code or edit the document. This changes the shared human viewport.",
    inputSchema: StudioInspectSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async value => {
    try {
      const { data, ...result } = await client.request("/studio/inspect", value);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }, { type: "image" as const, mimeType: "image/png", data }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  register(
    "canvas_read_source",
    "Read an ordinary Expo source file and its current SHA-256. Use that hash for source.write.",
    z.object({ path: SourcePath }),
    ({ path }) => client.request(`/source?path=${encodeURIComponent(path)}`),
    true,
  );
  register(
    "canvas_read_route_source",
    "Read the actual linked app TSX or Swift for a screen ID from canvas_route_map, or its active project override. Returns code, hash, original app path and preview source. The original app is read-only: write an experiment override with source.write plus resolver.update, then reopen once for the resolver; subsequent TSX edits hot reload.",
    z.object({ screenId: Id }),
    ({ screenId }) => client.request(`/route-source?screenId=${encodeURIComponent(screenId)}`),
    true,
  );
  register(
    "canvas_batch",
    "Apply a bounded, atomic screen/source transaction. Returns stable key-to-ID mapping for created screens. No native code executes during this command.",
    CommandSchema,
    (command) => client.request("/command", command),
  );
  register(
    "canvas_import",
    "Import an Expo or supported Swift app in one undoable transaction. Swift targets produce a source-backed screen map independently of preview availability; only registered factories supply live UI. Prefer link: true to keep source in place. With map: true, discover Expo Router routes and content navigation and arrange their frames. Set preview: true to render actual Expo 56/57 routes with their providers and native navigation in a separate SDK-matched host; native execution/build happens only on studio open. Protected routes are visible and SQLite is isolated per frame; real dynamic IDs are observed from rendered links into props.params. Shared navigator contexts use one frame per source. Without preview, map creates explicitly labeled metadata cards without executing app code. With offline: true, use the explicit design environment: disconnected Clerk/Convex/purchases/telemetry adapters and public icon substitutes, recorded in native screen state. No API keys are needed for supported local screens; remote records and store-hosted UI remain unavailable. No app source is copied or modified. Re-import adds missing routes, upgrades untouched metadata cards when enabling preview, and preserves authored source, IDs, notes, links and placement. Reopen after resolver changes.",
    ImportSchema,
    (value) => client.request("/import", value),
  );
  register(
    "canvas_native_preview_catalog",
    "Read a Swift app's existing component previews, source evidence for animations and bundled image assets without running app code. Add selected previews with canvas_import.swiftPreviews using a label or factory ID; they stay separate from navigation. Explicit per-frame native.imageFixtures can feed a bundled asset to supported Kingfisher views. An animation hint is not proof of visible motion.",
    z.object({}),
    () => client.request('/native/catalog',{}),
  );
  register(
    "canvas_route_map",
    "Read the app sitemap: stable screen IDs/keys, route and original source file, layouts, current params and their observed example, flow links and notes. Use canvas_inspect_screen with a screen ID for visible focus, a native image and metadata; canvas_studio_open or canvas_studio_control can focus without capture. Expo routes are pinned; Swift navigation limits are reported per route. liveAppPreview means rendering is configured; check studio state and capture for execution/pixels. Missing dynamic examples are explicitly waiting-for-link.",
    z.object({}),
    async () => {
      const session = await client.read();
      if (session.project.document.nativePreview) {
        const screens = session.project.document.screenIds.map(id=>session.project.document.screens[id]);
        return {kind: "swift-screen-map", liveAppPreview: !session.project.document.nativePreview.buildIssues?.length, adapter: "swift-ios", origin: session.project.document.origin,
          buildIssues: session.project.document.nativePreview.buildIssues ?? [],
          buildStrategy: session.project.document.nativePreview.buildStrategy ?? 'standalone',
          context: session.project.document.nativePreview.context ?? 'isolated',
          buildNotes: session.project.document.nativePreview.buildNotes ?? [],
          coverage: {visualFrames: screens.length, sourceDestinations: new Set(screens.filter(s => (s.props.native as any)?.symbol).map(s => {const native=s.props.native as any;return `${native.file}:${native.symbol}`;})).size,
            composedStates: screens.filter(s => (s.props.native as any)?.scene).length,
            recipeFactories: screens.filter(s => (s.props.native as any)?.recipe).length,
            previewFactories: screens.filter(s => (s.props.native as any)?.factory && !(s.props.native as any)?.issue).length,
            needsPreviewData: screens.filter(s => (s.props.native as any)?.issue && !['build-integration','app-startup'].includes((s.props.native as any)?.blocker?.kind)).length,
            needsAppStartup: screens.filter(s => (s.props.native as any)?.blocker?.kind === 'app-startup').length,
            needsBuildIntegration: screens.filter(s => (s.props.native as any)?.blocker?.kind === 'build-integration').length,
            blockers: screens.filter(s => (s.props.native as any)?.blocker).map(s => ({key:s.key, ...(s.props.native as any).blocker})),
            discovery: "SwiftSyntax: root composition, direct/value navigation, sheets, fullscreen covers, recognized coordinator calls and switch-selected panes. Source evidence is inferred; dynamic routing and arbitrary local states are not exhaustive.",
            data: "Existing previews and inferred recipes reuse app-local demo objects or default initializers; recipe provenance is in each route. Optional inputs may be nil and action callbacks inert. Missing factories remain in the map. App services and global state are not sandboxed. A factory is not proof of populated or reachable UI."},
          routes: screens.map(s => ({...s, native: s.props.native, capabilities: {
            navigation: (s.props.native as any)?.scene ? "The assigned parent selector is pinned. Recognized case changes request focus on the corresponding frame; other model mutations and arbitrary navigation remain local." : "Catalog destination buttons and explicit CanvasPreviewContext focus frames. Uninstrumented app navigation remains local.",
            reload: "native rebuild", state: "frame-local; native globals shared"}}))};
      }
      const mapped = session.project.document.screenIds.map(id => session.project.document.screens[id]).filter(screen => screen.props.route);
      return {
        coverage: { visualFrames: mapped.length, sourceRoutes: new Set(mapped.map(screen => (screen.props.route as any).file)).size, pinnedSteps: mapped.filter(screen => (screen.props.route as any).step).length,
          discovery: "Static routes and recognized finite pagers. Arbitrary local states, state-driven redirects and backend records are not exhaustively enumerated.",
          links: "Inferred content navigation with source evidence, plus ordered step transitions. Tab and back controls are excluded. Validate runtime behavior before treating this as a complete flow.",
          data: session.project.document.appPreview?.offline ? "Isolated local app data; supported services disconnected. No remote records or in-memory state transferred between frames." : "App providers with isolated frame state. Route parameters do not transfer provider state." },
        previewEnvironment: session.project.document.appPreview?.offline ? "design" : "app", kind: session.project.document.appPreview ? "native-app-routes" : "static-route-map", liveAppPreview: !!session.project.document.appPreview,
        origin: session.project.document.origin ?? null,
        routes: session.project.document.screenIds.map((id) => session.project.document.screens[id])
          .filter((screen) => screen.source === `screens/route-${screen.key}.tsx` && screen.props.route)
          .map((screen) => ({ id: screen.id, key: screen.key, name: screen.name, source: screen.source, route: screen.props.route, params: screen.props.params ?? {}, routeExample: screen.props.routeExample ?? null, links: screen.links, notes: screen.notes, previewIssues: screen.props.issues })),
      };
    },
    true,
  );
  register(
    "canvas_arrange",
    "Lay the frames out by navigation flow in one undoable transaction: columns by depth from the entry screen, rows ordered by their parents, design variants in a band under the screen they vary. Uses each screen's links; the native canvas draws those links as flow connectors.",
    IdentitySchema.strict(),
    (value) => client.request("/arrange", value),
  );
  register(
    "canvas_origin_diff",
    "Compare this project's lib/ files with the app they were imported from: diverged files show what an adaptation or design direction changed, added files are new screens or helpers. Returns unified diffs. Read-only; use it to review a direction before anything is carried back.",
    z.object({ files: z.array(SourcePath).max(64).optional() }),
    ({ files }) => client.request(`/origin/diff?files=${encodeURIComponent((files ?? []).join(","))}`),
    true,
  );
  register(
    "canvas_origin_apply",
    "Copy chosen lib/ files back into the imported app at their origin paths. This is the only operation that writes to the original app: use it only when the person has chosen a direction and asked to apply it. Refuses files whose origin changed since the import unless force is set; never deletes.",
    OriginApplySchema,
    (value) => client.request("/origin/apply", value),
  );
  register(
    "canvas_create_screens",
    "Create several screens in one transaction. Supply component code or an existing source path, or omit both for the native switch/button starter. Different props may share a source file.",
    IdentitySchema.extend({
      requestId: z.string().min(1).max(128),
      label: z.string().default("Create screens"),
      screens: z.array(CreateScreenSchema).min(1).max(32),
    }),
    ({ screens, ...command }) =>
      client.request("/command", {
        ...command,
        operations: screens.map((screen: unknown) => ({
          type: "screen.create",
          screen,
        })),
      }),
  );
  register(
    "canvas_history",
    "Undo or redo one complete canvas/source transaction. External source edits are protected.",
    IdentitySchema.extend({ direction: z.enum(["undo", "redo"]) }),
    ({ direction, ...identity }) => client.request(`/${direction}`, identity),
  );
  register(
    "canvas_selection",
    "Read the human's ephemeral selection without triggering an agent turn.",
    z.object({}),
    async () => {
      const session = await client.read();
      return {
        workspaceId: session.project.workspaceId,
        ids: session.selection,
        screens: session.selection.map(
          (id) => session.project.document.screens[id],
        ),
      };
    },
    true,
  );
  register(
    "canvas_doctor",
    "Check source references, navigation links, resolver mappings, the native canvas and, for imported apps, what the experiment changed versus the app.",
    z.object({}),
    () => doctor(client),
    true,
  );
  register(
    "canvas_url",
    "Get the local runtime endpoint for CLI/MCP diagnostics. The human canvas is the native app; the default endpoint does not serve a browser editor.",
    z.object({}),
    async () => ({ url: client.url }),
    true,
  );
  await server.connect(new StdioServerTransport());
  return server;
}
