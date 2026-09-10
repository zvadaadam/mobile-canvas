import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { OriginApplySchema } from "../shared/import";
import type { CanvasDocument } from "../shared/model";
import { CanvasError } from "./errors";
import type { ProjectStore } from "./project";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export type OriginEntry = {
  path: string;
  status: "diverged" | "added" | "unchanged";
  /** The app-relative file this project file came from, or would become. */
  target: string;
  /** False for canvas-only code (lib/canvas, lib/shims) that never belongs in the app. */
  candidate: boolean;
  originChanged: boolean;
  diff: string;
};

/** Canvas scaffolding and shims exist only to run the app on the canvas. */
export const isCanvasOnly = (path: string) => /^lib\/(canvas|shims)\//.test(path);

/** Where imported files came from: the recorded root, or inferred from copied provenance (usually "src"). */
export function originRoot(document: CanvasDocument) {
  if (document.origin?.root) return document.origin.root;
  const roots = new Set(Object.values(document.origin?.files ?? {}).map((record) => {
    const [first] = record.from.split("/");
    return record.from.includes("/") ? first : "";
  }));
  return roots.size === 1 ? [...roots][0] : "";
}

/** In a linked project, resolver.modules keys that are app paths are overrides of that file. */
export function linkedOverrides(document: CanvasDocument): Record<string, string> {
  if (document.origin?.mode !== "linked") return {};
  return Object.fromEntries(Object.entries(document.resolver?.modules ?? {}).filter(([key]) => /\.tsx?$/.test(key)));
}

/** Project files that stand for app files: copied provenance, or linked overrides. Canvas-only code is excluded. */
export function reviewable(document: CanvasDocument, sources: string[]): { path: string; target: string; hash: string | null }[] {
  if (document.origin?.mode === "linked") {
    return Object.entries(linkedOverrides(document)).map(([target, path]) => ({ path, target, hash: null }));
  }
  return sources.filter((path) => path.startsWith("lib/")).map((path) => {
    const record = document.origin?.files[path];
    const root = originRoot(document);
    const relativePath = path.replace(/^lib\//, "");
    return { path, target: record ? record.from : root ? `${root}/${relativePath}` : relativePath, hash: record?.hash ?? null };
  });
}

/** A plain unified diff of two texts, line based, with three lines of context. */
export function unifiedDiff(fromLabel: string, toLabel: string, before: string, after: string, context = 3): string {
  // A trailing newline ends the last line; it is not an extra empty line.
  const lines = (text: string) => {
    const parts = text.split("\n");
    if (parts.at(-1) === "") parts.pop();
    return parts;
  };
  const a = lines(before);
  const b = lines(after);
  const n = a.length, m = b.length;
  const header = `--- ${fromLabel}\n+++ ${toLabel}\n`;
  if (n * m > 25_000_000) return `${header}@@ too large to diff line by line (${n} and ${m} lines) @@\n`;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  type Op = { type: " " | "-" | "+"; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: " ", line: a[i], ai: i, bi: j }); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: "-", line: a[i], ai: i, bi: j }); i++; }
    else { ops.push({ type: "+", line: b[j], ai: i, bi: j }); j++; }
  }
  while (i < n) { ops.push({ type: "-", line: a[i], ai: i, bi: j }); i++; }
  while (j < m) { ops.push({ type: "+", line: b[j], ai: i, bi: j }); j++; }
  const changes = ops.map((op, index) => (op.type === " " ? -1 : index)).filter((index) => index >= 0);
  if (changes.length === 0) return "";
  const hunks: [start: number, end: number][] = [];
  for (const index of changes) {
    const last = hunks.at(-1);
    if (last && index - last[1] <= context * 2 + 1) last[1] = index;
    else hunks.push([index, index]);
  }
  let output = header;
  for (const [first, last] of hunks) {
    const start = Math.max(0, first - context), end = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(start, end + 1);
    const aCount = slice.filter((op) => op.type !== "+").length, bCount = slice.filter((op) => op.type !== "-").length;
    output += `@@ -${slice[0].ai + 1},${aCount} +${slice[0].bi + 1},${bCount} @@\n`;
    for (const op of slice) output += `${op.type}${op.line}\n`;
  }
  return output;
}

