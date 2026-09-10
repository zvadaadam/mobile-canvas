import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { connectRouteGuards } from "./guards";
import { discoverPager } from "./pagers";

/**
 * Reads an Expo Router app's route tree and turns every route into a canvas
 * frame: its layout chain, the static navigator options that decide chrome
 * and safe areas, a readable name, and the routes its source navigates to.
 * Everything here is deterministic static analysis; nothing runs the app.
 */

/** Estimated phone insets, reported as layout metadata only. */
const device = { statusBar: 59, navigationBar: 44, largeTitle: 52, searchBar: 52, homeIndicator: 34, tabBar: 66, sheetGrabber: 20 } as const;

import type { StaticValue, StaticOptions, NavigatorKind, LayoutInfo, TabInfo, RouteFrame, RouteMap } from "../shared/routes";

export interface ImportBinding { specifier: string; default: boolean; named: string[]; namespace: string | null; members: string[] }

const toPosix = (value: string) => value.split(sep).join("/");
const sheetPresentations = new Set(["formSheet", "modal", "pageSheet", "containedModal", "transparentModal", "containedTransparentModal"]);
const extensions = [".ios.tsx", ".ios.ts", ".native.tsx", ".native.ts", ".tsx", ".ts", ".jsx", ".js"];

function parse(path: string, code: string) {
  return ts.createSourceFile(path, code, ts.ScriptTarget.ES2022, true, /\.tsx?$/.test(path) && path.endsWith("x") ? ts.ScriptKind.TSX : path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
}
function literalValue(node: ts.Expression): StaticValue | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValue(node.expression);
  return undefined;
}
/** The literal-valued properties of an object literal; computed values are left out. */
function staticOptions(node: ts.Expression | undefined): StaticOptions {
  const options: StaticOptions = {};
  if (!node) return options;
  const target = ts.isJsxExpression(node as ts.Node) ? (node as unknown as ts.JsxExpression).expression : node;
  if (!target || !ts.isObjectLiteralExpression(target)) return options;
  for (const property of target.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (!name) continue;
    const value = literalValue(property.initializer);
    if (value !== undefined) options[name] = value;
  }
  return options;
}
const tagName = (element: ts.JsxOpeningLikeElement) => element.tagName.getText();
function attribute(element: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name || !property.initializer) continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer;
    if (ts.isJsxExpression(property.initializer)) return property.initializer.expression;
  }
  return undefined;
}
function jsxText(element: ts.JsxElement) {
  return element.children.map((child) => (ts.isJsxText(child) ? child.text : ts.isJsxExpression(child) && child.expression ? literalValue(child.expression) ?? "" : "")).join("").trim();
}

