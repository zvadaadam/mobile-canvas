import type { RouteMap } from "./routes";
import { z } from "zod";
import { IdentitySchema, ModuleName, SourcePath } from "./model";

/**
 * Import selected source from an existing Expo app into this project as
 * read-only input for design experiments. The original app is never modified.
 */
export const ImportSchema = IdentitySchema.extend({
  requestId: z.string().min(1).max(128),
  /** Absolute path of the existing app. */
  from: z.string().min(1).max(1000),
  name: z.string().min(1).max(100).optional(),
  /** Paths relative to the app's source root; "*" and "**" wildcards are supported. Default: everything. */
  include: z.array(z.string().min(1).max(200)).max(64).optional(),
  exclude: z.array(z.string().min(1).max(200)).max(64).optional(),
  /** JavaScript-only packages to copy from the app's node_modules into the project's node_modules. */
  modules: z.array(ModuleName).max(32).optional(),
  /** Link the app in place instead of copying: the canvas resolves its source root directly and lib/ holds only overrides. */
  link: z.boolean().default(false),
  /** Create a deterministic, static route map. No app code executes and no adapters are generated. Requires link. */
  map: z.boolean().default(false),
  /** Generate live Expo Router frames; opening explicitly builds a separate SDK-matched host. */
  preview: z.boolean().default(false),
  /** Design environment: local disconnected services and disclosed public icon substitutes. */
  offline: z.boolean().default(false),
}).strict();
export type ImportRequest = z.infer<typeof ImportSchema>;

/** app: a JavaScript-only package the linked app's own node_modules provides. */
export type DependencyStatus = "host" | "matched-host" | "project" | "app" | "missing";
export interface ImportDependency {
  /** The exact bare specifier, such as expo-router/stack, because substitutions are per specifier. */
  specifier: string;
  package: string;
  status: DependencyStatus;
  /** Version range declared by the source app, if any. */
  declared: string | null;
  /** Installed host/project version, or the installed app version selected for a matched host. */
  installed: string | null;
  files: string[];
  /** Why an installed package still cannot serve this specifier. */
  note?: string;
}
export interface ImportReport {
  name: string;
  from: string;
  mode: "copied" | "linked";
  commit: string | null;
  /** Source root relative to the app, such as "src". */
  root: string;
  aliases: Record<string, string>;
  files: { from: string; to: string }[];
  skipped: { from: string; reason: string }[];
  routes: { file: string; route: string; imports: string[] }[];
  dependencies: ImportDependency[];
  copiedModules: { name: string; version: string }[];
  routeMap?: RouteMap;
  previewIssues?: string[];
}

/** Copy chosen lib/ files back into the imported app. Only on explicit request; never deletes. */
export const OriginApplySchema = IdentitySchema.extend({
  files: z.array(SourcePath).min(1).max(64),
  /** Overwrite a file whose origin changed since the import, or an added file that already exists. */
  force: z.boolean().default(false),
}).strict();
export type OriginApplyRequest = z.infer<typeof OriginApplySchema>;