async function readOriginFile(root: string, target: string) {
  const file = resolve(root, target);
  if (!file.startsWith(root + sep)) throw new CanvasError("invalid_path", "Origin target leaves the imported app");
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function originDirectory(document: CanvasDocument) {
  if (!document.origin) throw new CanvasError("no_origin", "This project was not imported from an existing app.");
  try {
    return await realpath(document.origin.path);
  } catch {
    throw new CanvasError("origin_missing", `The imported app is no longer at ${document.origin.path}.`);
  }
}

/**
 * Compare this project's lib/ files with the app they were imported from:
 * diverged files show what an adaptation or direction changed, added files are
 * new screens or helpers, and both are the candidates for carrying a chosen
 * direction back. Read-only.
 */
export async function originDiff(store: ProjectStore, only?: string[]) {
  const session = store.session();
  const document = session.project.document;
  const root = await originDirectory(document);
  const wanted = only?.length ? new Set(only) : null;
  const hashes = new Map(session.sources.map((source) => [source.path, source.hash]));
  const entries: OriginEntry[] = [];
  for (const item of reviewable(document, session.sources.map((source) => source.path))) {
    if ((wanted && !wanted.has(item.path)) || !hashes.has(item.path)) continue;
    const current = (await store.readSource(item.path)).code;
    const original = await readOriginFile(root, item.target);
    const originChanged = item.hash !== null && original !== null && digest(original) !== item.hash;
    const candidate = !isCanvasOnly(item.path);
    if (item.hash !== null && hashes.get(item.path) === item.hash && !originChanged) {
      entries.push({ path: item.path, status: "unchanged", target: item.target, candidate, originChanged, diff: "" });
      continue;
    }
    const exists = original !== null;
    entries.push({
      path: item.path,
      status: item.hash !== null || exists ? "diverged" : "added",
      target: item.target,
      candidate,
      originChanged,
      diff: unifiedDiff(exists ? `a/${item.target}` : "/dev/null", `b/${item.target}`, original ?? "", current),
    });
  }
  return { origin: { name: document.origin!.name, path: root, mode: document.origin!.mode, commit: document.origin!.commit, root: originRoot(document) }, entries };
}

/**
 * Copy chosen lib/ files into the imported app at their origin paths. This is
 * the only operation that writes to the original app, and it refuses a file
 * whose origin changed since the import unless forced. It never deletes.
 */
export async function originApply(store: ProjectStore, input: unknown) {
  const request = OriginApplySchema.parse(input);
  store.assertIdentity(request);
  const document = store.session().project.document;
  const root = await originDirectory(document);
  const written: { path: string; to: string }[] = [];
  const planned: { path: string; to: string; code: string }[] = [];
  const items = new Map(reviewable(document, request.files).map((item) => [item.path, item]));
  for (const path of request.files) {
    if (!path.startsWith("lib/")) throw new CanvasError("invalid_path", `${path} is not an imported or added lib/ file.`);
    if (isCanvasOnly(path) && !request.force) throw new CanvasError("invalid_path", `${path} is canvas-only scaffolding (lib/canvas, lib/shims) and does not belong in the app. Pass force to copy it anyway.`);
    const item = items.get(path);
    if (!item) throw new CanvasError("invalid_path", `${path} does not stand for an app file. In a linked project, map it in resolver.modules first.`);
    const record = item.hash !== null ? { hash: item.hash } : undefined;
    const target = item.target;
    const to = resolve(root, target);
    if (!to.startsWith(root + sep)) throw new CanvasError("invalid_path", "Origin target leaves the imported app");
    const current = (await store.readSource(path)).code;
    const original = await readOriginFile(root, target);
    if (record && original !== null && digest(original) !== record.hash && !request.force)
      throw new CanvasError("origin_changed", `${target} changed in the app since the import. Review it and pass force to overwrite.`);
    if (!record && original !== null && !request.force)
      throw new CanvasError("origin_changed", `${target} already exists in the app. Pass force to overwrite it.`);
    planned.push({ path, to, code: current });
  }
  for (const file of planned) {
    await mkdir(dirname(file.to), { recursive: true });
    await writeFile(file.to, file.code);
    written.push({ path: file.path, to: relative(root, file.to) });
  }
  return { origin: { name: document.origin!.name, path: root }, written };
}
