import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ProjectStore } from '../src/runtime/project';
import { identityOf } from '../src/shared/model';
import { sharedFontLoader } from '../src/runtime/host/fonts';
import { disconnectedSpeechStart } from '../apps/linked-host/design/speech-adapter';
import { NativeStudio } from '../src/runtime/studio';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

async function adapter(name: string, globals: Record<string, unknown> = {}) {
  const exports = {} as any;
  const source = await readFile(join('apps/linked-host', name), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => { throw new Error(`Unexpected module: ${name}`); }, ...globals });
  return exports;
}

test('shared native font adaptation rejects unknown loaders and never unregisters fonts used by other roots', () => {
  const source = `import ExpoModulesCore
      let fontUrl = localUri as CFURL
      try unregisterFont(url: fontUrl)
      // Register the font
      try registerFont(fontUrl: fontUrl, fontFamilyAlias: fontFamilyAlias)
      FontFamilyAliasManager.setAlias(fontFamilyAlias, forFont: postScriptName)`;
  const patched = sharedFontLoader(source);
  assert.doesNotMatch(patched, /unregisterFont/);
  assert.match(patched, /canvasFontLock.lock\(\)/);
  assert.match(patched, /existing.0 == bytes/);
  assert.equal(sharedFontLoader(patched), patched);
  assert.throws(() => sharedFontLoader('an incompatible future loader'), /not supported/);
});

