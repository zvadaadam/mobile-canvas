import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** One separate experiment per canonical app path; never writes into the source app. */
export async function appProject(app: string) {
  const from = await realpath(app);
  const key = createHash("sha256").update(from).digest("hex").slice(0, 20);
  return { from, project: join(homedir(), ".expo-canvas", "apps", key) };
}
