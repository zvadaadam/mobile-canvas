import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const linkedRouteSource = 'import { createElement } from "react";\nexport default function AppRoute(props: Record<string, unknown>) { return createElement(require("expo-canvas-linked-app").default, props); }\n';

/** A Metro-readable context of literal, lazy requires. Mapping never executes app code. */
export async function routeContext(app: string, directory: string) {
  const root = join(app, directory);
  const paths = (await readdir(root, { recursive: true })).filter(file => /\.[jt]sx?$/.test(file) && !/\+api\.[jt]sx?$/.test(file)).sort();
  return `// Generated from the linked app's routes.\nconst routes = {\n${paths.map(file => `${JSON.stringify("./" + file)}: () => require(${JSON.stringify(join(root, file))})`).join(",\n")}\n};\nexport function context(key) { return routes[key](); }\ncontext.keys = () => Object.keys(routes);\ncontext.resolve = key => key;\ncontext.id = "expo-canvas-linked-routes";\n`;
}
