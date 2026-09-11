import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import type { ImportDependency, ImportReport, ImportRequest } from "../../../shared/import";
import { SourcePath } from "../../../shared/model";
import { CanvasError } from "../../errors";
import { repository } from "../../paths";
import { dirname, resolve } from "node:path";
import { buildRouteMap } from "./frames";
import { appDependencies, dependencyIssue } from "./app-dependencies";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const skippedDirectories = new Set(["node_modules", ".git", ".expo", "ios", "android", "build", "dist", "__tests__", "__mocks__", "coverage"]);
const hostModules = join(repository, "apps/native-host/node_modules");
/** Packages provided by the host runtime itself, whether or not they are top-level dependencies. */
const hostProvided = new Set(["react", "react-native", "expo", "expo-modules-core", "@expo-canvas/preview", "expo-canvas-screens"]);

export interface PlannedFile { from: string; to: string; code: string; hash: string }
export interface ImportPlan extends ImportReport { planned: PlannedFile[]; previewSdk?: 56 | 57 }

const toPosix = (value: string) => value.split(sep).join("/");
function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*");
  return new RegExp(`^${escaped}(/.*)?$`);
}
const matchesAny = (patterns: string[] | undefined, path: string) =>
  !!patterns?.some((pattern) => globToRegExp(pattern.replace(/\/+$/, "")).test(path));
