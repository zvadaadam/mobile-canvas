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
const userConfig = join(directory, 'npm-user-config');
const globalConfig = join(directory, 'npm-global-config');
await writeFile(userConfig, '');
await writeFile(globalConfig, '');
// Installation must not depend on the maintainer's registry credentials,
// cached dependencies, saved signing team or Node loader configuration.
const isolatedEnv = {
  PATH: process.env.PATH ?? '',
  TMPDIR: directory,
  npm_config_userconfig: userConfig,
  npm_config_globalconfig: globalConfig,
  npm_config_cache: join(directory, 'npm-cache'),
  npm_config_registry: 'https://registry.npmjs.org/',
  EXPO_CANVAS_DATA_DIR: join(directory, 'settings'),
  EXPO_CANVAS_CACHE_DIR: join(directory, 'cache'),
  NODE_PATH: '', NODE_OPTIONS: '',
};
const { manifest, tarball } = await packageCanvas();
const files = manifest.files.map((file: { path: string }) => file.path) as string[];
for (const file of files) assert.ok(!/(^|\/)(\.context|\.conductor|node_modules|ios|build|designs|\.env[^/]*|\.npmrc)(\/|$)|\.(p12|mobileprovision)$/.test(file), `private/build material included: ${file}`);
const requiredInputs = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'scripts/prepare-package.ts',
  'bin/mobile-canvas.mjs',
  'skills/mobile-canvas/SKILL.md',
  'docs/agent-workflow.md',
  'docs/agents.md',
  'apps/mcp-app/dist/index.html',
  'apps/mcp-app/dist/THIRD_PARTY_NOTICES.txt',
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
  await run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: directory, env: isolatedEnv, timeout: 120_000 });
  const bin = join(prefix, 'bin/mobile-canvas');
  const core = (await run(bin, ['skills', 'get', 'core'], { cwd: directory, env: isolatedEnv })).stdout;
  assert.equal(core, await readFile(join(repository, 'docs/agent-workflow.md'), 'utf8'));
  const full = JSON.parse((await run(bin, ['skills', 'get', 'core', '--full', '--json'], { cwd: directory, env: isolatedEnv })).stdout).content;
  assert.ok(full.startsWith(core));
  assert.ok(full.includes(await readFile(join(repository, 'docs/agents.md'), 'utf8')));
  const skills = JSON.parse((await run(bin, ['skills', 'list', '--json'], { cwd: directory, env: isolatedEnv })).stdout);
  assert.equal(skills[0].name, 'core');
  await assert.rejects(run(bin, ['skills', 'get', '../../package.json'], { cwd: directory, env: isolatedEnv }), /Unknown skill/);
  assert.match((await run(bin, ['--help'], { cwd: directory, env: isolatedEnv })).stdout, /Mobile Canvas/);
  assert.match((await run(join(prefix, 'bin/expo-canvas'), ['--help'], { cwd: directory, env: isolatedEnv })).stdout, /Mobile Canvas/);
  const nodeOnly = join(directory, 'node-only');
  await mkdir(nodeOnly); await symlink(process.execPath, join(nodeOnly, 'node'));
  const setupEnv = { ...isolatedEnv, PATH: nodeOnly };
  const fresh = await run(bin, ['setup', '--json'], { cwd: directory, env: setupEnv }).then(result => result.stdout, error => error.stdout);
  assert.equal(JSON.parse(fresh).checks.find((check: any) => check.id === 'signing-team').status, 'missing', 'A fresh installation must not inherit the maintainer signing team');
  const missing = await run(bin, ['setup', '--team', 'ABCDEFGHIJ'], { cwd: directory, env: setupEnv }).then(() => { throw new Error('Missing tools must fail setup'); }, error => error);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /Full Xcode is unavailable/);
  assert.match(missing.stdout, /CocoaPods is not available/);
  assert.equal(JSON.parse(await readFile(join(directory, 'settings/settings.json'), 'utf8')).team, 'ABCDEFGHIJ');

  const installed = join(prefix, 'lib/node_modules/mobile-canvas');
  for (const file of files) {
    const bytes = await readFile(join(installed, file));
    assert.ok(!bytes.includes(Buffer.from(repository)), `checkout path embedded in ${file}`);
    assert.ok(!/\/Users\/[^/\s]+|\/private\/var\/folders\//.test(bytes.toString('latin1')), `personal Mac path embedded in ${file}`);
  }
  assert.equal(await readFile(join(installed, 'apps/native-host/dependencies.lock'), 'utf8'), await readFile(join(repository, 'apps/native-host/package-lock.json'), 'utf8'), 'Packed host dependencies must match the canonical lock');
  const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.license, 'MIT');
  assert.notEqual(installedManifest.private, true);
  for (const dependency of ['tsx', 'typescript']) await readFile(join(installed, 'node_modules', dependency, 'package.json'));
  const app = join(directory, 'app'), project = join(directory, 'project');
  await mkdir(join(app, 'app'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'package-test', dependencies: { expo: '~56.0.0' } }));
  await writeFile(join(app, 'app/index.tsx'), 'export default function Home(){return null}');
  await writeFile(join(app, 'app/detail.tsx'), 'export default function Detail(){return null}');
  const rootSetup = await run(bin, ['setup', '--json'], { cwd: app, env: setupEnv }).then(result => result.stdout, error => error.stdout);
  assert.ok(JSON.parse(rootSetup).checks.some((check: any) => check.id === 'app-sdk'), 'setup must detect the current Expo root');
  await run(bin, ['init', '--project', project, '--name', 'Installed package test'], { cwd: directory, env: isolatedEnv });
  // MCP owns its temporary runtime, so closing this client leaves no detached process.
  await client.connect(new StdioClientTransport({ command: bin, args: ['mcp'], cwd: project, stderr: 'inherit', env: isolatedEnv }));
  assert.equal(client.getServerVersion()?.name, 'mobile-canvas');
  const list = await client.listTools();
  assert.ok(list.tools.some(tool => tool.name === 'canvas_environment'));
  const appTool = list.tools.find(tool => tool.name === 'canvas_view');
  const appUri = (appTool?._meta?.ui as { resourceUri?: string })?.resourceUri;
  assert.ok(appUri && appUri.startsWith('ui://'), 'The installed server must advertise the embedded review');
  const appResource = (await client.readResource({ uri: appUri })).contents[0];
  assert.equal(appResource.mimeType, 'text/html;profile=mcp-app');
  assert.ok('text' in appResource && appResource.text.includes('Mobile Canvas'));
  const appView: any = await client.callTool({ name: 'canvas_view', arguments: {} });
  assert.ok(!appView.isError, JSON.stringify(appView));
  assert.equal(appView.structuredContent.view.screens.length, 0);
  const skill: any = await client.callTool({ name: 'canvas_read_skill', arguments: {} });
  assert.ok(!skill.isError, JSON.stringify(skill));
  assert.equal(skill.content[0].text, core);
  const fullSkill: any = await client.callTool({ name: 'canvas_read_skill', arguments: { name: 'core', full: true } });
  assert.equal(fullSkill.content[0].text, full);
  const resources = await client.listResources();
  assert.ok(resources.resources.some(resource => resource.uri === skills[0].uri));
  const resource = await client.readResource({ uri: skills[0].uri });
  assert.ok('text' in resource.contents[0]);
  assert.equal(resource.contents[0].text, core);
  const badSkill = await client.callTool({ name: 'canvas_read_skill', arguments: { name: '../../package.json' } });
  assert.ok(badSkill.isError);
  const read: any = await client.callTool({ name: 'canvas_read', arguments: {} });
  const session = JSON.parse(read.content[0].text);
  assert.equal(session.project.sequence, 0, 'Reading skills must not mutate the project');
  const studio: any = await client.callTool({ name: 'canvas_studio_state', arguments: {} });
  assert.equal(JSON.parse(studio.content[0].text).hostId, null, 'Reading skills must not launch native code');
  const imported: any = await client.callTool({ name: 'canvas_import', arguments: { workspaceId: session.project.workspaceId, sequence: session.project.sequence, requestId: crypto.randomUUID(), from: app, link: true, map: true } });
  assert.ok(!imported.isError, JSON.stringify(imported));
  const result: any = await client.callTool({ name: 'canvas_route_map', arguments: {} });
  assert.ok(!result.isError, JSON.stringify(result));
  const sitemap = JSON.parse(result.content[0].text);
  assert.equal(sitemap.routes.length, 2);
  const environment: any = await client.callTool({ name: 'canvas_environment', arguments: {} });
  assert.ok(!environment.isError, JSON.stringify(environment));
  assert.ok(JSON.parse(environment.content[0].text).checks.some((check: any) => check.id === 'xcode'));
  const report = { tarball, files: files.length, compressedBytes: manifest.size, verified: ['production-only npm installation outside the checkout', 'bundled CLI, MCP tool and resource guidance agree; reading leaves the document and native host untouched', 'installed mobile-canvas --help', 'actual installed MCP handshake and tool list', 'installed MCP App resource, bundled HTML and text-only fallback', 'two-route mapping through the installed MCP server', 'Mac prerequisite report through MCP', 'installed setup explains missing tools and persists the team outside the package', 'setup detects the current Expo root and MCP detects the current Canvas root'], nativeBuild: 'not exercised by this package smoke test' };
  await writeFile(join(repository, '.context/distribution/package-test.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
