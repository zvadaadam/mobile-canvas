import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { importSwift } from '../src/runtime/adapters/swift/import';
import { ProjectStore } from '../src/runtime/project';
import { repository } from '../src/runtime/paths';
import { startRuntime } from '../src/runtime/server';
import { identityOf, type Session } from '../src/shared/model';

test('CLI selects Swift components in an existing app or project without launching native code', { skip: process.platform !== 'darwin' }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'canvas-cli-previews-')));
  const app = join(root, 'app');
  await mkdir(app);
  const code = `import SwiftUI
@main struct SampleApp: App { var body: some Scene { WindowGroup { Home() } } }
struct Home: View { var body: some View { Text("Home") } }
struct AnimatedIcon: View { var body: some View { Text("Icon") } }
#Preview("Home") { Home() }
#Preview("Animated icon") { AnimatedIcon() }
`;
  await writeFile(join(app, 'App.swift'), code);
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const mode of ['app', 'project']) await t.test(mode, async t => {
    const project = join(root, mode + '-canvas');
    const store = await ProjectStore.initialize(project, 'CLI preview test', {
      app, spec: { adapter: 'swift-ios', buildStrategy: 'xcode', files: ['App.swift'], resources: [], target: 'App', overrides: {} },
    });
    await importSwift(store, { ...identityOf(store.session()), requestId: randomUUID(), from: app, link: true, map: true });
    assert.equal(store.session().project.document.screenIds.length, 1);
    const initialId = store.session().project.document.screenIds[0];
    await store.close();
    const runtime = await startRuntime({ project, port: 0 });
    const mcp = new Client({ name: 'cli-preview-test', version: '1' });
    t.after(async () => { await mcp.close(); await runtime.close(); });
    await mcp.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(repository, 'bin/expo-canvas.mjs'), 'mcp', '--project', project,
        ...(mode === 'app' ? ['--app', app] : []), '--swift-preview', 'Animated icon'],
      stderr: 'pipe',
    }));
    const result = await mcp.callTool({ name: 'canvas_read', arguments: {} });
    assert.ok(!result.isError, JSON.stringify(result));
    const session = JSON.parse((result.content as { text: string }[])[0].text) as Session;
    assert.equal(session.project.document.screenIds.length, 2);
    assert.ok(session.project.document.screenIds.includes(initialId));
    const component = Object.values(session.project.document.screens).find(screen => (screen.props.native as any)?.kind === 'component');
    assert.equal(component?.name, 'Animated icon · Component');
    assert.equal(runtime.studio.state().hostId, null);
    assert.equal(await readFile(join(app, 'App.swift'), 'utf8'), code);
  });
});

test('CLI rejects Swift import options on existing Expo projects', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'canvas-cli-options-')));
  const app = join(root, 'app'), project = join(root, 'canvas');
  await mkdir(app);
  await writeFile(join(app, 'package.json'), '{"dependencies":{"expo":"~57.0.0"}}');
  const store = await ProjectStore.initialize(project, 'Expo');
  await store.close();
  const runtime = await startRuntime({ project, port: 0 });
  t.after(async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); });
  for (const option of [['--swift-preview', 'Icon'], ['--swift-context', 'isolated']]) {
    for (const paths of [[], ['--app', app]]) {
      await assert.rejects(promisify(execFile)(process.execPath, [
        join(repository, 'bin/expo-canvas.mjs'), 'mcp', '--project', project, ...paths, ...option,
      ], { timeout: 15_000 }), /require a Swift project/);
    }
  }
  assert.equal(runtime.store.session().project.sequence, 0);
  assert.equal(runtime.studio.state().hostId, null);
});