export function packageName(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
async function readJson(path: string): Promise<any | null> {
  try {
    const text = await readFile(path, "utf8");
    return ts.parseConfigFileTextToJson(path, text).config ?? null;
  } catch {
    return null;
  }
}
async function installedVersion(directory: string, name: string) {
  const info = await readJson(join(directory, name, "package.json"));
  return typeof info?.version === "string" ? (info.version as string) : null;
}
const fileCandidates = ["", ".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs", "/index.js", "/index.ts", "/index.tsx"];
const fileExists = (base: string) => fileCandidates.some((suffix) => existsSync(base + suffix) && (suffix !== "" || !existsSync(join(base, "package.json")) || true));
/** Whether an installed package can serve this exact specifier: an exports entry, or a real file for the subpath or entry point. */
async function specifierResolvable(directory: string, specifier: string) {
  const pkg = packageName(specifier);
  const root = join(directory, pkg);
  if (!existsSync(root)) return false;
  const subpath = specifier.slice(pkg.length);
  const manifest = await readJson(join(root, "package.json"));
  const exportsMap = manifest?.exports;
  if (exportsMap && typeof exportsMap === "object" && !Array.isArray(exportsMap)) {
    const wanted = `.${subpath}`;
    const keys = Object.keys(exportsMap);
    if (keys.some((key) => key === wanted)) return true;
    if (keys.some((key) => key.includes("*") && new RegExp(`^${key.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(wanted))) return true;
  }
  if (subpath) return fileExists(join(root, subpath.slice(1)));
  if (typeof manifest?.main === "string") return fileExists(join(root, manifest.main.replace(/^\.\//, "")));
  return fileExists(join(root, "index"));
}
function routeFor(file: string) {
  const segments = file.replace(/\.tsx?$/, "").split("/").filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.at(-1) === "index") segments.pop();
  return "/" + segments.join("/");
}
/** Runtime import and export specifiers of one file; type-only imports never reach Metro. */
export function moduleSpecifiers(path: string, code: string) {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.ES2022, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly
        || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...specifiers];
}

/**
 * Read an existing Expo app and plan a copy of its source into this project:
 * `src/x.ts` becomes `lib/x.ts`, the app's TypeScript alias maps onto `lib/`,
 * Expo Router route files are listed rather than copied, and every bare
 * dependency is classified against the native host. Nothing is written here.
 */
export async function planImport(project: string, request: Omit<ImportRequest, "workspaceId" | "sequence" | "requestId">): Promise<ImportPlan> {
  let from: string;
  try {
    from = await realpath(request.from);
    if (!(await stat(from)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new CanvasError("import_source", `Cannot read an Expo app at ${request.from}`);
  }
  const projectRoot = await realpath(project);
  if (request.map && !request.link) throw new CanvasError("import_map", "Route mapping requires link: true; the app stays in place.");
  if (request.preview && (!request.map || !request.link)) throw new CanvasError("import_preview", "App preview requires link: true and map: true.");
  if (request.offline && !request.preview) throw new CanvasError("import_preview", "The design environment requires a native app preview.");
  const sdk = Number((await installedVersion(join(from, "node_modules"), "expo"))?.split(".")[0]);
  const previewSdk = request.preview && (sdk === 56 || sdk === 57) ? sdk : undefined;
  if (request.preview && !previewSdk) {
    const app = await appDependencies(from);
    throw new CanvasError("import_preview", app.installedExpo
      ? `Automatic native app preview supports Expo SDK 56 and 57; this app has Expo ${app.installedExpo}. Use map --app for source-only discovery.`
      : dependencyIssue(app) ?? "Install Expo SDK 56 or 57 dependencies in the app before opening its native preview.");
  }
  if (from === projectRoot || from.startsWith(projectRoot + sep) || projectRoot.startsWith(from + sep))
    throw new CanvasError("import_source", "Import from a separate app directory, not from inside this project or its parent.");
  const packageJson = await readJson(join(from, "package.json"));
  if (!packageJson) throw new CanvasError("import_source", "The app directory has no readable package.json.");
  const appJson = await readJson(join(from, "app.json"));
  const name = request.name ?? (typeof appJson?.expo?.name === "string" ? appJson.expo.name : null) ?? (typeof packageJson.name === "string" ? packageJson.name : "Imported app");
  const declared: Record<string, string> = { ...(packageJson.devDependencies ?? {}), ...(packageJson.dependencies ?? {}) };
  const commit = await promisify(execFile)("git", ["-C", from, "rev-parse", "HEAD"], { timeout: 5000 })
    .then(({ stdout }) => (/^[a-f0-9]{7,64}$/.test(stdout.trim()) ? stdout.trim() : null), () => null);

  // The TypeScript alias tells us where application code lives; the rest is convention.
  const tsconfig = await readJson(join(from, "tsconfig.json"));
  const paths: Record<string, string[]> = tsconfig?.compilerOptions?.paths ?? {};
  const aliasRoots: [prefix: string, directory: string][] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets?.[0];
    if (!pattern.endsWith("/*") || typeof target !== "string" || !target.endsWith("/*")) continue;
    const directory = target.slice(0, -2).replace(/^\.\//, "").replace(/^\//, "");
    aliasRoots.push([pattern.slice(0, -1), directory]);
  }
  const rootDirectory = aliasRoots.find(([, directory]) => directory && !directory.includes("/") && existsSync(join(from, directory)))?.[1]
    ?? (existsSync(join(from, "src")) ? "src" : "");
  const aliases: Record<string, string> = {};
  const skipped: ImportPlan["skipped"] = [];
  const root = rootDirectory ? join(from, rootDirectory) : from;
  for (const [prefix, directory] of aliasRoots) {
    if (directory === rootDirectory && /^[@~A-Za-z0-9_-]+\/$/.test(prefix)) aliases[prefix] = request.link ? `${root}/` : "lib/";
    else skipped.push({ from: `${prefix}* (${directory})`, reason: "Only the source-root alias is mapped; other aliases need project files or resolver.modules." });
  }
  const routeDirectory = existsSync(join(root, "app")) ? join(root, "app") : existsSync(join(from, "app")) ? join(from, "app") : null;

  const planned: PlannedFile[] = [];
  const routes: ImportPlan["routes"] = [];
  const walkRoutes = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) { await walkRoutes(absolute); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
      const file = toPosix(relative(routeDirectory!, absolute));
      if (/(^|\/)_layout\.tsx?$/.test(file) || /(^|\/)\+/.test(file)) continue;
      const code = await readFile(absolute, "utf8");
      routes.push({ file: toPosix(relative(from, absolute)), route: routeFor(file), imports: moduleSpecifiers(file, code).filter((specifier) => !/^(react|react-native|expo)$/.test(packageName(specifier))) });
    }
  };
  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const relativePath = toPosix(relative(root, absolute));
      if (entry.isSymbolicLink()) { skipped.push({ from: relativePath, reason: "symlink" }); continue; }
      if (entry.isDirectory()) {
        if (skippedDirectories.has(entry.name)) continue;
        if (routeDirectory && absolute === routeDirectory) { await walkRoutes(absolute); continue; }
        if (!rootDirectory && ["designs", "docs", "design", "scripts", "assets"].includes(entry.name)) continue;
        await walk(absolute);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      if (request.include && !matchesAny(request.include, relativePath)) continue;
      if (matchesAny(request.exclude, relativePath)) { skipped.push({ from: relativePath, reason: "excluded" }); continue; }
      const to = `lib/${relativePath}`;
      if (!SourcePath.safeParse(to).success) { skipped.push({ from: relativePath, reason: "unsupported path characters" }); continue; }
      const bytes = await readFile(absolute);
      if (bytes.length > 100_000) { skipped.push({ from: relativePath, reason: "larger than 100 KB" }); continue; }
      const code = bytes.toString("utf8");
      planned.push({ from: toPosix(relative(from, absolute)), to, code, hash: digest(code) });
    }
  };
  await walk(root);
  if (routeDirectory && !routes.length) await walkRoutes(routeDirectory);
  if (planned.length === 0 && routes.length === 0) throw new CanvasError("import_empty", "No TypeScript source or Expo Router routes matched. Check the app's source root.");
  const appModules = join(from, "node_modules");

  // Classify every runtime dependency against what the native host can actually load.
  const usage = new Map<string, Set<string>>();
  for (const file of planned) {
    for (const specifier of moduleSpecifiers(file.to, file.code)) {
      if (specifier.startsWith(".") || specifier.startsWith("/") || Object.keys(aliases).some((prefix) => specifier.startsWith(prefix))) continue;
      if (!usage.has(specifier)) usage.set(specifier, new Set());
      usage.get(specifier)!.add(file.to);
    }
  }
  // Route and layout dependencies matter too, even when no app source is copied.
  if (request.map && routeDirectory) {
    const scanRoutes = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) { await scanRoutes(absolute); continue; }
        if (!entry.isFile() || !/\.[jt]sx?$/.test(entry.name)) continue;
        for (const specifier of moduleSpecifiers(absolute, await readFile(absolute, "utf8"))) {
          if (specifier.startsWith(".") || specifier.startsWith("/") || Object.keys(aliases).some((prefix) => specifier.startsWith(prefix))) continue;
          if (!usage.has(specifier)) usage.set(specifier, new Set());
          usage.get(specifier)!.add(toPosix(relative(from, absolute)));
        }
      }
    };
    await scanRoutes(routeDirectory);
  }
  const dependencies: ImportDependency[] = [];
  const projectModules = join(projectRoot, "node_modules");
  for (const [specifier, files] of [...usage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pkg = packageName(specifier);
    if (request.preview && packageJson.dependencies?.[pkg] && pkg !== "expo-dev-client" && pkg !== "expo-updates") {
      const installed = await installedVersion(appModules, pkg);
      const servable = installed && (hostProvided.has(pkg) || await specifierResolvable(appModules, specifier));
      dependencies.push({ specifier, package: pkg, status: servable ? "matched-host" : "missing", declared: declared[pkg] ?? null, installed,
        files: [...files].sort(), note: servable ? "The generated native host uses this installed app version; studio open builds it when needed." : "This specifier is not available in the installed app dependencies." });
      continue;
    }
    const copying = request.modules?.includes(pkg) ?? false;
    const inHost = hostProvided.has(pkg) || existsSync(join(hostModules, pkg));
    const inProject = copying || existsSync(join(projectModules, pkg));
    // A linked app's own JavaScript-only packages serve it in place; native packages must come from the host.
    const inApp = !inHost && !inProject && request.link && existsSync(join(appModules, pkg)) && !(await hasNativeCode(join(appModules, pkg)));
    const installed = inHost ? await installedVersion(hostModules, pkg)
      : inProject ? (copying ? await installedVersion(appModules, pkg) : await installedVersion(projectModules, pkg))
      : inApp ? await installedVersion(appModules, pkg) : null;
    // A package that is installed may still not serve this specifier, such as a subpath that a newer SDK added.
    const servable = inHost ? hostProvided.has(pkg) || (await specifierResolvable(hostModules, specifier))
      : inProject ? copying || (await specifierResolvable(projectModules, specifier))
      : inApp ? await specifierResolvable(appModules, specifier) : false;
    const status: ImportDependency["status"] = servable ? (inHost ? "host" : inProject ? "project" : "app") : "missing";
    const note = !servable && installed ? `${pkg} ${installed} is installed but does not provide ${specifier}` : undefined;
    dependencies.push({ specifier, package: pkg, status, declared: declared[pkg] ?? null, installed, files: [...files].sort(), ...(note ? { note } : {}) });
  }
  const mode = request.link ? "linked" : "copied";
  if (request.map && !routeDirectory) throw new CanvasError("import_routes", "No app/ or src/app/ Expo Router directory found. Other navigation systems are not mapped yet.");
  const routeMap = request.map ? await buildRouteMap({ app: from, routesDirectory: toPosix(relative(from, routeDirectory!)), aliases }) : undefined;
  const previewIssues = routeMap ? request.preview ? [
    "Expo Router protected routes are visible in canvas previews. App providers and native navigation run unchanged.",
    "SQLite uses separate storage per frame. App migrations and bundled content run; no records are invented.",
    "Dynamic routes need real parameters in props.params to display a particular record.",
  ] : [
    "Source-only route map. App code has not run; open --app enables native previews for installed Expo SDK 56/57 apps.",
    ...(declared.expo ? [`App declares Expo ${declared.expo}; native canvas provides Expo 54.0.37. API compatibility is not guaranteed.`] : []),
    ...dependencies.filter((dependency) => dependency.status === "missing").map((dependency) => `Unavailable: ${dependency.specifier}${dependency.note ? ` (${dependency.note})` : ""}`),
  ] : undefined;
  return { name, from, mode, commit, root: rootDirectory, aliases, files: mode === "linked" ? [] : planned.map(({ from, to }) => ({ from, to })), skipped, routes, dependencies,
    copiedModules: [], planned: mode === "linked" ? [] : planned, ...(routeMap ? { routeMap, previewIssues } : {}), ...(previewSdk ? { previewSdk } : {}) };
}

/** Copy JavaScript-only packages from the app into the project's node_modules and record them in its package.json. */
export async function copyModules(project: string, from: string, modules: string[]) {
  const copied: { name: string; version: string }[] = [];
  const target = join(project, "node_modules");
  for (const name of modules) {
    const source = join(from, "node_modules", name);
    const version = await installedVersion(join(from, "node_modules"), name);
    if (!version) throw new CanvasError("import_module", `${name} is not installed in the app's node_modules.`);
    if (await hasNativeCode(source)) throw new CanvasError("import_module", `${name} contains native code. Add it to apps/native-host instead of copying it into a project.`);
    await mkdir(join(target, name), { recursive: true });
    await cp(source, join(target, name), { recursive: true, dereference: true, filter: (path) => !path.split(sep).includes(".git") });
    copied.push({ name, version });
  }
  const manifestPath = join(project, "package.json");
  const manifest = (await readJson(manifestPath)) ?? { name: basename(project), private: true, dependencies: {} };
  manifest.dependencies = { ...(manifest.dependencies ?? {}), ...Object.fromEntries(copied.map(({ name, version }) => [name, version])) };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return copied;
}
export async function hasNativeCode(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => (entry.isFile() && /\.podspec$/.test(entry.name)) || (entry.isDirectory() && (entry.name === "ios" || entry.name === "android")))
    || existsSync(join(directory, "expo-module.config.json"));
}