/** Navigator kind, static screen options and tab triggers of one layout file. */
export function analyzeLayout(file: string, dir: string, code: string): LayoutInfo {
  const source = parse(file, code);
  const layout: LayoutInfo = { file, dir, kind: "unknown", screenOptions: {}, screens: {}, tabs: [] };
  const navigators: { kind: NavigatorKind; element: ts.JsxOpeningLikeElement }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagName(node);
      if (tag === "NativeTabs") navigators.push({ kind: "native-tabs", element: node });
      else if (tag === "Tabs") navigators.push({ kind: "tabs", element: node });
      else if (tag === "Stack") navigators.push({ kind: "stack", element: node });
      else if (tag === "Slot") navigators.push({ kind: "slot", element: node });
      else if (/\.Screen$/.test(tag)) {
        const name = attribute(node, "name");
        const value = name ? literalValue(name) : undefined;
        if (typeof value === "string") layout.screens[value] = staticOptions(attribute(node, "options"));
      } else if (tag === "NativeTabs.Trigger" && ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent)) {
        const name = attribute(node, "name");
        const value = name ? literalValue(name) : undefined;
        if (typeof value === "string") {
          const tab: TabInfo = { name: value, label: null, icon: null, selectedIcon: null };
          for (const child of node.parent.children) {
            const opening = ts.isJsxElement(child) ? child.openingElement : ts.isJsxSelfClosingElement(child) ? child : null;
            if (!opening) continue;
            if (tagName(opening) === "NativeTabs.Trigger.Label" && ts.isJsxElement(child)) tab.label = jsxText(child) || null;
            if (tagName(opening) === "NativeTabs.Trigger.Icon") {
              const sf = attribute(opening, "sf");
              if (sf && ts.isObjectLiteralExpression(sf)) {
                const icons = staticOptions(sf);
                tab.icon = typeof icons.default === "string" ? icons.default : null;
                tab.selectedIcon = typeof icons.selected === "string" ? icons.selected : tab.icon;
              } else if (sf) {
                const icon = literalValue(sf);
                if (typeof icon === "string") { tab.icon = icon; tab.selectedIcon = icon; }
              }
            }
          }
          layout.tabs.push(tab);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const priority: NavigatorKind[] = ["native-tabs", "tabs", "stack", "slot"];
  const navigator = priority.map((kind) => navigators.find((entry) => entry.kind === kind)).find(Boolean);
  if (navigator) {
    layout.kind = navigator.kind;
    layout.screenOptions = staticOptions(attribute(navigator.element, "screenOptions"));
    if (navigator.kind === "tabs") {
      for (const [name, options] of Object.entries(layout.screens))
        layout.tabs.push({ name, label: typeof options.title === "string" ? options.title : null, icon: null, selectedIcon: null });
    }
  }
  return layout;
}

/** Route path without groups and its dynamic segments; "index" files fold into their directory. */
export function routePath(routeFile: string) {
  const segments = routeFile.replace(/\.[jt]sx?$/, "").split("/");
  if (segments.at(-1) === "index") segments.pop();
  const params = segments.flatMap((segment) => { const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment); return match ? [match[1]] : []; });
  return { fullPath: "/" + segments.join("/"), path: "/" + segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/"), params };
}
/** Expo Router's (one,two) directories mount the same source in both groups. */
function expandGroups(path: string): string[] {
  const group = /\(([^()/]*,[^()/]*)\)/.exec(path);
  if (!group) return [path];
  return group[1].split(",").flatMap(name => expandGroups(path.slice(0, group.index) + `(${name.trim()})` + path.slice(group.index + group[0].length)));
}
const humanize = (value: string) => {
  const text = value.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, "").split(/[-_/.\s]+/).filter(Boolean).join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Screen";
};
export function keyFor(path: string) {
  const slug = path.replace(/\([^)]*\)/g, "").replace(/\[(?:\.\.\.)?[^\]]+\]/g, "").split("/").filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (slug ? (/^[a-z]/.test(slug) ? slug : "route-" + slug) : "index").slice(0, 56);
}
/** Whether an href (a literal path, possibly with a query, or a route pattern) reaches the frame's route. */
export function matchesRoute(href: string, frame: { path: string }) {
  const candidate = href.split(/[?#]/)[0].replace(/\/\([^)]*\)/g, "").replace(/\/+$/, "") || "/";
  if (candidate === frame.path) return true;

  const expression = new RegExp("^" + frame.path.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "$");
  return expression.test(candidate);
}

/** Import bindings of a file: which names it takes from each specifier, including members read off a namespace import. */
export function importBindings(path: string, code: string): ImportBinding[] {
  const source = parse(path, code);
  const bindings = new Map<string, ImportBinding>();
  const namespaces = new Map<string, ImportBinding>();
  const entry = (specifier: string) => {
    if (!bindings.has(specifier)) bindings.set(specifier, { specifier, default: false, named: [], namespace: null, members: [] });
    return bindings.get(specifier)!;
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause && !node.importClause.isTypeOnly) {
      const binding = entry(node.moduleSpecifier.text);
      if (node.importClause.name) binding.default = true;
      const named = node.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) for (const element of named.elements) if (!element.isTypeOnly) binding.named.push((element.propertyName ?? element.name).text);
      if (named && ts.isNamespaceImport(named)) { binding.namespace = named.name.text; namespaces.set(named.name.text, binding); }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      entry(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      entry(node.arguments[0].text);
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) {
      const binding = namespaces.get(node.expression.text)!;
      if (!binding.members.includes(node.name.text)) binding.members.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...bindings.values()];
}

/** Static content navigation only: Expo Router calls and Link/Redirect hrefs.
 * Back, dismiss, prefetch, tab declarations and unrelated path literals are excluded.
 */
export function collectHrefs(path: string, code: string): string[] {
  const source = parse(path, code);
  const hrefs = new Set<string>();
  const routers = new Set<string>(), hooks = new Set<string>(), links = new Set<string>();
  const variables = new Map<string, ts.Expression | null>();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "expo-router") continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      const imported = (item.propertyName ?? item.name).text;
      if (imported === "router") routers.add(item.name.text);
      if (imported === "useRouter") hooks.add(item.name.text);
      if (imported === "Link" || imported === "Redirect") links.add(item.name.text);
    }
  }
  const declarations = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      // Ambiguous/shadowed bindings remain unresolved instead of guessing.
      variables.set(node.name.text, variables.has(node.name.text) ? null : node.initializer);
      if (ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && hooks.has(node.initializer.expression.text)) routers.add(node.name.text);
    }
    ts.forEachChild(node, declarations);
  };
  declarations(source);
  const fromExpression = (node: ts.Expression | undefined, seen = new Set<string>()) => {
    if (!node) return;
    const add = (value: string) => { if (value.startsWith("/") && !value.startsWith("//")) hrefs.add(value); };
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { add(node.text); return; }
    if (ts.isTemplateExpression(node)) {
      add(node.head.text + node.templateSpans.map(span => "[dynamic]" + span.literal.text).join(""));
      return;
    }
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      const value = variables.get(node.text);
      if (value) fromExpression(value, new Set([...seen, node.text]));
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties)
        if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "pathname") fromExpression(property.initializer, seen);
      return;
    }
    if (ts.isConditionalExpression(node)) { fromExpression(node.whenTrue, seen); fromExpression(node.whenFalse, seen); return; }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) fromExpression(node.expression, seen);
  };
  // A replacement in the else branch of canGoBack is a Back fallback,
  // not a content destination. Keep ordinary replace navigation in the map.
  const backFallback = (call: ts.CallExpression) => {
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'replace') return false;
    const owner = call.expression.expression.getText(source);
    for (let child: ts.Node = call; child.parent && !ts.isFunctionLike(child.parent); child = child.parent) {
      const parent = child.parent;
      if (!ts.isIfStatement(parent) || parent.elseStatement !== child || !ts.isCallExpression(parent.expression)) continue;
      const condition = parent.expression.expression;
      if (!ts.isPropertyAccessExpression(condition) || condition.name.text !== 'canGoBack' || condition.expression.getText(source) !== owner) continue;
      let back = false;
      const scan = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'back' && node.expression.expression.getText(source) === owner) back = true;
        ts.forEachChild(node, scan);
      };
      scan(parent.thenStatement);
      if (back) return true;
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && routers.has(node.expression.expression.text)
      && /^(push|navigate|replace)$/.test(node.expression.name.text) && !backFallback(node)) fromExpression(node.arguments[0]);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (links.has(tagName(node))) fromExpression(attribute(node, "href"));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...hrefs].sort();
}

