import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import type { spawn } from "node:child_process";
import { ProjectStore } from "../src/runtime/project";
import { NativeStudio } from "../src/runtime/studio";
import { identityOf, CommandSchema } from "../src/shared/model";
import { discoverRuntime } from "../src/runtime/server";

// Exercise the real session/command boundary without launching a native app in a unit test.
test("native studio isolates host identity, screen readiness and acknowledged frame commands", { skip: process.platform !== "darwin" || process.arch !== "arm64" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-studio-"));
  const store = await ProjectStore.initialize(directory, "Studio test");
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const launches: unknown[][] = [];
  const launch = ((...args: unknown[]) => { launches.push(args); return child; }) as unknown as typeof spawn;
  const studio = new NativeStudio(store, launch);
  t.after(async () => { await studio.stop(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const created = await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: "setup", label: "Create fixtures", operations: ["one", "two"].map((key) => ({ type: "screen.create", screen: { key, name: key, code: 'import {Text} from "react-native"; export default function Screen(){return <Text>Native</Text>}' } })) }));
  const identity = identityOf(store.session());
  const opened = studio.start(identity, "http://127.0.0.1:12345");
  assert.equal(opened.phase, "starting");
  assert.equal(launches.length, 1);
  const common = { workspaceId: identity.workspaceId, hostId: opened.hostId!, acknowledged: 0, error: null };
  const host = { ...common, kind: "host", pid: 12345, screenIds: Object.values(created.created), width: 1200, height: 1000, zoom: 1, platform: "ios-on-mac" };
  assert.throws(() => studio.report({ ...host, hostId: crypto.randomUUID() }), /does not belong/);
  assert.throws(() => studio.report({ ...host, workspaceId: crypto.randomUUID() }), /does not belong/);
  studio.report(host);
  assert.equal(studio.state().connected, true);
  assert.equal(studio.state().ready, false, "a connected window alone is not a rendered design");
  const screen = (id: string) => ({ ...common, kind: "screen", screenId: id, codeVersion: store.session().codeVersion, mountedAt: Date.now(), navigation: null, state: { count: 3 } });
  studio.report(screen(created.created.one));
  studio.report({ ...screen(created.created.two), codeVersion: "old" });
  assert.equal(studio.state().readyCount, 1);
  const navigated = studio.report({ ...screen(created.created.one), navigation: "two" });
  assert.equal(navigated.command, null, "a screen report never receives host commands");
  const focus = studio.report(host).command;
  assert.equal(focus?.type, "focus");
  assert.equal(focus?.screenId, created.created.two);
  assert.equal(focus?.from, created.created.one, "the host learns which frame navigated so it can pulse that edge");
  studio.report({ ...host, acknowledged: focus!.id });
  studio.report({ ...screen(created.created.two), console: ["warn: Expo Canvas: something to look at"] });
  assert.deepEqual(studio.state().console, ["warn: Expo Canvas: something to look at"], "runtime console output is reported once");
  studio.report(screen(created.created.two));
  assert.equal(studio.state().ready, true);
  const reset = studio.control({ ...identity, hostId: opened.hostId, action: { type: "reset", screenId: created.created.one } });
  assert.equal(studio.report(host).command, null);
  assert.equal(studio.report(screen(created.created.two)).command, null);
  assert.equal(studio.report(screen(created.created.one)).command?.id, reset.command.id);
  assert.equal(studio.report({ ...screen(created.created.one), acknowledged: reset.command.id }).command, null);
  studio.report({ ...screen(created.created.two), error: "Fixture failed" });
  assert.equal(studio.state().phase, "degraded");
  assert.equal(studio.state().ready, false);
  assert.equal(studio.state().error, null, "one frame error does not become a host error");
  assert.equal(studio.state().screenErrorCount, 1);
  studio.report(screen(created.created.two));
  const now = Date.now();
  const clock = t.mock.method(Date, "now", () => now + 4000);
  assert.equal(studio.state().phase, "paused");
  assert.equal(studio.state().readyCount, 0);
  studio.start(identity, "http://127.0.0.1:12345");
  assert.equal(launches[1][0], "open", "reopening foregrounds the existing session");
  clock.mock.restore();
  await store.execute({ ...identity, requestId: "rename", label: "Rename", operations: [{ type: "project.rename", name: "Changed" }] });
  assert.throws(() => studio.control({ ...identity, hostId: opened.hostId, action: { type: "fit" } }), /canvas changed/);
  await studio.stop();
  assert.equal(studio.state().hostId, null);
  assert.equal(studio.state().phase, "stopped");
  assert.throws(() => studio.report(host), /does not belong/);
});

