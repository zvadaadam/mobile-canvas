/** Explicit, slow Mac acceptance test. Keeps artifacts for pixel review; never publishes. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packageCanvas } from './package';
import { signingTeam } from '../src/runtime/installation';
import apps from '../tests/compatibility/apps.json';
const run = promisify(execFile);
const team = await signingTeam();
assert.ok(team, 'Configure an existing development signing team before this explicit native test.');
const reuse = process.argv.indexOf('--resume');
const directory = reuse >= 0 ? await realpath(process.argv[reuse + 1]) : await realpath(await mkdtemp(join(tmpdir(), 'Mobile Canvas package ')));
if (reuse >= 0) await run('chmod', ['-R', 'u+w', join(directory, 'install')]);
const env = { ...process.env, EXPO_CANVAS_DATA_DIR: join(directory, 'settings'), EXPO_CANVAS_CACHE_DIR: join(directory, 'cache'), NODE_PATH: '', NODE_OPTIONS: '' } as Record<string, string>;
delete env.EXPO_CANVAS_DEVELOPMENT_TEAM;
const { tarball } = await packageCanvas();
const prefix = join(directory, 'install');
await run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: directory, timeout: 120_000 });
const bin = join(prefix, 'bin/mobile-canvas');
const installed = join(prefix, 'lib/node_modules/mobile-canvas');
await run('chmod', ['-R', 'a-w', installed]);
const reports: unknown[] = [];
console.log(`Installed immutable package: ${installed}`);
const selected = process.argv.includes('--hot-only') ? apps.filter(app => app.id === 'hot-chocolate') : apps.filter(app => app.nativeProject);
for (const app of selected) {
  const source = resolve('.context/compatibility/package-repos', app.id);
  await mkdir(resolve('.context/compatibility/package-repos'), { recursive: true });
  try { await run('git', ['-C', source, 'rev-parse', 'HEAD']); }
  catch { await run('git', ['clone', app.repository, source], { timeout: 120_000 }); await run('git', ['-C', source, 'checkout', '--detach', app.revision]); }
  assert.equal((await run('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim(), app.revision);
  const sourceBefore = (await run('git', ['-C', source, 'diff', 'HEAD'])).stdout;
  assert.equal(sourceBefore, '', 'Use an unchanged pinned test checkout.');
  console.log(`${app.id}: setup and frozen app dependency installation…`);
  const setup = await run(bin, ['setup', '--team', team, '--app', source, '--install', ...(app.offline ? ['--offline'] : [])], { cwd: directory, env, timeout: 180_000, maxBuffer: 4_000_000 });
  await writeFile(join(directory, `${app.id}-setup.log`), setup.stdout + setup.stderr);
  const project = join(directory, `${app.id} project`);
  const client = new Client({ name: 'installed-native-acceptance', version: '1' });
  const started = Date.now();
  try {
    await client.connect(new StdioClientTransport({ command: bin, args: ['mcp', '--app', source, '--project', project, ...(app.offline ? ['--offline'] : [])], cwd: directory, env, stderr: 'inherit' }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
      assert.ok(!result.isError, JSON.stringify(result)); return result;
    };
    const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await call(name, args)).content[0].text);
    const identity = (session: any) => ({ workspaceId: session.project.workspaceId, sequence: session.project.sequence });
    let session = await json('canvas_read');
    await json('canvas_studio_open', identity(session));
    let state: any;
    let lastLog = '';
    const waitReady = async () => {
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        state = await json('canvas_studio_state');
        if (state.logs.at(-1) && state.logs.at(-1) !== lastLog) { lastLog = state.logs.at(-1); console.log(`${app.id}: ${lastLog}`); }
        assert.ok(!state.error, state.error);
        if (state.connected && state.ready) return;
        await new Promise(done => setTimeout(done, 1000));
      }
      throw new Error('Native readiness timed out.');
    };
    await waitReady();
    const coldReadyMs = Date.now() - started;
    const images: string[] = [];
    for (const key of app.nativeScreens) {
      session = await json('canvas_read');
      const screen: any = Object.values(session.project.document.screens).find((entry: any) => entry.key === key);
      assert.ok(screen, key);
      const result = await call('canvas_inspect_screen', { ...identity(session), hostId: state.hostId, screenId: screen.id });
      const meta = JSON.parse(result.content[0].text);
      assert.equal(meta.error, null);
      const image = join(directory, `${app.id}-${key}.png`);
      await writeFile(image, Buffer.from(result.content[1].data, 'base64')); images.push(image);
    }
    session = await json('canvas_read');
    const canvas = await call('canvas_studio_capture', { ...identity(session), hostId: state.hostId });
    const canvasImage = join(directory, `${app.id}-canvas.png`);
    await writeFile(canvasImage, Buffer.from(canvas.content[1].data, 'base64'));
    await json('canvas_studio_stop', identity(session));
    const warmStarted = Date.now();
    await json('canvas_studio_open', identity(session));
    await waitReady();
    const warmReadyMs = Date.now() - warmStarted;
    session = await json('canvas_read');
    await json('canvas_studio_stop', identity(session));
    assert.equal((await run('git', ['-C', source, 'diff', 'HEAD'])).stdout, sourceBefore, 'Source files changed.');
    reports.push({ app: app.id, revision: app.revision, coldReadyMs, reusedAttemptDirectory: reuse >= 0, warmReadyMs, images, canvasImage, project, sourceUnchanged: true });
    console.log(`${app.id}: ${images.length} native captures; cold ${(coldReadyMs / 1000).toFixed(1)}s, warm ${(warmReadyMs / 1000).toFixed(1)}s`);
  } finally { await client.close(); }
}
const report = { date: new Date().toISOString(), directory, bin, tarball, installedPrefixReadOnly: true, reports, limitations: 'Same Mac with preconfigured Xcode/signing and download caches; captures need visual review. Not a second-Mac test.' };
await writeFile(resolve('.context/distribution/native-package-test.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
