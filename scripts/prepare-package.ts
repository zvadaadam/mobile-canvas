import { copyFile, readFile } from 'node:fs/promises';

// npm excludes package-lock.json from archives. Ship the host lock under an
// explicit name so ordinary npm pack/publish retain it.
const host = new URL('../apps/native-host/', import.meta.url);
try {
  await copyFile(new URL('package-lock.json', host), new URL('dependencies.lock', host));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  // Repacking an installed archive has only the already packaged snapshot.
  await readFile(new URL('dependencies.lock', host));
}
