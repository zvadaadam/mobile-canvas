import { swiftProjectCandidates } from "./adapters/swift/project";
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Infer only the current root. Never walk upward or evaluate an app config. */
export async function projectContext(directory: string): Promise<{ project?: string; app?: string }> {
  try {
    await readFile(join(directory, 'expo-canvas.json'));
    return { project: directory };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (pkg.dependencies?.expo || pkg.devDependencies?.expo) return { app: directory };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if ((await swiftProjectCandidates(directory)).length) return {app:directory};
  return {};
}
