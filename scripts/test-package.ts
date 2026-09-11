import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packageCanvas } from './package';
import { repository } from '../src/runtime/paths';
const run = promisify(execFile);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'canvas-package-')));
const { manifest, tarball } = await packageCanvas();
const files = manifest.files.map((file: { path: string }) => file.path) as string[];
for (const file of files) assert.ok(!/(^|\/)(\.context|\.conductor|node_modules|ios|build|designs|\.env[^/]*|\.npmrc)(\/|$)|\.(p12|mobileprovision)$/.test(file), `private/build material included: ${file}`);
const requiredInputs = [
  'bin/expo-canvas.mjs',
  'src/runtime/cli.ts',
  'src/runtime/host/build.ts',
  'src/runtime/adapters/expo/frames.ts',
  'src/runtime/host/canvas-template.ts',
  ...(await readdir(join(repository, 'packages/native-canvas/Sources'))).filter(name => name.endsWith('.swift')).map(name => `packages/native-canvas/Sources/${name}`),
  'packages/native-canvas/Tools/capture.swift',
  'packages/native-canvas/Resources/InterMedium.dataset/Inter-Medium.ttf',
  'packages/native-canvas/Resources/LICENSE-Expo',
  'packages/native-canvas/Resources/LICENSE-Inter',
  'apps/native-host/native/ExpoRenderer.swift',
  'apps/swift-host/SwiftRenderer.swift',
  'apps/native-host/dependencies.lock',
  'apps/linked-host/design/environment.cjs',
  'packages/preview/index.tsx',
];
for (const file of requiredInputs) assert.ok(files.includes(file), `missing runtime input: ${file}`);
assert.ok(!files.some(file => /^apps\/native-host\/(?:assets\/|native\/Canvas|capture\.swift)/.test(file)), "generated shared canvas copies must not be packaged");
const client = new Client({ name: 'installed-package-test', version: '1' });
try {
  const prefix = join(directory, 'install');
  console.log('Installing the tarball with production dependencies in an isolated prefix…');
  await run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: directory, timeout: 120_000 });
  const bin = join(prefix, 'bin/expo-canvas');
  assert.match((await run(bin, ['--help'], { cwd: directory })).stdout, /Expo Canvas/);
  const nodeOnly = join(directory, 'node-only');
  await mkdir(nodeOnly); await symlink(process.execPath, join(nodeOnly, 'node'));
  const setupEnv = { ...process.env, PATH: nodeOnly, EXPO_CANVAS_DATA_DIR: join(directory, 'settings'), EXPO_CANVAS_CACHE_DIR: join(directory, 'cache') };
  const missing = await run(bin, ['setup', '--team', 'ABCDEFGHIJ'], { cwd: directory, env: setupEnv }).then(() => { throw new Error('Missing tools must fail setup'); }, error => error);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /Full Xcode is unavailable/);
  assert.match(missing.stdout, /CocoaPods is not available/);
  assert.equal(JSON.parse(await readFile(join(directory, 'settings/settings.json'), 'utf8')).team, 'ABCDEFGHIJ');

  const installed = join(prefix, 'lib/node_modules/expo-canvas');
  for (const dependency of ['tsx', 'typescript']) await readFile(join(installed, 'node_modules', dependency, 'package.json'));
  const app = join(directory, 'app'), project = join(directory, 'project');
  await mkdir(join(app, 'app'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'package-test', dependencies: { expo: '~56.0.0' } }));
  await writeFile(join(app, 'app/index.tsx'), 'export default function Home(){return null}');
  await writeFile(join(app, 'app/detail.tsx'), 'export default function Detail(){return null}');
  const rootSetup = await run(bin, ['setup', '--json'], { cwd: app, env: setupEnv }).then(result => result.stdout, error => error.stdout);
  assert.ok(JSON.parse(rootSetup).checks.some((check: any) => check.id === 'app-sdk'), 'setup must detect the current Expo root');
  await run(bin, ['init', '--project', project, '--name', 'Installed package test'], { cwd: directory });
  // MCP owns its temporary runtime, so closing this client leaves no detached process.
  await client.connect(new StdioClientTransport({ command: bin, args: ['mcp'], cwd: project, stderr: 'inherit', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } as Record<string, string> }));
  const list = await client.listTools();
  assert.ok(list.tools.some(tool => tool.name === 'canvas_environment'));
  const read: any = await client.callTool({ name: 'canvas_read', arguments: {} });
  const session = JSON.parse(read.content[0].text);
  const imported: any = await client.callTool({ name: 'canvas_import', arguments: { workspaceId: session.project.workspaceId, sequence: session.project.sequence, requestId: crypto.randomUUID(), from: app, link: true, map: true } });
  assert.ok(!imported.isError, JSON.stringify(imported));
  const result: any = await client.callTool({ name: 'canvas_route_map', arguments: {} });
  assert.ok(!result.isError, JSON.stringify(result));
  const sitemap = JSON.parse(result.content[0].text);
  assert.equal(sitemap.routes.length, 2);
  const environment: any = await client.callTool({ name: 'canvas_environment', arguments: {} });
  assert.ok(!environment.isError, JSON.stringify(environment));
  assert.ok(JSON.parse(environment.content[0].text).checks.some((check: any) => check.id === 'xcode'));
  const report = { tarball, files: files.length, compressedBytes: manifest.size, verified: ['production-only npm installation outside the checkout', 'installed expo-canvas --help', 'actual installed MCP handshake and tool list', 'two-route mapping through the installed MCP server', 'Mac prerequisite report through MCP', 'installed setup explains missing tools and persists the team outside the package', 'setup detects the current Expo root and MCP detects the current Canvas root'], nativeBuild: 'not exercised by this package smoke test' };
  await writeFile(join(repository, '.context/distribution/package-test.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
