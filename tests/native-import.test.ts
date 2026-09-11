import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectStore} from '../src/runtime/project';
import {identityOf} from '../src/shared/model';
import {importSwift} from '../src/runtime/adapters/swift/import';
import {loadSwiftProject, swiftInputFiles} from '../src/runtime/adapters/swift/project';
import {writeXcodeProject} from '../src/runtime/adapters/swift/standalone';

const mac = {skip: process.platform !== 'darwin'};

test('Swift imports replay pending and completed requests in the shared request namespace', mac, async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-import-retry-'));
  const app = join(root, 'app');
  await mkdir(app);
  await writeFile(join(app, 'App.swift'), 'import SwiftUI\n#Preview { Text("Preview") }');
  const store = await ProjectStore.initialize(join(root, 'canvas'), 'Retry', {app, spec: {
    adapter: 'swift-ios', files: ['App.swift'], resources: [], target: 'App', overrides: {},
  }});
  t.after(async () => { await store.close(); await rm(root, {recursive: true, force: true}); });
  const request = {...identityOf(store.session()), requestId: randomUUID(), from: app, link: true, map: true};
  const [first, pending] = await Promise.all([importSwift(store, request), importSwift(store, request)]);
  assert.deepEqual(pending, first);
  assert.deepEqual(await importSwift(store, request), first);
  assert.equal(store.session().project.sequence, 1);
  await assert.rejects(importSwift(store, {...request, swiftContext: 'application'}), /request ID cannot be reused/);
  await assert.rejects(store.execute({...identityOf(store.session()), requestId: request.requestId,
    label: 'Conflicting command', operations: [{type: 'project.rename', name: 'Other'}]}), /request ID cannot be reused/);
});

test('Swift target removal can be refreshed, undone and reopened while builds reject missing inputs', mac, async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-import-removal-'));
  const app = join(root, 'app');
  await mkdir(app);
  const first = join(app, 'First.swift'), removed = join(app, 'Removed.swift');
  await writeFile(first, 'import SwiftUI\n#Preview { Text("First") }');
  await writeFile(removed, 'import SwiftUI\n#Preview { Text("Removed") }');
  await writeXcodeProject(app, [first, removed], [], 'TEST', 'test.canvas');
  const spec = await loadSwiftProject(app);
  const directory = join(root, 'canvas');
  let store = await ProjectStore.initialize(directory, 'Removal', {app, spec});
  t.after(async () => { await store.close(); await rm(root, {recursive: true, force: true}); });
  await importSwift(store, {...identityOf(store.session()), requestId: randomUUID(), from: app, link: true, map: true});
  const before = store.session().nativeVersion;
  await writeXcodeProject(app, [first], [], 'TEST', 'test.canvas');
  await rm(removed);
  await assert.rejects(swiftInputFiles(app, spec), {code: 'ENOENT'});
  await importSwift(store, {...identityOf(store.session()), requestId: randomUUID(), from: app, link: true, map: true});
  assert.deepEqual(store.session().project.document.nativePreview!.files, ['First.swift']);
  assert.notEqual(store.session().nativeVersion, before);
  await store.history('undo', identityOf(store.session()));
  assert.deepEqual(store.session().project.document.nativePreview!.files, ['First.swift', 'Removed.swift']);
  await store.close();
  store = await ProjectStore.open(directory);
  await importSwift(store, {...identityOf(store.session()), requestId: randomUUID(), from: app, link: true, map: true});
  assert.deepEqual(store.session().project.document.nativePreview!.files, ['First.swift']);
});
