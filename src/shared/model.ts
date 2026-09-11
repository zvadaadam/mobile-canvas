import { z } from "zod";
import { SwiftProjectSchema } from "./native";

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const Key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
export const Id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const SourcePath = z
  .string()
  .max(240)
  .regex(/^(screens|components|lib)\/[a-zA-Z0-9_./()-]+\.(?:tsx?|swift)$/)
  .refine(
    (path) =>
      path
        .split("/")
        .every((part) => part !== "." && part !== ".." && part !== ""),
    "Use a project-relative source path without traversal",
  );
export const Props = z.record(z.string(), z.json());
/** A bare module specifier such as expo-router or @expo/ui/community/menu. */
export const ModuleName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^(@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*(\/[A-Za-z0-9._~-]+)*$/);
/** An import alias prefix such as "@/" that maps onto a project source directory. */
export const AliasPrefix = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[@~A-Za-z0-9_-]+\/$/);
export const SourceDirectory = z
  .string()
  .max(240)
  .regex(/^(screens|components|lib)(\/[a-zA-Z0-9_.()-]+)*\/$/)
  .refine(
    (path) => path.split("/").every((part) => part !== "." && part !== ".."),
    "Use a project-relative source directory without traversal",
  );
/**
 * Project-declared module resolution for the native host's Metro: aliases map
 * an import prefix onto project code, modules substitute a bare package with a
 * project file (a shim for a dependency the host does not provide). Metro reads
 * this when the canvas opens; changing it requires reopening the canvas.
 */
/** An absolute directory of the imported app, only valid when the project links that app in place. */
export const LinkedDirectory = z
  .string()
  .min(2)
  .max(1000)
  .regex(/^\/.+\/$/)
  .refine((path) => !path.split("/").includes(".."), "Use an absolute directory without traversal");
export const AliasTarget = z.union([SourceDirectory, LinkedDirectory]);
/** A file of the imported app relative to its root, such as src/theme/colors.ts, overridden in place. */
export const AppFilePath = z
  .string()
  .max(300)
  .regex(/^[a-zA-Z0-9_./()-]+\.tsx?$/)
  .refine((path) => path.split("/").every((part) => part !== "." && part !== ".." && part !== ""), "Use an app-relative file path without traversal");
export const ResolverKey = z.union([ModuleName, AppFilePath]);
export const ResolverSchema = z
  .object({
    aliases: z.record(AliasPrefix, AliasTarget).default({}),
    /** Bare module substitutions and, for a linked app, file overrides keyed by app-relative path. */
    modules: z.record(ResolverKey, SourcePath).default({}),
  })
  .strict();
