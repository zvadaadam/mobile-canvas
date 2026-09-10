import { z } from "zod";
import { Id, IdentitySchema, Props } from "./model";

export const StudioCaptureSchema = IdentitySchema.extend({ hostId: z.uuid(), screenId: Id.optional() }).strict();
export const StudioInspectSchema = IdentitySchema.extend({ hostId: z.uuid(), screenId: Id }).strict();

/** Opening may name a screen to fit and center as soon as it renders, like opening a URL. */
export const StudioOpenSchema = IdentitySchema.extend({ screen: Id.optional() }).strict();

export const StudioControlSchema = IdentitySchema.extend({
  hostId: z.uuid(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("focus"), screenId: Id }).strict(),
    z.object({ type: z.literal("reset"), screenId: Id }).strict(),
    z.object({ type: z.literal("fit") }).strict(),
    /** Set the canvas zoom, optionally revealing one screen at that zoom for inspection. */
    z.object({ type: z.literal("zoom"), scale: z.number().min(0.25).max(1.5), screenId: Id.optional() }).strict(),
  ]),
}).strict();

const reportBase = z.object({ workspaceId: z.uuid(), hostId: z.uuid(), acknowledged: z.number().int().nonnegative(), error: z.string().max(2000).nullable() });
export const StudioReportSchema = z.discriminatedUnion("kind", [
  reportBase.extend({ kind: z.literal("host"), pid: z.number().int().positive(), screenIds: z.array(Id).max(64), width: z.number().positive(), height: z.number().positive(), zoom: z.number().positive(), platform: z.enum(["ios-on-mac", "ios"]),
    /** The part of the board (in screen coordinates, before zoom) that the canvas currently shows. */
    viewport: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(),
    /** The host's last diagnostic line, for example what a reveal computed. */
    note: z.string().max(1000).optional(), focusedScreenId: Id.nullable().optional(), settled: z.boolean().optional(), screenCapture: z.boolean().optional() }).strict(),
  reportBase.extend({ kind: z.literal("screen"), screenId: Id, codeVersion: z.string().max(128), mountedAt: z.number().positive(), state: Props, navigation: z.string().max(100).nullable(),
    /** Recent console warnings and errors from the shared runtime, newest last. */
    console: z.array(z.string().max(400)).max(20).optional() }).strict(),
]);
export type StudioReport = z.infer<typeof StudioReportSchema>;

/** Presence of the native canvas; never saved project data. */
export interface StudioStatus {
  hostId: string | null;
  connected: boolean;
  starting: boolean;
  ready: boolean;
  phase: string;
  readyCount: number;
  expectedCount: number;
  error: string | null;
  screens: { screenId: string; current: boolean; error: string | null }[];
}

/** A canvas image rendered by the host itself in answer to a capture command. */
export const SnapshotSchema = z.object({ workspaceId: z.uuid(), hostId: z.uuid(), id: z.number().int().positive(), png: z.string().min(8).max(40_000_000) }).strict();
