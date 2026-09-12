import { copyFile, readFile, access } from 'node:fs/promises';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Source checkouts build the embedded UI. Installed archives already contain it.
const appBuild = new URL('../apps/mcp-app/build.mjs', import.meta.url);
if (await access(appBuild).then(() => true, () => false)) {
  await promisify(execFile)(process.execPath, [fileURLToPath(appBuild)]);
} else {
  await readFile(new URL('../apps/mcp-app/dist/index.html', import.meta.url));
}

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