export type Resolver = z.infer<typeof ResolverSchema>;
/** Provenance of files imported from an existing app, for review and apply-back. */
export const OriginSchema = z
  .object({
    path: z.string().min(1).max(1000),
    name: z.string().min(1).max(100),
    /** copied: sources live in lib/; linked: the app's source root is aliased in place and lib/ holds overrides. */
    mode: z.enum(["copied", "linked"]).default("copied"),
    /** The app's source root relative to its directory, usually "src". */
    root: z.string().max(200).default(""),
    commit: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/)
      .nullable(),
    importedAt: z.number(),
    files: z.record(
      SourcePath,
      z
        .object({
          from: z.string().min(1).max(500),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
  })
  .strict();
export type Origin = z.infer<typeof OriginSchema>;
/** Device safe areas the host applies to a frame, so real scroll views and safe-area hooks inset like a phone. */
export const InsetsSchema = z
  .object({
    top: z.number().min(0).max(300).default(0),
    bottom: z.number().min(0).max(300).default(0),
    left: z.number().min(0).max(300).default(0),
    right: z.number().min(0).max(300).default(0),
  })
  .strict();
export const ScreenSchema = z
  .object({
    id: Id,
    key: Key,
    name: z.string().min(1).max(100),
    source: SourcePath,
    insets: InsetsSchema.optional(),
    exportName: z
      .string()
      .regex(/^(default|[a-zA-Z_$][\w$]*)$/)
      .default("default"),
    x: z.number().min(-1_000_000).max(1_000_000),
    y: z.number().min(-1_000_000).max(1_000_000),
    width: z.number().min(180).max(2000).default(402),
    height: z.number().min(240).max(3000).default(874),
    props: Props.default({}),
    notes: z.string().max(4000).default(""),
    links: z.array(Key).max(128).default([]),
  })
  .strict();
export type Screen = z.infer<typeof ScreenSchema>;
export const DocumentSchema = z
  .object({
    name: z.string().min(1).max(100),
    screenIds: z.array(Id).max(500),
    screens: z.record(Id, ScreenSchema),
    resolver: ResolverSchema.optional(),
    origin: OriginSchema.optional(),
    nativePreview: SwiftProjectSchema.optional(),
    appPreview: z.object({ sdk: z.union([z.literal(56), z.literal(57)]), routesDirectory: z.string().min(1).max(300), offline: z.boolean().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((doc, context) => {
    const ids = new Set(doc.screenIds);
    if (
      ids.size !== doc.screenIds.length ||
      ids.size !== Object.keys(doc.screens).length ||
      Object.entries(doc.screens).some(
        ([id, screen]) => !ids.has(id) || screen.id !== id,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Screen order and screen records must match exactly",
      });
    const keys = Object.values(doc.screens).map((screen) => screen.key);
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        message: "Screen keys must be unique",
      });
  });
export const ProjectSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    workspaceId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    document: DocumentSchema,
  })
  .strict();
export type Project = z.infer<typeof ProjectSchema>;
export type CanvasDocument = Project["document"];
export const CreateScreenSchema = ScreenSchema.omit({ id: true }).extend({
  source: SourcePath.optional(),
  code: z.string().min(1).max(100_000).optional(),
  x: ScreenSchema.shape.x.optional(),
  y: ScreenSchema.shape.y.default(0),
});
export const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("native.refresh"), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal("native.context"), context: z.enum(['isolated','application']) }).strict(),
  z.object({ type: z.literal("native.override"), appPath: z.string().max(500), source: SourcePath.nullable(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z
    .object({ type: z.literal("screen.create"), screen: CreateScreenSchema })
    .strict(),
  z
    .object({
      type: z.literal("screen.update"),
      id: Id,
      // Defaults belong to creation, never a patch: Zod's partial() still
      // applies defaults, which would erase context and fixtures on a move.
      patch: ScreenSchema.omit({ id: true })
        .extend({
          exportName: ScreenSchema.shape.exportName.removeDefault(),
          width: ScreenSchema.shape.width.removeDefault(),
          height: ScreenSchema.shape.height.removeDefault(),
          props: ScreenSchema.shape.props.removeDefault(),
          notes: ScreenSchema.shape.notes.removeDefault(),
          links: ScreenSchema.shape.links.removeDefault(),
        })
        .partial(),
    })
    .strict(),
  z.object({ type: z.literal("screen.remove"), id: Id }).strict(),
  z
    .object({
      type: z.literal("source.write"),
      path: SourcePath,
      code: z.string().max(100_000),
      expectedHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.rename"),
      name: z.string().min(1).max(100),
    })
    .strict(),
  // Null removes an entry. Metro applies the result when the canvas is reopened.
  z
    .object({
      type: z.literal("resolver.update"),
      aliases: z.record(AliasPrefix, AliasTarget.nullable()).optional(),
      modules: z.record(ResolverKey, SourcePath.nullable()).optional(),
    })
    .strict(),
]);
export const IdentitySchema = z.object({
  workspaceId: z.uuid(),
  sequence: z.number().int().nonnegative(),
});
export const CommandSchema = IdentitySchema.extend({
  requestId: z.string().min(1).max(128),
  label: z.string().min(1).max(140).default("Edit canvas"),
  operations: z.array(OperationSchema).min(1).max(128),
}).strict();
export type Command = z.infer<typeof CommandSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Identity = z.infer<typeof IdentitySchema>;
export interface Session {
  project: Project;
  directory: string;
  codeVersion: string;
  nativeVersion?: string;
  sources: { path: string; hash: string }[];
  selection: string[];
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | null };
}
export interface CommandResult {
  session: Session;
  created: Record<string, string>;
}
export const identityOf = (session: Session): Identity => ({
  workspaceId: session.project.workspaceId,
  sequence: session.project.sequence,
});