test('design service adapters settle authentication without credentials and never report successful remote writes or purchases', async () => {
  const clerk = await adapter('design/Clerk.tsx');
  assert.equal(clerk.useAuth().isLoaded, true);
  assert.equal(clerk.useAuth().isSignedIn, false);
  assert.equal(await clerk.useAuth().getToken(), null);
  assert.equal(clerk.ClerkProvider({ children: 'real screen' }), 'real screen');
  await assert.rejects(clerk.useSignInWithApple().startAppleAuthenticationFlow(), /disconnected/);
  const convex = await adapter('design/Convex.tsx');
  const client = new convex.ConvexReactClient('');
  assert.equal(convex.useConvexAuth().isAuthenticated, false);
  assert.equal(convex.useQuery(), undefined);
  await assert.rejects(client.mutation(), /disconnected/);
  const purchases = await adapter('design/Purchases.ts');
  assert.equal(Object.keys((await purchases.default.getCustomerInfo()).entitlements.active).length, 0);
  assert.equal((await purchases.default.getOfferings()).current, null);
  await assert.rejects(purchases.default.purchasePackage({}), /disconnected/);
  await assert.rejects(purchases.default.restorePurchases(), /disconnected/);
  const events: string[] = [];
  const speech = await adapter('design/Speech.ts', { require: (name: string) => name === './speech-adapter' ? { disconnectedSpeechStart } : ({ ExpoSpeechRecognitionModule: {
    emit: (event: string) => events.push(event),
    requestPermissionsAsync: () => { throw new Error('Native permission request must not run'); },
    start: () => { throw new Error('Native recording must not run'); },
  } }) });
  assert.equal((await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted, false);
  assert.doesNotThrow(() => speech.ExpoSpeechRecognitionModule.start());
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(events, ['error', 'end']);
});

test('design requests keep canvas loopback working and MMKV names remain isolated per frame', async () => {
  const requests: string[] = [];
  class XHR { open(_method: string, url: string) { requests.push(url); } }
  const globals = { fetch: async (input: string) => { requests.push(input); return 'local response'; } } as any;
  await adapter('design/Network.ts', { globalThis: globals, URL, XMLHttpRequest: XHR });
  assert.equal(await globals.fetch('http://127.0.0.1:4182/api/studio/report'), 'local response');
  await assert.rejects(globals.fetch('https://example.com/api'), /disconnected/);
  assert.throws(() => new XHR().open('POST', 'https://example.com/api'), /disconnected/);
  assert.equal(requests.length, 1);
  const ids: string[] = [];
  const frame = { id: 'one' };
  const mmkv = await adapter('MMKV.ts', { globalThis: { __EXPO_CANVAS_FRAME__: frame }, require: () => ({ createMMKV: (config: any) => { ids.push(config.id); return config; }, existsMMKV: (id: string) => id }) });
  mmkv.createMMKV({ id: 'app' }); frame.id = 'two'; mmkv.createMMKV({ id: 'app' });
  assert.notEqual(ids[0], ids[1]);
  assert.equal(mmkv.existsMMKV('app'), ids[1]);
});

test('changing the design environment preserves route identity, changes freshness and is undoable without app source edits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-design-environment-'));
  const app = join(root, 'app'), project = join(root, 'project');
  await mkdir(join(app, 'app'), { recursive: true });
  await mkdir(join(app, 'node_modules/expo'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'Design app', dependencies: { expo: '~57.0.0' } }));
  await writeFile(join(app, 'node_modules/expo/package.json'), JSON.stringify({ version: '57.0.0' }));
  const source = 'export default function Screen() { return null; }';
  await writeFile(join(app, 'app/index.tsx'), source);
  const store = await ProjectStore.initialize(project, 'Design');
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  await store.importSources({ ...identityOf(store.session()), requestId: 'app', from: app, link: true, map: true, preview: true });
  const before = store.session();
  await store.importSources({ ...identityOf(before), requestId: 'design', from: app, link: true, map: true, preview: true, offline: true });
  const after = store.session();
  assert.equal(after.project.document.appPreview?.offline, true);
  assert.deepEqual(after.project.document.screenIds, before.project.document.screenIds);
  assert.notEqual(after.codeVersion, before.codeVersion);
  assert.equal(await readFile(join(app, 'app/index.tsx'), 'utf8'), source);
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const studio = new NativeStudio(store, (() => child) as any);
  const opened = studio.start(identityOf(after), 'http://127.0.0.1:12345');
  const id = after.project.document.screenIds[0];
  const common = { workspaceId: after.project.workspaceId, hostId: opened.hostId, acknowledged: 0, error: null };
  const host = { ...common, kind: 'host', pid: process.pid, screenIds: [id], width: 1200, height: 900, zoom: 1, platform: 'ios-on-mac', focusedScreenId: null };
  const report = { ...common, kind: 'screen', screenId: id, codeVersion: after.codeVersion, mountedAt: Date.now(), state: {}, navigation: after.project.document.screens[id].key };
  studio.report(host);
  studio.report(report);
  assert.equal(studio.report(host).command, null, 'background mount redirects must not move the camera');
  studio.report({ ...host, focusedScreenId: id });
  studio.report(report);
  assert.equal(studio.report({ ...host, focusedScreenId: id }).command?.type, 'focus', 'navigation in the selected frame still works');
  await studio.stop();
  await store.history('undo', identityOf(after));
  assert.deepEqual(store.session().project.document, before.project.document);
});

test('design icon substitution preserves local bindings and avoids loading the whole icon library', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const babel = require('../apps/native-host/node_modules/@babel/core');
  const transform = require('../apps/linked-host/preview-routes.cjs');
  const source = 'import { Mic01Icon as Mic, StarIcon } from "@hugeicons-pro/core-solid-rounded"; export const icons = [Mic, StarIcon];';
  const run = (design: boolean) => babel.transformSync(source, { filename: '/app/icons.ts', configFile: false, babelrc: false, plugins: [[transform, { app: '/app', design }]] }).code;
  const preview = run(true);
  assert.match(preview, /import Mic from "@hugeicons\/core-free-icons\/Mic01Icon"/);
  assert.match(preview, /import StarIcon from "@hugeicons\/core-free-icons\/StarIcon"/);
  assert.match(run(false), /@hugeicons-pro\/core-solid-rounded/);
});
