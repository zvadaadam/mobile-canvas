import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { ProjectStore } from '../src/runtime/project';
import { CommandSchema, identityOf } from '../src/shared/model';
const exec = promisify(execFile);

test('shared native shell type checks with both Swift 6 default isolation modes', { skip: process.platform !== 'darwin', timeout: 60_000 }, async () => {
  const sources = resolve('packages/native-canvas/Sources');
  const { stdout: sdk } = await exec('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']);
  const files = (await readdir(sources)).filter(name => name.endsWith('.swift')).sort().map(name => join(sources, name));
  files.push(resolve('apps/swift-host/SwiftRenderer.swift'), resolve('apps/swift-host/DeviceCapabilities.swift'), resolve('tests/native/Registry.swift'));
  for (const isolation of [[], ['-default-isolation', 'MainActor']])
    await exec('xcrun', ['swiftc', '-typecheck', '-swift-version', '6', ...isolation, '-target', 'arm64-apple-ios17.0', '-sdk', sdk.trim(), ...files]);
});

test('native Swift contracts, session races, viewport and runtime connection', { skip: process.platform !== 'darwin', timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-native-model-'));
  const store = await ProjectStore.initialize(join(root, 'project'), 'Native contract');
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: 'fixture', label: 'Fixture', operations: ['first', 'second', 'third'].map(key => ({
    type: 'screen.create', screen: { key, name: key, props: { enabled: false, count: 0, nested: [null, 'value'] } },
  })) }));
  const fixture = store.session();
  await writeFile(join(root, 'session.json'), JSON.stringify(fixture));
  let sessionReads = 0;
  let activeSelections = 0;
  let maxActiveSelections = 0;
  const selections: string[] = [];
  const server = createServer(async (request, response) => {
    const json = (status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url === '/api/session') {
      if (++sessionReads === 1) return json(503, { error: { message: 'Temporary disconnect' } });
      return json(200, fixture);
    }
    if (request.url === '/api/selection') {
      activeSelections++;
      maxActiveSelections = Math.max(maxActiveSelections, activeSelections);
      let body = '';
      for await (const chunk of request) body += chunk;
      const selection = JSON.parse(body).ids;
      selections.push(selection[0]);
      await new Promise(resolve => setTimeout(resolve, selections.length === 1 ? 100 : 0));
      fixture.selection = selection;
      activeSelections--;
      return json(200, fixture);
    }
    if (request.url === '/api/slow') { await new Promise(resolve => setTimeout(resolve, 250)); return json(200, {}); }
    if (request.url === '/api/malformed') { response.end('{'); return; }
    json(404, { error: { message: 'Unknown test endpoint' } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address() as { port: number };
  const binary = join(root, 'native-model-tests');
  await exec('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library', ...['CanvasWire', 'CanvasRuntimeClient', 'CanvasSession', 'CanvasViewport'].map(name => resolve(`packages/native-canvas/Sources/${name}.swift`)), resolve('tests/native/CanvasModelTests.swift'), '-o', binary]);
  const { stdout } = await exec(binary, [join(root, 'session.json'), `http://127.0.0.1:${address.port}`]);
  assert.equal(stdout.match(/^PASS /gm)?.length, 4, stdout);
  assert.equal(maxActiveSelections, 1, 'Selection writes must not overtake one another');
  assert.deepEqual(selections, [fixture.project.document.screenIds[0], fixture.project.document.screenIds[2]], 'Intermediate clicks should be coalesced');
});
