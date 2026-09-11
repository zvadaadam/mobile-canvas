import { lstat, realpath, mkdir } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError } from "./errors";

/** The Mobile Canvas checkout: the CLI entry, the native host and its build live here. */
export const repository = fileURLToPath(new URL("../..", import.meta.url));

/** Reject every symlink component, including a directory above an otherwise safe file. */
export async function projectPath(
  root: string,
  relative: string,
  createParents = false,
): Promise<string> {
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.includes("\\") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new CanvasError("invalid_path", "Use a safe project-relative path");
  const base = await realpath(root);
  const target = resolve(base, relative);
  if (!target.startsWith(base + sep))
    throw new CanvasError("invalid_path", "Path leaves this project");
  let current = base;
  for (const part of relative.split("/")) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new CanvasError(
          "invalid_path",
          "Project paths cannot contain symlinks",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (createParents) await mkdir(dirname(target), { recursive: true });
  return target;
}
