import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CanvasAppView, CanvasAppCapture } from "../../src/shared/mcp-app";

const app = new App(
  { name: "Mobile Canvas", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: CanvasAppView | undefined;
let selected: string | undefined;
let capture: CanvasAppCapture | undefined;
let busy = false;
let polling = false;
let mode: "map" | "screen" = "map";
let expanded = false;
const showError = (message?: string) => {
  element("error").textContent = message ?? "";
  element("error").hidden = !message;
};

function accept(result: {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}) {
  if (result.isError)
    throw new Error(
      result.content?.find((block) => block.type === "text")?.text ??
        "The canvas request failed.",
    );
  const next = (
    result.structuredContent as { view?: CanvasAppView } | undefined
  )?.view;
  if (!next || !Array.isArray(next.screens))
    throw new Error(
      "This result has no screen map. Ask the agent to call canvas_view again.",
    );
  if (view?.workspaceId !== next.workspaceId) {
    selected = undefined;
    capture = undefined;
  }
  if (view?.workspaceId === next.workspaceId && next.sequence < view.sequence)
    return;
  const changed = JSON.stringify(view) !== JSON.stringify(next);
  view = next;
  if (selected && !view.screens.some((screen) => screen.id === selected)) {
    selected = undefined;
    capture = undefined;
  }
  if (result._meta?.capture)
    capture = result._meta.capture as unknown as CanvasAppCapture;
  if (changed || result._meta?.capture) render();
}

async function action(
  action: "refresh" | "open" | "inspect",
  screenId?: string,
) {
  if (!view || busy) return;
  busy = true;
  showError();
  render();
  try {
    const result = await app.callServerTool({
      name: "canvas_app_action",
      arguments: {
        workspaceId: view.workspaceId,
        sequence: view.sequence,
        action,
        ...(screenId ? { screenId } : {}),
        ...(view.host.id ? { hostId: view.host.id } : {}),
      },
    });
    accept(result);
  } catch (error) {
    showError(
      `${error instanceof Error ? error.message : String(error)} Refresh the map before retrying.`,
    );
  } finally {
    busy = false;
    render();
  }
}

function choose(id: string) {
  if (busy) return;
  selected = id;
  mode = "screen";
  render();
  const screen = view?.screens.find((screen) => screen.id === id);
  if (screen)
    void app
      .updateModelContext({
        content: [
          {
            type: "text",
            text: `Mobile Canvas selection: ${screen.name} (${screen.key}), source ${screen.source}. Selection alone is not evidence of a rendered preview.`,
          },
        ],
      })
      .catch(() => {});
  if (view?.host.id && !view.host.starting) void action("inspect", id);
}

function renderGraph() {
  const svg = document.getElementById("graph") as unknown as SVGSVGElement;
  svg.replaceChildren();
  if (!view?.screens.length) return;
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  const marker = document.createElementNS(ns, "marker");
  for (const [key, value] of Object.entries({
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: "9",
    refY: "5",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto-start-reverse",
  }))
    marker.setAttribute(key, value);
  const arrow = document.createElementNS(ns, "path");
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrow.style.fill = "var(--muted)";
  marker.append(arrow);
  defs.append(marker);
  svg.append(defs);
  const minX = Math.min(...view.screens.map((s) => s.x)),
    minY = Math.min(...view.screens.map((s) => s.y));
  const points = new Map(
    view.screens.map((s) => [
      s.key,
      { x: (s.x - minX) / 3, y: (s.y - minY) / 10, screen: s },
    ]),
  );
  const width = Math.max(...[...points.values()].map((p) => p.x)) + 160;
  const height = Math.max(...[...points.values()].map((p) => p.y)) + 70;
  svg.setAttribute("viewBox", `-5 -5 ${width} ${height}`);
  // Keep labels readable in large apps and narrow chat panes; scroll the map.
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  for (const from of points.values())
    for (const key of from.screen.links) {
      const to = points.get(key);
      if (!to) continue;
      const line = document.createElementNS(ns, "line");
      const forward = to.y > from.y;
      for (const [k, v] of Object.entries({
        x1: from.x + 72,
        y1: from.y + (forward ? 55 : 0),
        x2: to.x + 72,
        y2: to.y + (forward ? 0 : 55),
      }))
        line.setAttribute(k, String(v));
      line.setAttribute("marker-end", "url(#arrow)");
      if (to.y <= from.y) line.setAttribute("stroke-dasharray", "4 3");
      svg.append(line);
    }
  for (const { x, y, screen } of points.values()) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `Review ${screen.name}`);
    group.setAttribute("class", screen.id === selected ? "selected" : "");
    group.addEventListener("click", () => choose(screen.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose(screen.id);
      }
    });
    const rect = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({
      x,
      y,
      width: 145,
      height: 55,
      rx: 7,
    }))
      rect.setAttribute(k, String(v));
    const title = document.createElementNS(ns, "title");
    title.textContent = screen.name;
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(x + 10));
    label.setAttribute("y", String(y + 24));
    label.textContent =
      screen.name.length > 19 ? screen.name.slice(0, 18) + "…" : screen.name;
    const sub = document.createElementNS(ns, "text");
    sub.setAttribute("x", String(x + 10));
    sub.setAttribute("y", String(y + 42));
    sub.style.fontSize = "9px";
    sub.textContent = screen.issue
      ? "Preview needs setup"
      : "Select to inspect";
    group.append(rect, title, label, sub);
    svg.append(group);
  }
}

