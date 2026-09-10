import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Read install prerequisites without evaluating app configuration or exposing registry credentials. */
export async function appDependencies(app: string) {
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  const versions: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error(`Invalid dependency name: ${name}`);
    try {
      const installed = JSON.parse(await readFile(join(app, "node_modules", name, "package.json"), "utf8"));
      if (typeof installed.version !== "string") throw new Error("Missing version");
      versions[name] = installed.version;
    } catch { missing.push(name); }
  }
  const npmrc = await readFile(join(app, ".npmrc"), "utf8").catch(() => "");
  const scopes = [...npmrc.matchAll(/^\s*(@[a-z0-9._-]+):registry\s*=/gmi)].map(match => match[1]);
  const registryPackages = missing.filter(name => scopes.some(scope => name.startsWith(`${scope}/`)));
  const bunLock = await readFile(join(app, "bun.lock")).then(() => true, () => false);
  const install = pkg.packageManager?.startsWith("bun@") || bunLock ? "bun install --frozen-lockfile" : "npm install";
  return { declaredExpo: pkg.dependencies?.expo ?? null, installedExpo: versions.expo ?? null, versions, missing, registryPackages, install };
}

export function dependencyIssue(report: Awaited<ReturnType<typeof appDependencies>>) {
  if (!report.missing.length) return null;
  return `App dependencies are not installed: ${report.missing.join(", ")}. Run ${report.install} in the source app before opening its native preview.`
    + (report.registryPackages.length ? ` Check local package access for ${report.registryPackages.join(", ")} using the app's .npmrc; do not put access tokens in canvas metadata.` : "");
}
