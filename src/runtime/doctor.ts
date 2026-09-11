import type { CanvasClient } from "./client";
import { isCanvasOnly } from "./origin";
import { createRequire } from "node:module";
import { repository } from "./paths";
import { join } from "node:path";
import { appDependencies, dependencyIssue } from "./adapters/expo/app-dependencies";
const { excluded, iconPackages } = createRequire(import.meta.url)(join(repository, "apps/linked-host/design/environment.cjs")) as { excluded: string[]; iconPackages: string[] };

/** A read-only health report: broken references, host state and, for imported apps, what the experiment changed. */
export async function doctor(client: CanvasClient) {
  const session = await client.read();
  const studio = await client.request("/studio/state").catch(() => null);
  const issues: string[] = [];
  const document = session.project.document;
  const designSubstitutions: string[] = [];
  let app: Awaited<ReturnType<typeof appDependencies>> | null = null;
  if (document.origin?.mode === "linked" && !document.nativePreview) {
    try {
      app = await appDependencies(document.origin.path);
      if (document.appPreview?.offline) designSubstitutions.push(...[...excluded, ...iconPackages].filter(name => app!.versions[name] || app!.missing.includes(name)));
      const issue = dependencyIssue({ ...app, missing: app.missing.filter(name => !designSubstitutions.includes(name)) });
      if (issue) issues.push(issue);
    } catch (error) { issues.push(`App dependencies: ${(error as Error).message}`); }
  }
  const screens = Object.values(document.screens);
  const sources = new Set(session.sources.map((source) => source.path));
  for (const screen of screens) {
    if (!sources.has(screen.source)) issues.push(`${screen.key}: missing source ${screen.source}`);
    for (const key of screen.links)
      if (!screens.some((entry) => entry.key === key)) issues.push(`${screen.key}: unknown navigation link ${key}`);
  }
  if (studio?.error) issues.push(`Native canvas: ${studio.error}`);
  if (studio?.notice) issues.push(`Native canvas: ${studio.notice}`);
  for (const [name, file] of Object.entries(document.resolver?.modules ?? {}))
    if (!sources.has(file)) issues.push(`resolver: ${name} maps to missing ${file}`);
  // Files that stand for app files and differ from them are the experiment's deliberate changes;
  // the runtime's origin review knows which app files exist, so doctor reads it rather than guessing.
  const review = document.origin ? await client.request("/origin/diff").catch(() => null) : null;
  const entries: { path: string; status: string; candidate: boolean }[] = review?.entries ?? [];
  const origin = document.origin
    ? {
        name: document.origin.name,
        path: document.origin.path,
        mode: document.origin.mode,
        commit: document.origin.commit,
        files: document.origin.mode === "linked" ? entries.length : Object.keys(document.origin.files).length,
        diverged: entries.filter((entry) => entry.status === "diverged" && entry.candidate).map((entry) => entry.path).sort(),
        added: entries.filter((entry) => entry.status === "added" && entry.candidate).map((entry) => entry.path).sort(),
        canvasOnly: session.sources.map((source) => source.path).filter((path) => isCanvasOnly(path)).sort(),
        reviewError: review ? null : "The imported app could not be read for review.",
      }
    : null;
  return {
    ok: issues.length === 0,
    issues,
    app,
    designSubstitutions,
    origin,
    screensWithoutContext: screens.filter((screen) => !screen.notes.trim()).map((screen) => screen.key),
    workspaceId: session.project.workspaceId,
    sequence: session.project.sequence,
    screens: document.screenIds.length,
    sourceFiles: session.sources.length,
    studio: studio ? { sdk: studio.sdk, phase: studio.phase, ready: studio.ready, readyCount: studio.readyCount, expectedCount: studio.expectedCount, error: studio.error } : null,
    url: client.url,
  };
}
