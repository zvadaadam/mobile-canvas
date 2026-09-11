import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { repository } from '../paths';
import { copyTemplate } from './copy-template';

/** Renderer-independent native sources. Generated Expo hosts retain their own
 * native/assets layout so the config plugin has no checkout-relative imports. */
export const nativeCanvas = {
  sources: join(repository, 'packages/native-canvas/Sources'),
  resources: join(repository, 'packages/native-canvas/Resources'),
  capture: join(repository, 'packages/native-canvas/Tools/capture.swift'),
};

export async function stageNativeCanvas(host: string) {
  await copyTemplate(nativeCanvas.sources, join(host, 'native'));
  await copyTemplate(nativeCanvas.resources, join(host, 'assets'));
}

/** Asset bytes participate in native build identity, including fonts and SVGs. */
export async function nativeResourceFingerprint(directory = nativeCanvas.resources) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const paths = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
  const hash = createHash('sha256');
  for (const path of paths) hash.update(relative(directory, path)).update('\0').update(await readFile(path)).update('\0');
  return hash.digest('hex');
}
