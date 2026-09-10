import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { repository } from './paths';

export const dataDirectory = resolve(process.env.EXPO_CANVAS_DATA_DIR ?? join(homedir(), 'Library/Application Support/Expo Canvas'));
export const cacheDirectory = resolve(process.env.EXPO_CANVAS_CACHE_DIR ?? join(homedir(), 'Library/Caches/Expo Canvas'));
const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version;
export const sourceCheckout = existsSync(join(repository, '.git'));
export const authoredHostPaths = sourceCheckout
  ? { host: join(repository, 'apps/native-host'), output: join(repository, '.context/native-studio') }
  : { host: join(cacheDirectory, `authored-${version}`, 'host'), output: join(cacheDirectory, `authored-${version}`, 'build') };

export async function signingTeam(project?: string) {
  if (process.env.EXPO_CANVAS_DEVELOPMENT_TEAM) return process.env.EXPO_CANVAS_DEVELOPMENT_TEAM;
  const files = [join(dataDirectory, 'settings.json'), ...(project ? [join(project, '.expo-canvas/native-build/signing.json')] : []), ...(sourceCheckout ? [join(repository, '.context/native-studio/signing.json')] : [])];
  for (const file of files) {
    try { const { team } = JSON.parse(await readFile(file, 'utf8')); if (team) return team as string; } catch {}
  }
}

export async function saveSigningTeam(team: string) {
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('Use the ten-character Apple development team ID shown in Xcode.');
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(join(dataDirectory, 'settings.json'), JSON.stringify({ team }) + '\n', { mode: 0o600 });
}

/** iOS-on-Mac launches from macOS temporary directories can stall before dyld starts.
 * Keep those runnable wrappers in the ordinary user cache; build inputs stay put. */
export function nativeAppPath(output: string) {
  const normalize = (path: string) => resolve(path).replace(/^\/private(?=\/(?:var|tmp)\/)/, '');
  const path = normalize(output);
  const temporary = [normalize(tmpdir()), '/tmp'].some(root => path === root || path.startsWith(root + '/'));
  const directory = temporary ? join(homedir(), 'Library/Caches/Expo Canvas/renderers', createHash('sha256').update(resolve(output)).digest('hex').slice(0, 20)) : output;
  return join(directory, 'Expo Canvas Native.app');
}
