import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRouteMap } from '../src/runtime/adapters/expo/frames';
import { ProjectStore } from '../src/runtime/project';
import { identityOf } from '../src/shared/model';
import { arrangeByFlow } from '../src/runtime/arrange';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import apps from '../tests/compatibility/apps.json';
const run = promisify(execFile);
const cache = resolve('.context/compatibility');
await mkdir(cache, { recursive: true });
const reports: unknown[] = [];
for (const app of apps) {
 if (process.argv.includes('--public') && app.access !== 'public') {
  reports.push({app: app.id, status: 'not-selected', reason: 'Private reference; use the full maintainer corpus with repository access.'});
  console.log(`${app.id}: private reference not selected by --public`);
  continue;
 }
 const started = Date.now(), directory = await realpath(await mkdtemp(join(tmpdir(), `canvas-${app.id}-`)));
 let store: ProjectStore | undefined;
 try {
  let repo = resolve(app.local ?? join(cache, 'repos', app.id));
  // An explicit local cache is optional; missing sources are fetched at the pinned revision.
  try { await run('git', ['-C', repo, 'cat-file', '-e', `${app.revision}^{commit}`]); }
  catch {
   repo = join(cache, 'repos', app.id); await mkdir(repo, { recursive: true });
   await run('git', ['init', repo]);
   await run('git', ['-C', repo, 'fetch', '--depth=1', app.repository, app.revision]);
  }
  const archive = join(directory, 'source.tar'), source = join(directory, 'app');
  const tracked = (await run('git', ['-C', repo, 'ls-tree', '-r', '--name-only', app.revision])).stdout.split('\n').filter(path => /\.(?:[cm]?[jt]sx?|json)$/.test(path) && !/(^|\/)(node_modules|package-lock\.json)/.test(path));
  await run('git', ['-C', repo, 'archive', '--format=tar', '--output', archive, app.revision, ...tracked]);
  await mkdir(source); await run('tar', ['-xf', archive, '-C', source]);
  const options = { app: source, routesDirectory: app.routes, aliases: { '@/': resolve(source, app.aliasRoot) } };
  const map = await buildRouteMap(options), repeat = await buildRouteMap(options);
  assert.deepEqual(map, repeat, 'mapping must be deterministic');
  assert.equal(map.frames.length, app.frames, 'visual frame coverage');
  assert.equal(new Set(map.frames.map(frame => frame.file)).size, app.sourceRoutes, 'source route coverage');
  assert.equal(map.frames.filter(frame => frame.step).length, app.steps, 'step coverage');
  const keys = new Set(map.frames.map(frame => frame.key));
  assert.equal(keys.size, map.frames.length, 'unique visual keys');
  for (const frame of map.frames) for (const target of frame.links) assert.ok(keys.has(target), `${frame.key} has dangling link ${target}`);
  for (const [from, to] of app.requiredLinks) assert.ok(map.frames.find(frame => frame.key === from)?.links.includes(to), `${from} → ${to} missing`);
  for (const [from, to] of app.forbiddenLinks) assert.ok(!map.frames.find(frame => frame.key === from)?.links.includes(to), `${from} → ${to} is not content navigation`);
  store = await ProjectStore.initialize(join(directory, 'project'), app.id);
  const importApp = () => store!.importSources({ ...identityOf(store!.session()), requestId: crypto.randomUUID(), from: source, link: true, map: true });
  await importApp(); const before = store.session(); await importApp();
  assert.deepEqual(store.session().project.document.screenIds, before.project.document.screenIds, 'stable re-import IDs');
  assert.deepEqual(store.session().project.document.screens, before.project.document.screens, 'stable re-import metadata and positions');
  const document = store.session().project.document;
  const moves = arrangeByFlow(document), positions = new Map(moves.map(move => [move.id, move.patch]));
  const screens = Object.values(document.screens).map(screen => ({ ...screen, ...positions.get(screen.id) }));
  for (let i = 0; i < screens.length; i++) for (let j = i + 1; j < screens.length; j++) {
   const a = screens[i], b = screens[j];
   assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `overlap: ${a.key} / ${b.key}`);
  }
  for (let i = 1; i < app.orderedRows.length; i++) {
   const before = screens.find(screen => screen.key === app.orderedRows[i - 1])!;
   const after = screens.find(screen => screen.key === app.orderedRows[i])!;
   assert.ok(before && after && before.y + before.height <= after.y, `flow order: ${app.orderedRows[i - 1]} → ${app.orderedRows[i]}`);
  }
  const native: unknown[] = [];
  if (process.argv.includes('--native') && app.nativeProject) {
   // Inspect existing native experiments, never stop/rebuild an unrelated session.
   // Opening/building remains explicit via the regular product command.
   const client = new Client({ name: 'compatibility-suite', version: '1' });
   try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('bin/mobile-canvas.mjs'), 'mcp', '--project', resolve(app.nativeProject)], stderr: 'inherit' }));
    const call = async (name: string, args: any = {}) => { const result: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }); assert.ok(!result.isError, JSON.stringify(result)); return result; };
    const json = async (name: string) => JSON.parse((await call(name)).content[0].text);
    const session = await json('canvas_read'); const state = await json('canvas_studio_state');
    assert.equal(state.screenErrorCount ?? 0, 0, `${app.id}: native frame errors`);
    assert.ok(state.connected && state.resolverCurrent, `${app.id}: open its current native project first`);
    for (const key of app.nativeScreens) {
     const screen: any = Object.values(session.project.document.screens).find((screen: any) => screen.key === key); assert.ok(screen, key);
     const result = await call('canvas_inspect_screen', { ...identityOf(session), hostId: state.hostId, screenId: screen.id });
     const meta = JSON.parse(result.content[0].text); assert.equal(meta.error, null, `${key}: preview exception`);
     const png = Buffer.from(result.content[1].data, 'base64'); assert.ok(png.length > 1000);
     await writeFile(join(cache, `${app.id}-${key}.png`), png);
     native.push({ key, ready: meta.ready, routePreview: meta.state.routePreview, image: `${app.id}-${key}.png` });
    }
   } finally { await client.close(); }
  }
  if (process.argv.includes('--native') && !app.nativeProject) console.log(`${app.id}: native not configured — ${app.nativeUnavailableReason}`);
  reports.push({ app: app.id, revision: app.revision, status: 'passed', frames: map.frames.length, links: map.frames.reduce((sum, frame) => sum + frame.links.length, 0), native: process.argv.includes('--native') ? app.nativeProject ? { captures: native, visualReview: 'required; receipts are not pixel fidelity proof' } : { status: 'not configured', reason: app.nativeUnavailableReason } : 'not run', ms: Date.now() - started });
  console.log(`${app.id}: mapping, links, re-import and arrangement passed${native.length ? `; ${native.length} native captures` : ''}`);
 } catch (error) { reports.push({ app: app.id, status: 'failed', error: String(error) }); process.exitCode = 1; console.error(`${app.id}: ${error}`); }
 finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
}
await writeFile(join(cache, 'report.json'), JSON.stringify({ date: new Date().toISOString(), reports }, null, 2));