function render() {
  if (!view) return;
  element("project").textContent =
    `${view.name} · ${view.kind === "swift" ? "Swift preview" : "Expo preview"}`;
  element("count").textContent = String(view.screens.length);
  element("status").textContent = busy
    ? "Working…"
    : view.host.starting
      ? "Native build starting…"
      : view.host.connected
        ? "Native canvas connected"
        : view.host.id
          ? "Native canvas paused"
          : "Native canvas closed";
  element<HTMLButtonElement>("refresh").disabled = busy;
  element<HTMLButtonElement>("open").disabled = busy || view.host.starting;
  const search = element<HTMLInputElement>("search").value.toLowerCase();
  const nav = element("screens");
  nav.replaceChildren();
  for (const screen of view.screens.filter((s) =>
    `${s.name} ${s.key}`.toLowerCase().includes(search),
  )) {
    const button = document.createElement("button");
    button.textContent = screen.name;
    button.setAttribute("aria-current", String(screen.id === selected));
    button.disabled = busy;
    button.addEventListener("click", () => choose(screen.id));
    if (screen.issue) {
      const badge = document.createElement("small");
      badge.textContent = "Unavailable";
      button.append(badge);
    }
    nav.append(button);
  }
  if (!nav.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = view.screens.length
      ? "No matching screens."
      : "No screens mapped yet. Import an app or add a screen.";
    nav.append(empty);
  }
  for (const tab of ["map", "screen"] as const) {
    element(`${tab}-panel`).hidden = mode !== tab;
    element(`${tab}-tab`).setAttribute("aria-selected", String(mode === tab));
  }
  const screen = view.screens.find((s) => s.id === selected);
  element("screen-name").textContent = screen?.name ?? "Choose a screen";
  element("source").textContent = screen?.source ?? "";
  element("notes").textContent = screen?.notes || "No screen notes yet.";
  element("issue").textContent = screen?.issue ?? view.host.error ?? "";
  element("issue").hidden = !element("issue").textContent;
  element<HTMLButtonElement>("inspect").disabled =
    busy || !screen || !view.host.id || view.host.starting;
  const image = element<HTMLImageElement>("capture");
  const current =
    capture && capture.screenId === selected ? capture : undefined;
  image.hidden = !current;
  element("empty").hidden = !!current;
  if (current) {
    const src = `data:image/png;base64,${current.data}`;
    if (image.src !== src) image.src = src;
    image.alt = `Native capture of ${screen?.name ?? "screen"}`;
    const stale =
      current.codeVersion !== view.codeVersion ||
      current.sequence !== view.sequence;
    element("capture-status").textContent =
      `${stale ? "Earlier capture — inspect again after changes" : "Native capture"} · ${new Date(current.capturedAt).toLocaleTimeString()} · ${current.width} × ${current.height}${current.error ? ` · ${current.error}` : ""}`;
  } else {
    image.removeAttribute("src");
    element("empty").textContent = !screen
      ? "Choose a screen from the list or flow map."
      : view.host.connected
        ? "Inspect this screen to see its current native pixels."
        : "Open the native canvas, then inspect this screen. Its place in the map is preserved.";
    element("capture-status").textContent =
      "Not inspected. A mapped screen is not proof of a working preview.";
  }
  const destinations = element("destinations");
  destinations.replaceChildren();
  for (const key of screen?.links ?? []) {
    const target = view.screens.find((s) => s.key === key);
    if (!target) continue;
    const button = document.createElement("button");
    button.textContent = `→ ${target.name}`;
    button.disabled = busy;
    button.addEventListener("click", () => choose(target.id));
    destinations.append(button);
  }
  renderGraph();
}

element("refresh").addEventListener("click", () => void action("refresh"));
element("open").addEventListener("click", () => void action("open", selected));
element("inspect").addEventListener(
  "click",
  () => void action("inspect", selected),
);
element("search").addEventListener("input", render);
for (const tab of ["map", "screen"] as const)
  element(`${tab}-tab`).addEventListener("click", () => {
    mode = tab;
    render();
  });
element("fullscreen").addEventListener("click", async () => {
  try {
    const result = await app.requestDisplayMode({
      mode: expanded ? "inline" : "fullscreen",
    });
    expanded = result.mode === "fullscreen";
    element("fullscreen").textContent = expanded ? "Collapse" : "Expand";
  } catch (error) {
    showError(String(error));
  }
});
app.ontoolresult = (result) => {
  try {
    accept(result);
    showError();
  } catch (error) {
    showError(String(error));
  }
};
app.ontoolcancelled = () => {
  busy = false;
  showError("The request was cancelled.");
  render();
};
function hostStyles(context: ReturnType<App["getHostContext"]>) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables)
    applyHostStyleVariables(context.styles.variables);
  element("fullscreen").hidden =
    !context?.availableDisplayModes?.includes("fullscreen");
  expanded = context?.displayMode === "fullscreen";
  element("fullscreen").textContent = expanded ? "Collapse" : "Expand";
}
app.onhostcontextchanged = (context) =>
  hostStyles({ ...app.getHostContext(), ...context });
await app.connect();
hostStyles(app.getHostContext());
// Metadata only; no automatic capture, native open or model turn. Pause offscreen.
const timer = setInterval(async () => {
  if (!view || busy || polling || document.visibilityState !== "visible")
    return;
  polling = true;
  try {
    accept(
      await app.callServerTool({
        name: "canvas_app_action",
        arguments: {
          workspaceId: view.workspaceId,
          sequence: view.sequence,
          action: "refresh",
        },
      }),
    );
  } catch {
    /* Explicit refresh reports connection errors without repeated alerts. */
  } finally {
    polling = false;
  }
}, 5000);
window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
