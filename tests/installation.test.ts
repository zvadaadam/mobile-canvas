import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyTemplate } from '../src/runtime/host/copy-template';
import { nativeAppPath } from '../src/runtime/installation';
import { quoteConstantsPaths, escapePrebuiltPaths } from '../src/runtime/host/build-scripts';
import { execFileSync } from 'node:child_process';
import { appDependencies } from '../src/runtime/adapters/expo/app-dependencies';

test('read-only installed templates produce editable copies and can be refreshed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-template-'));
  const source = join(root, 'source'), target = join(root, 'target');
  await mkdir(source);
  const file = join(source, 'index.tsx');
  await writeFile(file, 'source'); await chmod(file, 0o444); await chmod(source, 0o555);
  t.after(async () => { await chmod(source, 0o755); await rm(root, { recursive: true, force: true }); });
  await copyTemplate(source, target);
  await writeFile(join(target, 'index.tsx'), 'offline prelude\nsource');
  await copyTemplate(source, target);
  assert.equal(await readFile(join(target, 'index.tsx'), 'utf8'), 'source');
  assert.equal(await readFile(file, 'utf8'), 'source');
});

test('dependency setup only offers automatic installation with a supported frozen lockfile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-dependencies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, 'package.json');
  await writeFile(pkg, JSON.stringify({ dependencies: {} }));
  assert.equal((await appDependencies(root)).installArgs, null);
  await writeFile(join(root, 'package-lock.json'), '{}');
  assert.deepEqual((await appDependencies(root)).installArgs, ['npm', 'ci', '--no-audit', '--no-fund']);
  await writeFile(pkg, JSON.stringify({ packageManager: 'pnpm@10.0.0', dependencies: {} }));
  assert.equal((await appDependencies(root)).installArgs, null);
  await writeFile(pkg, JSON.stringify({ packageManager: 'bun@1.2.22', dependencies: {} }));
  await writeFile(join(root, 'bun.lockb'), 'binary lock');
  assert.deepEqual((await appDependencies(root)).installArgs, ['bun', 'install', '--frozen-lockfile']);
});

test('Constants build scripts quote paths and patching is idempotent', () => {
  const input = '    :script => "bash -l -c \"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"",\nPROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)';
  const patched = quoteConstantsPaths(input);
  assert.ok(patched.includes('bash -l "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"'));
  assert.ok(patched.includes('$(basename "$PROJECT_DIR")'));
  assert.equal(quoteConstantsPaths(patched), patched);
});

test('temporary build products launch from a stable user cache', () => {
  const output = join(tmpdir(), 'Canvas path with spaces', 'build');
  assert.ok(nativeAppPath(output).includes('/Library/Caches/Expo Canvas/renderers/'));
  assert.equal(nativeAppPath(output), nativeAppPath(output));
  assert.equal(nativeAppPath('/Users/test/projects/app/build'), '/Users/test/projects/app/build/Expo Canvas Native.app');
});

test('React Native prebuilt URLs round-trip paths with spaces and URI characters', () => {
  const expression = 'URI::File.build(path: destinationDebug).to_s';
  const patched = escapePrebuiltPaths(expression);
  assert.equal(escapePrebuiltPaths(patched), patched);
  const path = '/tmp/Canvas project #1/100%/react-native.tar.gz';
  const result = execFileSync('ruby', ['-ruri', '-e',
    `destinationDebug = ARGV[0]; puts URI::DEFAULT_PARSER.unescape(URI.parse(${patched}).path)`, path], { encoding: 'utf8' });
  assert.equal(result.trim(), path);
});

test('current-root detection prefers Canvas and does not execute Expo configuration', async t => {
  const { projectContext } = await import('../src/runtime/project-context');
  const root = await mkdtemp(join(tmpdir(), 'canvas-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await projectContext(root), {});
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { expo: '~56.0.0' } }));
  await writeFile(join(root, 'app.config.js'), 'throw new Error("must not execute")');
  assert.deepEqual(await projectContext(root), { app: root });
  await mkdir(join(root, 'child'));
  assert.deepEqual(await projectContext(join(root, 'child')), {});
  await writeFile(join(root, 'expo-canvas.json'), '{}');
  assert.deepEqual(await projectContext(root), { project: root });
});

test('signing discovery uses the certificate team, only for a valid development identity', async t => {
  const { X509Certificate } = await import('node:crypto');
  const { developmentTeams } = await import('../src/runtime/signing');
  const root = await mkdtemp(join(tmpdir(), 'canvas-signing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=Apple Development: Example (PERSON1234)/OU=ABCDEFGHIJ',
    '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], { stdio: 'ignore' });
  const pem = await readFile(join(root, 'cert.pem'), 'utf8');
  const hash = new X509Certificate(pem).fingerprint.replaceAll(':', '');
  const identity = `1) ${hash} "Apple Development: Example (PERSON1234)"`;
  assert.deepEqual(developmentTeams(identity, pem + pem), ['ABCDEFGHIJ']);
  assert.deepEqual(developmentTeams('', pem), []);
  assert.deepEqual(developmentTeams(identity.replace('Apple Development', 'Apple Distribution'), pem), []);
  assert.deepEqual(developmentTeams(identity.replace(hash, '0'.repeat(40)), pem), []);
});
