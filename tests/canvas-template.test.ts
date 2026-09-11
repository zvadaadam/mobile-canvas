import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeCanvas, stageNativeCanvas, nativeResourceFingerprint } from '../src/runtime/host/canvas-template';

test('shared canvas staging preserves renderer sources and fingerprints resource bytes', async t => {
  const host = await mkdtemp(join(tmpdir(), 'canvas-template-'));
  t.after(() => rm(host, { recursive: true, force: true }));
  await mkdir(join(host, 'native'));
  await writeFile(join(host, 'native/ExpoRenderer.swift'), '// renderer-owned');
  await stageNativeCanvas(host);
  assert.equal(await readFile(join(host, 'native/ExpoRenderer.swift'), 'utf8'), '// renderer-owned');
  assert.deepEqual(await readFile(join(host, 'native/CanvasHost.swift')), await readFile(join(nativeCanvas.sources, 'CanvasHost.swift')));
  const resources = join(host, 'assets');
  const first = await nativeResourceFingerprint(resources);
  assert.equal(first, await nativeResourceFingerprint(), 'copying preserves the asset fingerprint');
  await writeFile(join(resources, 'ExpoWordmark.imageset/expo-wordmark.svg'), '<svg/>');
  assert.notEqual(await nativeResourceFingerprint(resources), first, 'a resource-only edit invalidates Swift builds');
});
