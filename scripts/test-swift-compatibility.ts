import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {loadSwiftProject} from '../src/runtime/adapters/swift/project';
import {importSwift} from '../src/runtime/adapters/swift/import';
import {ProjectStore} from '../src/runtime/project';
import {identityOf} from '../src/shared/model';
import apps from '../tests/compatibility/swift-apps.json';

const run = promisify(execFile);
const output = resolve('.context/compatibility/swift');
await mkdir(output, {recursive:true});
for (const app of apps) {
  const checkout = process.env[app.checkoutEnv];
  assert.ok(checkout, `Set ${app.checkoutEnv} to an existing checkout of the private ${app.id} reference. Public Swift fixtures run in npm test.`);
  const local = resolve(checkout);
  // Private local references are opt-in. Never fetch, checkout, or edit them.
  assert.equal((await run('git',['-C',local,'rev-parse','HEAD'])).stdout.trim(),app.revision,'Use the pinned Swift checkout');
  assert.equal((await run('git',['-C',local,'status','--porcelain','--untracked-files=no'])).stdout.trim(),'','The pinned Swift checkout has source changes');
  const directory=await mkdtemp(join(output,app.id+'-'));
  let store: ProjectStore | undefined;
  try {
    const spec=await loadSwiftProject(local);
    assert.equal(spec.files.length,app.sourceFiles);
    assert.equal(!spec.buildIssues?.length,app.liveAppPreview);
    assert.equal(spec.buildStrategy,app.buildStrategy);
    store=await ProjectStore.initialize(directory,app.id,{app:local,spec});
    const map=()=>importSwift(store!,{...identityOf(store!.session()),requestId:crypto.randomUUID(),from:local,link:true,map:true});
    const first=await map(), before=store.session();
    const flow=first.import.routeMap;
    assert.equal(flow.nodes.length,app.destinations);
    assert.equal(flow.edges.length,app.links);
    assert.equal(Object.keys(flow.previews).length,app.sourcePreviews);
    const names=new Map(flow.nodes.map(node=>[node.id,node.name]));
    for (const [from,to] of app.requiredLinks) assert.ok(flow.edges.some(edge=>names.get(edge.from)===from && names.get(edge.to)===to),`${from} → ${to}`);
    const screens=Object.values(before.project.document.screens);
    assert.equal(screens.length,app.frames);
    assert.equal(screens.filter(s=>(s.props.native as any).scene).length,app.sceneFrames);
    assert.equal(screens.filter(s=>(s.props.native as any).factory).length,app.previewCandidates);
    assert.equal(screens.filter(s=>(s.props.native as any).blocker?.kind==='app-startup').length,app.needsAppStartup);
    for (const screen of screens) {
      const native=screen.props.native as any;
      if(native.blocker) assert.equal(native.factory,null,'A blocked screen cannot advertise an executable factory');
    }
    await map();
    assert.deepEqual(store.session().project,before.project,'Repeated mapping must preserve IDs, notes, geometry and sequence');
    await importSwift(store,{...identityOf(store.session()),requestId:crypto.randomUUID(),from:local,link:true,map:true,swiftContext:'application'});
    const application=store.session();
    const applicationScreens=Object.values(application.project.document.screens);
    assert.equal(applicationScreens.filter(s=>(s.props.native as any).factory).length,app.applicationPreviewCandidates);
    assert.deepEqual(applicationScreens.filter(s=>(s.props.native as any).previewProviders.length).map(s=>s.key).sort(),app.repairedProviderScreens);
    assert.equal(applicationScreens.filter(s=>(s.props.native as any).blocker?.kind==='app-startup').length,0);
    await map();
    assert.deepEqual(store.session().project,application.project,'Context must survive implicit re-import');
    const report={app:app.id,revision:app.revision,destinations:flow.nodes.length,links:flow.edges.length,
      buildIssues:spec.buildIssues,unmappedPreviewDeclarations:first.import.unmappedPreviews.length,
      unresolved:flow.unresolved,liveAppPreview:app.liveAppPreview,applicationPreviewCandidates:app.applicationPreviewCandidates};
    await writeFile(join(output,app.id+'.json'),JSON.stringify(report,null,2));
    console.log(`${app.id}: ${flow.nodes.length} destinations, ${flow.edges.length} links, stable re-import; ${app.previewCandidates} preview candidates (rendering requires native verification)`);
  } finally { await store?.close();await rm(directory,{recursive:true,force:true}); }
}
