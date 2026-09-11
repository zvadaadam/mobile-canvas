import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../src/runtime/project';
import { isSwiftInput } from '../src/runtime/adapters/swift/project';
import type { SwiftProject } from '../src/shared/native';

test('native input watching tracks shaders, asset bytes and build configuration', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'canvas-inputs-')));
  const app = join(root, 'app');
  await mkdir(join(app, 'Images.xcassets', 'Photo.imageset'), { recursive: true });
  const initial = {
    'App.swift': 'import SwiftUI',
    'Shader.metal': '// shader',
    'Images.xcassets/Photo.imageset/photo.png': 'image bytes',
    'Info.plist': '<plist/>',
    'Package.resolved': '{}',
  };
  for (const [path, bytes] of Object.entries(initial)) await writeFile(join(app, path), bytes);
  const spec: SwiftProject = {
    adapter: 'swift-ios', target: 'Test', files: ['App.swift'], resources: ['Images.xcassets'],
    buildInputs: ['Shader.metal', 'Info.plist', 'Package.resolved'], overrides: {},
  };
  assert.equal(isSwiftInput(spec, 'Images.xcassets-copy/Photo.png'), false);
  assert.equal(isSwiftInput(spec, '.git/index'), false);
  const store = await ProjectStore.initialize(join(root, 'canvas'), 'Inputs', { app, spec });
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  for (const path of Object.keys(initial).filter(path => !path.endsWith('.swift'))) {
    const version = store.session().nativeVersion;
    const changed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No native refresh for ${path}`)); }, 5000);
      const unsubscribe = store.subscribe(() => {
        if (store.session().nativeVersion === version) return;
        clearTimeout(timer); unsubscribe(); resolve();
      });
    });
    await writeFile(join(app, path), 'updated ' + path);
    await changed;
    assert.notEqual(store.session().nativeVersion, version, path);
  }
});
