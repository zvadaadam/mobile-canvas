import { chmod, cp, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function makeWritable(path: string): Promise<void> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!entry || entry.isSymbolicLink()) return;
  await chmod(path, entry.mode | 0o200 | (entry.isDirectory() ? 0o700 : 0));
  if (entry.isDirectory()) for (const name of await readdir(path)) await makeWritable(join(path, name));
}

/** Templates may come from a read-only npm installation; generated copies are editable. */
export async function copyTemplate(source: string, target: string) {
  await makeWritable(target);
  await cp(source, target, { recursive: true });
  await makeWritable(target);
}