test("an unresponsive live runtime produces a useful error without starting a duplicate", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-unresponsive-"));
  const store = await ProjectStore.initialize(directory, "Runtime");
  const workspaceId = store.session().project.workspaceId;
  await store.close();
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const address = server.address() as { port: number };
  await writeFile(join(directory, ".expo-canvas/runtime.json"), JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${address.port}`, workspaceId }));
  await assert.rejects(discoverRuntime(directory), (error: any) => error.code === "runtime_unresponsive" && /No second runtime/.test(error.message));
});

test("a resolver change after the canvas opened is reported until the canvas is reopened", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-studio-resolver-"));
  const store = await ProjectStore.initialize(directory, "Resolver notice");
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const studio = new NativeStudio(store, ((..._args: unknown[]) => child) as unknown as typeof spawn);
  t.after(async () => { await studio.stop(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  studio.start(identityOf(store.session()), "http://127.0.0.1:12345");
  assert.equal(studio.state().resolverCurrent, true);
  assert.equal(studio.state().notice, null);
  await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: "shim", label: "Map a shim", operations: [
    { type: "source.write", path: "lib/shims/expo-router.tsx", expectedHash: null, code: "export const router = {};\n" },
    { type: "resolver.update", modules: { "expo-router": "lib/shims/expo-router.tsx" } },
  ] }));
  assert.equal(studio.state().resolverCurrent, false);
  assert.match(studio.state().notice ?? "", /reopen/i);
  await studio.stop();
  studio.start(identityOf(store.session()), "http://127.0.0.1:12345");
  assert.equal(studio.state().resolverCurrent, true, "a reopened canvas reads the current resolver");
});

test("a capture is rendered by the host itself and delivered through the runtime", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-studio-snapshot-"));
  const store = await ProjectStore.initialize(directory, "Snapshot");
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const studio = new NativeStudio(store, ((..._args: unknown[]) => child) as unknown as typeof spawn);
  t.after(async () => { await studio.stop(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const identity = identityOf(store.session());
  const opened = studio.start(identity, "http://127.0.0.1:12345");
  const host = { workspaceId: identity.workspaceId, hostId: opened.hostId!, acknowledged: 0, error: null, kind: "host", pid: 12345, screenIds: [], width: 1200, height: 1000, zoom: 1, platform: "ios-on-mac" };
  studio.report(host);
  // A 1×1 PNG; the host would post its rendered window the same way.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const capture = studio.capture({ ...identity, hostId: opened.hostId! });
  let command: { id: number; type: string } | null = null;
  for (let attempt = 0; attempt < 50 && !command; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    command = studio.report(host).command;
  }
  assert.equal(command?.type, "capture");
  assert.throws(() => studio.snapshot({ workspaceId: identity.workspaceId, hostId: crypto.randomUUID(), id: command!.id, png }), /does not belong/);
  studio.snapshot({ workspaceId: identity.workspaceId, hostId: opened.hostId!, id: command!.id, png });
  studio.report({ ...host, acknowledged: command!.id });
  const result = await capture;
  assert.equal(result.method, "host");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(Buffer.from(result.data, "base64").length, Buffer.from(png, "base64").length);
});

test("zoom is a host command that may reveal one screen", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "expo-studio-zoom-"));
  const store = await ProjectStore.initialize(directory, "Zoom");
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  const studio = new NativeStudio(store, ((..._args: unknown[]) => child) as unknown as typeof spawn);
  t.after(async () => { await studio.stop(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const created = await store.execute(CommandSchema.parse({ ...identityOf(store.session()), requestId: "one", label: "Create", operations: [{ type: "screen.create", screen: { key: "one", name: "One", code: 'import {Text} from "react-native"; export default function Screen(){return <Text>One</Text>}' } }] }));
  const identity = identityOf(store.session());
  const opened = studio.start(identity, "http://127.0.0.1:12345");
  const host = { workspaceId: identity.workspaceId, hostId: opened.hostId!, acknowledged: 0, error: null, kind: "host", pid: 12345, screenIds: [created.created.one], width: 1200, height: 1000, zoom: 1, platform: "ios-on-mac" };
  studio.report(host);
  const accepted = studio.control({ ...identity, hostId: opened.hostId, action: { type: "zoom", scale: 1, screenId: created.created.one } });
  assert.equal(accepted.command.type, "zoom");
  assert.deepEqual(studio.report(host).command, accepted.command, "the host receives the zoom with its scale and screen");
  assert.throws(() => studio.control({ ...identity, hostId: opened.hostId, action: { type: "zoom", scale: 1, screenId: "screen-missing" } }), /existing screen/);
  assert.throws(() => studio.control({ ...identity, hostId: opened.hostId, action: { type: "zoom", scale: 9 } }));
});

test('rendered route examples fill missing params in one undoable transaction and respect undo', async (t) => {
  const { mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'expo-studio-examples-'));
  const app = join(directory,'app');
  await mkdir(join(app,'app/detail'),{recursive:true});
  await mkdir(join(app,'node_modules/expo'),{recursive:true});
  await writeFile(join(app,'package.json'),JSON.stringify({name:'examples',dependencies:{expo:'56.0.0'}}));
  await writeFile(join(app,'node_modules/expo/package.json'),JSON.stringify({version:'56.0.0'}));
  await writeFile(join(app,'app/index.tsx'),'export default () => null;');
  await writeFile(join(app,'app/detail/[id].tsx'),'export default () => null;');
  const store = await ProjectStore.initialize(join(directory,'canvas'),'Examples');
  await store.importSources({...identityOf(store.session()),requestId:'import',from:app,link:true,map:true,preview:true});
  const child = Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  const studio = new NativeStudio(store,(()=>child) as unknown as typeof spawn);
  t.after(async()=>{await studio.stop();await store.close();await rm(directory,{recursive:true,force:true});});
  const detail=Object.values(store.session().project.document.screens).find(s=>s.key==='detail')!;
  const home=Object.values(store.session().project.document.screens).find(s=>s.key==='index')!;
  const opened=studio.start(identityOf(store.session()),'http://127.0.0.1:12345');
  const report=()=>({workspaceId:store.session().project.workspaceId,hostId:opened.hostId,kind:'screen',screenId:home.id,codeVersion:store.session().codeVersion,mountedAt:Date.now(),acknowledged:0,error:null,navigation:null,state:{previewKind:'linked-app',routeDestinations:[{href:'/detail/42',file:'app/index.tsx'}]}});
  studio.report({...report(),codeVersion:'stale'});
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.deepEqual(store.session().project.document.screens[detail.id].props.params,{});
  studio.report(report());
  for(let n=0;n<40&&!(store.session().project.document.screens[detail.id].props.params as any)?.id;n++) await new Promise(resolve=>setTimeout(resolve,50));
  const updated=store.session().project.document.screens[detail.id];
  assert.deepEqual(updated.props.params,{id:'42'});
  assert.deepEqual(updated.props.routeExample,{href:'/detail/42',from:'index',file:'app/index.tsx'});
  assert.equal(updated.notes,detail.notes); assert.deepEqual(updated.links,detail.links);
  await store.history('undo',identityOf(store.session()));
  studio.report(report());
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.deepEqual(store.session().project.document.screens[detail.id].props.params,{},'undo is not immediately overwritten by discovery');
});

test('screen inspection fits the requested frame, waits for settling, returns metadata and clears presence', async t => {
  const directory=await mkdtemp(join(tmpdir(),'expo-inspect-'));
  const store=await ProjectStore.initialize(directory,'Inspection');
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  const launches: unknown[][] = [];
  const studio=new NativeStudio(store,((...args: unknown[])=>{
    launches.push(args);
    if(args[0]==='open') { const activation=new EventEmitter();queueMicrotask(()=>activation.emit('close',0));return activation; }
    return child;
  }) as unknown as typeof spawn);
  t.after(async()=>{await studio.stop();await store.close();await rm(directory,{recursive:true,force:true});});
  const created=await store.execute(CommandSchema.parse({...identityOf(store.session()),requestId:'screen',label:'Setup',operations:[{type:'screen.create',screen:{key:'one',name:'One',notes:'A real control',code:'export default () => null;'}}]}));
  const screenId=created.created.one;
  const identity=identityOf(store.session());
  const opened=studio.start(identity,'http://127.0.0.1:12345');
  const common={workspaceId:identity.workspaceId,hostId:opened.hostId!,acknowledged:0,error:null};
  const host={...common,kind:'host',pid:12345,screenIds:[screenId],width:1200,height:1000,zoom:1,platform:'ios-on-mac',screenCapture:true,settled:false,focusedScreenId:null as string|null};
  studio.report(host);
  studio.report({...common,kind:'screen',screenId,codeVersion:store.session().codeVersion,mountedAt:Date.now(),navigation:null,state:{toggle:true}});
  const request={...identity,hostId:opened.hostId!,screenId};
  const inspection=studio.inspect(request);
  assert.equal(launches.at(-1)?.[0],'open','inspection activates the native canvas before capturing');
  assert.equal((launches.at(-1)?.[1] as string[])[0],'-a');
  assert.equal(studio.state().inspection?.status,'capturing');
  await assert.rejects(studio.inspect(request),/already in progress/);
  await assert.rejects(studio.capture({...identity,hostId:opened.hostId!}),/already in progress/);
  const focus=studio.report(host).command!;
  assert.equal(focus.type,'focus');assert.equal(focus.screenId,screenId);
  studio.report({...host,acknowledged:focus.id,focusedScreenId:screenId});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(studio.report({...host,acknowledged:focus.id,focusedScreenId:screenId}).command,null,'capture waits for viewport motion to finish');
  const settled={...host,acknowledged:focus.id,focusedScreenId:screenId,settled:true};
  studio.report(settled);
  studio.report({...common,kind:'screen',screenId,codeVersion:store.session().codeVersion,mountedAt:Date.now(),navigation:null,state:{toggle:true}});
  let capture:any;
  for(let i=0;i<40&&!capture;i++){await new Promise(resolve=>setTimeout(resolve,25));capture=studio.report(settled).command;}
  assert.equal(capture?.type,'capture');assert.equal(capture?.screenId,screenId);
  studio.snapshot({workspaceId:identity.workspaceId,hostId:opened.hostId!,id:capture.id,png:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='});
  const result=await inspection;
  assert.equal(result.scope,'screen');assert.equal(result.screen.id,screenId);assert.equal(result.screen.notes,'A real control');assert.deepEqual(result.state,{toggle:true});
  assert.equal(studio.state().inspection?.status,'captured');
  const now=Date.now();t.mock.method(Date,'now',()=>now+2000);
  assert.equal(studio.state().inspection,null);
  assert.deepEqual(identityOf(store.session()),identity,'inspection never edits the document');
});

test('inspection refuses old hosts and clears its presence when human focus interrupts it', async t => {
  const directory=await mkdtemp(join(tmpdir(),'expo-inspect-interrupt-'));
  const store=await ProjectStore.initialize(directory,'Inspection');
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  const studio=new NativeStudio(store,((command:string)=>{
    if(command==='open') { const activation=new EventEmitter();queueMicrotask(()=>activation.emit('close',0));return activation; }
    return child;
  }) as unknown as typeof spawn);
  t.after(async()=>{await studio.stop();await store.close();await rm(directory,{recursive:true,force:true});});
  const created=await store.execute(CommandSchema.parse({...identityOf(store.session()),requestId:'screen',label:'Setup',operations:[{type:'screen.create',screen:{key:'one',name:'One',code:'export default () => null;'}}]}));
  const identity=identityOf(store.session()),opened=studio.start(identity,'http://127.0.0.1:12345');
  const host={workspaceId:identity.workspaceId,hostId:opened.hostId!,acknowledged:0,error:null,kind:'host',pid:12345,screenIds:[created.created.one],width:1200,height:1000,zoom:1,platform:'ios-on-mac'};
  studio.report(host);
  const request={...identity,hostId:opened.hostId!,screenId:created.created.one};
  await assert.rejects(studio.inspect(request),/Rebuild and reopen/);
  studio.report({...host,screenCapture:true});
  const inspection=studio.inspect(request);
  const rejected=assert.rejects(inspection,/Focus moved/);
  const focus=studio.report({...host,screenCapture:true}).command!;
  studio.report({...host,screenCapture:true,acknowledged:focus.id,focusedScreenId:null,settled:true});
  await rejected;
  assert.equal(studio.state().inspection,null);
});