export interface RouteMapOptions {
  /** Absolute app directory (realpath). */
  app: string;
  /** Routes directory relative to the app, such as src/app. */
  routesDirectory: string;
  /** Alias prefixes to absolute directories, such as "@/" to <app>/src. */
  aliases: Record<string, string>;
}

/** Builds the frame list for an Expo Router app. */
export async function buildRouteMap(options: RouteMapOptions): Promise<RouteMap> {
  const routesRoot = join(options.app, options.routesDirectory);
  const files: string[] = [];
  const layoutFiles = new Map<string, string>();
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!["node_modules", "__tests__"].includes(entry.name)) await walk(absolute); continue; }
      if (!/\.[jt]sx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
      const routeFile = toPosix(relative(routesRoot, absolute));
      if (/(^|\/)\+|\+api\.[jt]sx?$/.test(routeFile)) continue;
      files.push(routeFile);
    }
  };
  await walk(routesRoot);
  // Prefer iOS/native variants once, never manufacture extra routes from suffixes.
  const selected = new Map<string, string>();
  for (const file of files) {
    const logical = file.replace(/\.(ios|native|android|web)(?=\.[jt]sx?$)/, "");
    if (/\.(android|web)\.[jt]sx?$/.test(file)) continue;
    const rank = (value: string) => value.includes(".ios.") ? 2 : value.includes(".native.") ? 1 : 0;
    if (!selected.has(logical) || rank(file) > rank(selected.get(logical)!)) selected.set(logical, file);
  }
  for (const [logical, file] of selected) {
    if (/(^|\/)_layout\.[jt]sx?$/.test(logical)) {
      layoutFiles.set(toPosix(dirname(logical)).replace(/^\.$/, ""), file);
      selected.delete(logical);
    }
  }
  for (const entries of [layoutFiles, selected]) {
    for (const [logical, file] of [...entries]) {
      const expanded = expandGroups(logical);
      if (expanded.length === 1) continue;
      entries.delete(logical);
      for (const path of expanded) entries.set(path, file);
    }
  }
  const layouts: LayoutInfo[] = [];
  const layoutByDir = new Map<string, LayoutInfo>();
  for (const [dir, routeFile] of [...layoutFiles.entries()].sort(([a], [b]) => a.length - b.length)) {
    const code = await readFile(join(routesRoot, routeFile), "utf8");
    const layout = analyzeLayout(toPosix(join(options.routesDirectory, routeFile)), dir, code);
    layouts.push(layout);
    layoutByDir.set(dir, layout);
  }

  const frames: RouteFrame[] = [];
  const usedKeys = new Set<string>();
  for (const [logicalFile, routeFile] of selected) {
    const { fullPath, path, params } = routePath(logicalFile);
    const leaf = logicalFile.replace(/\.[jt]sx?$/, "");
    // Layout directories from the root to the route, and the child name each sees.
    const segments = leaf.split("/");
    const directories = [""];
    for (let index = 1; index < segments.length; index++) directories.push(segments.slice(0, index).join("/"));
    const chainDirs = directories.filter((dir) => layoutByDir.has(dir));
    const chain = chainDirs.map((dir) => layoutByDir.get(dir)!);
    const names = chainDirs.map((dir, index) => {
      const next = chainDirs[index + 1];
      const target = next ?? leaf;
      return dir ? target.slice(dir.length + 1) : target;
    });
    const levels = chain.map((layout, index) => ({ layout, name: names[index], options: { ...layout.screenOptions, ...(layout.screens[names[index]] ?? {}) } }));
    const presentationLevel = levels.find((level) => typeof level.options.presentation === "string");
    const presentation = (presentationLevel?.options.presentation as string | undefined) ?? "card";
    const sheet = sheetPresentations.has(presentation);
    const tabbed = levels.some((level) => level.layout.kind === "tabs" || level.layout.kind === "native-tabs");
    const headerLevels = levels.filter((level) => level.layout.kind === "stack" && level.options.headerShown !== false);
    const innermostHeader = headerLevels.at(-1);
    const largeTitle = innermostHeader?.options.headerLargeTitle === true;
    const headers = headerLevels.length;
    const code = await readFile(join(routesRoot, routeFile), "utf8");
    const redirectMatch = /<Redirect[^>]*href=\{?["'`]([^"'`]+)["'`]/.exec(code);
    const redirect = redirectMatch?.[1] ?? null;
    // The name comes from the navigator that presents the route, then from its tab, then from the file.
    const titled = [...levels].reverse().find((level) => typeof level.options.title === "string" && level.options.title.trim());
    const leafName = names.at(-1) ?? leaf;
    const tabLevel = levels.find((level, index) => (level.layout.kind === "native-tabs" || level.layout.kind === "tabs") && index < levels.length);
    const tabName = tabLevel && names[levels.indexOf(tabLevel)];
    const tab = tabLevel?.layout.tabs.find((entry) => entry.name === tabName);
    const isTabRoot = !!tab && (leafName === "index" || leafName === tabName);
    const name = titled ? (titled.options.title as string).trim() : isTabRoot && tab?.label ? tab.label : humanize(leafName === "index" && !chainDirs.length ? "Index" : leafName) + (params.length ? " Detail" : "");
    let key = keyFor(fullPath);
    for (let suffix = 2; usedKeys.has(key); suffix++) key = `${keyFor(fullPath)}-${suffix}`;
    usedKeys.add(key);
    const top = sheet ? device.sheetGrabber + (headers ? device.navigationBar : 0) : device.statusBar + headers * device.navigationBar + (largeTitle ? device.largeTitle : 0);
    const bottom = sheet ? device.homeIndicator : tabbed ? device.tabBar + device.homeIndicator : device.homeIndicator;
    frames.push({
      key, name, path, fullPath, params, file: toPosix(join(options.routesDirectory, routeFile)), chain: chain.map((layout) => layout.file), names,
      presentation, tabbed, headers, largeTitle, redirect,
      insets: { top, bottom, left: 0, right: 0 }, links: [], notes: "",
    });
  }

  // Links: every path the route's source (and the modules it imports within the app) navigates to.
  const hrefCache = new Map<string, string[]>();
  const importCache = new Map<string, string[]>();
  const resolveImport = (from: string, specifier: string): string | null => {
    let base: string | null = null;
    if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
    else for (const [prefix, directory] of Object.entries(options.aliases)) if (specifier.startsWith(prefix)) base = resolve(directory, specifier.slice(prefix.length));
    if (!base || !base.startsWith(options.app + sep) || base.includes(`${sep}node_modules${sep}`)) return null;
    for (const candidate of [base, ...extensions.map((ext) => base + ext), ...extensions.map((ext) => join(base, "index" + ext))])
      if (existsSync(candidate) && /\.[jt]sx?$/.test(candidate)) return candidate;
    return null;
  };
  const closure = async (start: string) => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const file = queue.shift()!;
      if (!importCache.has(file)) {
        const code = await readFile(file, "utf8").catch(() => "");
        hrefCache.set(file, collectHrefs(file, code));
        const targets: string[] = [];
        for (const binding of importBindings(file, code)) {
          const resolved = resolveImport(file, binding.specifier);
          if (resolved) targets.push(resolved);
        }
        importCache.set(file, targets);
      }
      for (const target of importCache.get(file)!) if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
    return seen;
  };
  const closures = new Map<string, Set<string>>();
  for (const frame of frames) closures.set(frame.key, await closure(join(options.app, frame.file)));
  const destination = (href: string, origin: RouteFrame) => {
    const exact = frames.find(candidate => candidate.fullPath === href.split(/[?#]/)[0]);
    if (exact) return exact;
    const groups = href.split(/[?#]/)[0].match(/\([^)]*\)/g) ?? [];
    const sharedPrefix = (candidate: RouteFrame) => {
      const source = origin.fullPath.split("/"), target = candidate.fullPath.split("/");
      let length = 0;
      while (length < source.length && source[length] === target[length]) length++;
      return length;
    };
    return frames.filter(candidate => matchesRoute(href, candidate) && groups.every(group => candidate.fullPath.split("/").includes(group)))
      .sort((a, b) => sharedPrefix(b) - sharedPrefix(a))[0];
  };
  for (const frame of frames) {
    const links = new Set<string>();
    frame.linkEvidence = [];
    for (const file of closures.get(frame.key)!) {
      for (const href of hrefCache.get(file) ?? []) {
        const target = destination(href, frame);
        if (target && target.key !== frame.key) {
          links.add(target.key);
          frame.linkEvidence.push({ target: target.key, file: toPosix(relative(options.app, file)), kind: 'content' });
        }
      }
    }
    if (frame.redirect) { const target = destination(frame.redirect, frame); if (target && target.key !== frame.key) links.add(target.key); }
    frame.links = [...links].sort();
    const opens = frame.links.length ? frame.links.join(", ") : "nothing on the canvas";
    frame.notes = `Static route map, not a live app preview. Dynamic destinations and runtime layout options may be unresolved. Route ${frame.fullPath} from ${frame.file}, generated by import. Presented as ${frame.presentation}${frame.tabbed ? " inside the tabs" : ""}${frame.headers ? `, ${frame.largeTitle ? "large-title" : "stack"} header` : ", no header"}.` +
      (frame.params.length ? ` Params required for a live preview: ${frame.params.join(", ")}.` : "") + (frame.redirect ? ` Redirects to ${frame.redirect}.` : "") + ` Opens: ${opens}.`;
  }
  // Expo's shared groups create multiple navigator contexts for one source.
  // Keep one design frame and direct every incoming edge to its stable key.
  const byFile = new Map<string, RouteFrame>();
  const canonicalKey = new Map<string, string>();
  for (const frame of frames) {
    const canonical = byFile.get(frame.file) ?? frame;
    byFile.set(frame.file, canonical);
    canonicalKey.set(frame.key, canonical.key);
    canonical.contexts ??= [];
    canonical.contexts.push({ fullPath: frame.fullPath, chain: frame.chain, names: frame.names });
    if (canonical !== frame) { canonical.links.push(...frame.links); canonical.linkEvidence?.push(...(frame.linkEvidence ?? [])); }
  }
  for (const frame of byFile.values()) {
    frame.links = [...new Set(frame.links.map(key => canonicalKey.get(key)!))].filter(key => key !== frame.key).sort();
    frame.linkEvidence = [...new Map((frame.linkEvidence ?? []).map(edge => ({ ...edge, target: canonicalKey.get(edge.target)! })).filter(edge => edge.target !== frame.key).map(edge => [JSON.stringify(edge), edge])).values()];
    frame.notes = frame.notes.replace(/ Opens: .*$/, ` Opens: ${frame.links.join(', ') || 'nothing on the canvas'}.`);
  }
  const expanded: RouteFrame[] = [];
  const visualKeys = new Set([...byFile.values()].map(frame => frame.key));
  for (const frame of byFile.values()) {
    const pager = await discoverPager(options.app, join(options.app, frame.file), file => readFile(file, 'utf8'), resolveImport);
    if (!pager) { expanded.push(frame); continue; }
    const group = humanize(dirname(pager.file).split('/').at(-1) ?? frame.key);
    const keys = pager.steps.map((step, index) => {
      if (index === 0) return frame.key;
      const base = `${frame.key}-${step.key}`;
      let key = base, suffix = 2;
      while (visualKeys.has(key)) key = `${base}-${suffix++}`;
      visualKeys.add(key); return key;
    });
    for (let index = 0; index < pager.steps.length; index++) {
      const step = pager.steps[index];
      const next = keys[index + 1];
      const pageFiles = new Set([...(await closure(join(options.app, step.file)))].map(file => toPosix(relative(options.app, file))));
      const evidence = (frame.linkEvidence ?? []).filter(edge => pageFiles.has(edge.file));
      const links = [...new Set([...(next ? [next] : []), ...evidence.map(edge => edge.target)])];
      expanded.push({ ...frame, key: keys[index], name: `${group} · ${index + 1} ${humanize(step.key)}`, links,
        step: { ...step, index, count: keys.length, routeKey: frame.key, pager },
        linkEvidence: [...evidence, ...(next ? [{ target: next, file: pager.file, kind: 'step' as const }] : [])],
        notes: frame.notes.replace(/ Opens: .*$/, '') + ` Pinned step ${index + 1}/${keys.length}: ${step.title}. Same route and providers; local step navigation focuses the matching frame. ${!next ? 'Completion may change app state without an explicit route call; its destination is not inferred.' : ''} Opens: ${links.join(', ') || 'none'}.`,
      });
    }
  }
  await connectRouteGuards(options.app, layouts, expanded);
  return { routesDirectory: options.routesDirectory, layouts, frames: expanded };
}
