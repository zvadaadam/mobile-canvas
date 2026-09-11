import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repository } from "./paths";

export const canvasSkills = [{
  name: "core",
  description: "Explore the screen map, inspect native pixels, edit safely and diagnose preview limits. Start here.",
  uri: "mobile-canvas://skills/core",
}] as const;

/** Read only bundled guidance; a skill name is never a filesystem path. */
export async function readCanvasSkill(name: string, full = false): Promise<string> {
  if (!canvasSkills.some(skill => skill.name === name)) {
    throw new Error(`Unknown skill ${JSON.stringify(name)}. Available skills: core.`);
  }
  const core = await readFile(join(repository, "docs/agent-workflow.md"), "utf8");
  if (!full) return core;
  return `${core}\n---\n\n${await readFile(join(repository, "docs/agents.md"), "utf8")}`;
}
