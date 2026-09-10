import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appDependencies, dependencyIssue } from "../src/runtime/app-dependencies";
import { prepareMatchedHost } from "../src/runtime/host/matched";

test("private dependency failures identify the install prerequisite without exposing registry credentials or attempting a native build", async t => {
  const root = await mkdtemp(join(tmpdir(), "canvas-private-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "app"), project = join(root, "project");
  await mkdir(join(app, "node_modules/expo"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ packageManager: "bun@1.2.22", dependencies: { expo: "~57.0.21", "@icons/pro": "1.0.0" } }));
  await writeFile(join(app, "node_modules/expo/package.json"), JSON.stringify({ version: "57.0.21" }));
  await writeFile(join(app, ".npmrc"), "@icons:registry=https://user:private-password@packages.example/\n//packages.example/:_authToken=private-token\n");
  await writeFile(join(app, "app.config.js"), "throw new Error('app config must not execute');");
  const report = await appDependencies(app);
  assert.deepEqual(report.missing, ["@icons/pro"]);
  assert.deepEqual(report.registryPackages, ["@icons/pro"]);
  assert.equal(report.installedExpo, "57.0.21");
  assert.match(dependencyIssue(report)!, /bun install --frozen-lockfile/);
  assert.doesNotMatch(JSON.stringify(report) + dependencyIssue(report), /private-password|private-token|packages\.example/);
  await assert.rejects(prepareMatchedHost(project, app), /App dependencies are not installed: @icons\/pro/);
  await assert.rejects(readFile(join(project, ".expo-canvas/native-host/package.json")), { code: "ENOENT" });
  await mkdir(join(app, "node_modules/@icons/pro"), { recursive: true });
  await writeFile(join(app, "node_modules/@icons/pro/package.json"), JSON.stringify({ version: "1.0.0" }));
  assert.equal(dependencyIssue(await appDependencies(app)), null);
});
