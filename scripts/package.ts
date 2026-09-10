import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository } from '../src/runtime/paths';
export async function packageCanvas() {
  const directory = join(repository, '.context/distribution');
  await mkdir(directory, { recursive: true });
  const { stdout } = await promisify(execFile)('npm', ['pack', '--json', '--pack-destination', directory], { cwd: repository, maxBuffer: 2_000_000 });
  const [manifest] = JSON.parse(stdout);
  await writeFile(join(directory, 'package-manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, tarball: join(directory, manifest.filename) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest, tarball } = await packageCanvas();
  console.log(`${tarball}\n${manifest.entryCount} files · ${manifest.size} bytes compressed`);
}
