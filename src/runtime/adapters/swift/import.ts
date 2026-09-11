import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { scanSwift } from './scan';
import { loadSwiftProject } from './project';
import { swiftRecipes } from './recipes';
import { swiftPreviewBlocker } from './coverage';
import {swiftStartupRequirements} from './state';
import {swiftPreviewProviders} from './providers';
import {swiftScenes, type SwiftScene} from './scenes';
import {swiftPreviewCatalog,swiftImageAssets} from './catalog';
import { buildSwiftFlow, type SwiftFlowNode } from './flow';
import { projectPath } from '../../paths';
import { arrangeByFlow } from '../../arrange';
import type { ProjectStore } from '../../project';
import { ImportSchema } from '../../../shared/import';
import { identityOf, ScreenSchema, type Operation, type Screen } from '../../../shared/model';

export async function importSwift(store: ProjectStore, value: unknown) {
  const request = ImportSchema.parse(value);
  return store.runRequest(request, () => importSwiftRequest(store, request));
}

async function importSwiftRequest(store: ProjectStore, request: ReturnType<typeof ImportSchema.parse>) {
  store.assertIdentity(request);
  const session = store.session();
  const { nativePreview, origin } = session.project.document;
  if (!nativePreview || !origin || request.from !== origin.path) throw new Error('The Swift project must match its original source root.');
  const projectHash = nativePreview.projectFile ? createHash('sha256').update(await readFile(await projectPath(origin.path, nativePreview.projectFile))).digest('hex') : null;
  const currentInputs = nativePreview.projectFile ? {...await loadSwiftProject(origin.path), overrides: nativePreview.overrides, ...(nativePreview.context ? {context:nativePreview.context} : {})} : nativePreview;
  const context=request.swiftContext ?? nativePreview.context ?? 'isolated';
  if(request.offline && context==='application') throw new Error('Application context starts real services and cannot be used as an offline preview.');
  const buildIssues = currentInputs.buildIssues ?? [];
  const scans = await scanSwift(await Promise.all(currentInputs.files.map(async path => {
    const override = nativePreview.overrides[path];
    const source = await projectPath(override ? session.directory : origin.path, override ?? path);
    return {path, code: await readFile(source, 'utf8')};
  })));
  const flow = buildSwiftFlow(scans);
  const recipes = swiftRecipes(scans);
  const scenes = swiftScenes(scans);
  const startupRequirements=swiftStartupRequirements(scans);
  const providerPlans=swiftPreviewProviders(scans);
  const entries = swiftPreviewCatalog(scans);
  const imageAssets = await swiftImageAssets(origin.path,currentInputs.resources);
  const selectedPreviews = new Set(Object.values(session.project.document.screens).filter(s=>(s.props.native as any)?.kind==='component').map(s=>(s.props.native as any).previewId));
  for(const choice of request.swiftPreviews ?? []) {
    const exact=entries.filter(entry=>entry.factory===choice || entry.label===choice);
    const matches=exact.length?exact:entries.filter(entry=>entry.file===choice);
    if(matches.length!==1) throw new Error(`Preview ${choice} ${matches.length?'is ambiguous; choose its factory ID':'was not found in the app preview catalog'}.`);
    selectedPreviews.add(matches[0].factory);
  }
  type Entry = typeof entries[number];
  type Plan = {identity: string; name: string; node?: SwiftFlowNode; entry?: Entry; existing?: Screen; key: string; scene?:SwiftScene};
  const plans: Plan[] = [];
  const assigned = new Set<string>();
  const existingScreens = Object.values(session.project.document.screens);
  const used = new Set(existingScreens.map(screen => screen.key));
  function plan(identity: string, name: string, node?: SwiftFlowNode, entry?: Entry, scene?:SwiftScene) {
    const existing = existingScreens.find(screen => {
      const native = screen.props.native as any;
      return native?.identity === identity || (!native?.identity && entry && native?.factory === entry.factory);
    });
    let key = existing?.key ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'preview');
    if (!/^[a-z]/.test(key)) key = 'preview-' + key;
    if (!existing && used.has(key)) key += '-' + createHash('sha256').update(identity).digest('hex').slice(0, 8);
    used.add(key);
    if (entry) assigned.add(entry.factory);
    plans.push({identity, name, node, entry, existing, key, scene});
  }
  for (const node of flow.nodes) {
    const own = entries.find(entry => !entry.issue && flow.previews[entry.factory]?.length === 1 && flow.previews[entry.factory][0] === node.id);
    const contexts = scenes.filter(scene=>scene.target===node.id);
    const scene = contexts[0];
    if(own && scene) assigned.add(own.factory);
    const entry = scene ? entries.find(entry=>entry.factory===scene.factory) : own;
    const name=scene ? `${scene.owner.replace(/(?:Container)?View$/, '')} · ${scene.value.slice(1).replace(/([a-z])([A-Z])/g,'$1 $2')}` : node.name;
    plan(`swift:${node.id}`, name, node, entry, scene);
    for(const variant of contexts.slice(1)) {
      const name=`${variant.owner.replace(/(?:Container)?View$/, '')} · ${variant.value.slice(1).replace(/([a-z])([A-Z])/g,'$1 $2')}`;
      plan(`swift:${node.id}:scene:${variant.id}:${variant.value}`,name,node,entries.find(entry=>entry.factory===variant.factory),variant);
    }
  }
  const unassignedPreviews = entries.filter(entry => !assigned.has(entry.factory));
  // Without a build integration, show the navigation catalog rather than a
  // duplicate unavailable card for every component-preview variation.
  for (const entry of unassignedPreviews.filter(entry=>selectedPreviews.has(entry.factory) || (!(buildIssues.length || currentInputs.buildStrategy === 'xcode') || !flow.nodes.length))) {
    const duplicate = entries.filter(e => e.file === entry.file && e.name === entry.name).length > 1;
    const identity = `${entry.file}:${entry.name}${duplicate ? `:${entry.index}` : ''}`;
    const name = (entry.label + (selectedPreviews.has(entry.factory) ? ' · Component' : '')).slice(0,100);
    plan(identity, name, undefined, entry);
  }
  if (!plans.length) throw new Error('No SwiftUI screen destinations or #Preview entries found in this target.');
  const keyForScene = new Map(plans.filter(p=>p.scene).map(p=>[p.scene!.id+':'+p.scene!.value,p.key]));
  const document = structuredClone(session.project.document);
  const operations: Operation[] = [];
  // Only obsolete, untouched generated frames are removed. Their app previews
  // remain in the source inventory, and the transaction preserves undo.
  if(currentInputs.buildStrategy==='xcode') for(const screen of existingScreens) {
    const old=screen.props.native as any;
    if(!old?.identity?.startsWith('swift:') || plans.some(p=>p.identity===old.identity)) continue;
    const note=`Swift ${old.kind}: ${old.file}${old.symbol ? `:${old.line} (${old.symbol})` : ''}. ${old.issue ?? old.recipe?.provenance ?? 'Existing #Preview factory; app services and global state are not isolated.'} Flow links are inferred from source syntax, not proof that every runtime state is reachable.`;
    if(screen.notes!==note || Object.keys(screen.props).some(key=>key!=='native') || screen.links.some(link=>!old.generatedLinks?.includes(link))) continue;
    if(existingScreens.some(other=>other.links.includes(screen.key) && !(other.props.native as any)?.generatedLinks?.includes(screen.key))) continue;
    const code=await readFile(await projectPath(session.directory,screen.source),'utf8');
    if(code!==`// Native source: ${old.file}\n// Use a reviewed experiment override to edit this screen.\n`) continue;
    operations.push({type:'screen.remove',id:screen.id});
    delete document.screens[screen.id];document.screenIds=document.screenIds.filter(id=>id!==screen.id);
  }
  if (projectHash && !isDeepStrictEqual(currentInputs, nativePreview)) operations.push({type:'native.refresh', expectedHash:projectHash});
  if(context!==(nativePreview.context ?? 'isolated')) operations.push({type:'native.context',context});
  for (const item of plans) {
    const {node, entry, existing, key, identity, scene} = item;
    const evidence = node ? flow.edges.filter(edge => edge.from === node.id).flatMap(edge => plans.filter(p=>p.node?.id===edge.to).map(p=>({...edge,to:p.key}))) : [];
    const generatedLinks = [...new Set(evidence.map(edge => edge.to))];
    const previousGenerated = (existing?.props.native as any)?.generatedLinks ?? [];
    const links = [...new Set([...(existing?.links ?? []).filter(link => !previousGenerated.includes(link)), ...generatedLinks])];
    const recipe = !entry && node ? recipes.find(recipe => recipe.target === node.id) : undefined;
    const providerPlan=entry ? providerPlans.get(entry.factory) : undefined;
    const services=context==='isolated' && currentInputs.buildStrategy==='xcode' ? startupRequirements(entry?.references ?? (recipe ? [recipe.root.slice(recipe.root.lastIndexOf(':')+1)] : [node?.symbol ?? ''])) : [];
    const blocker = buildIssues.length ? {kind:'build-integration', message:'This app needs native build integration before its screens can render. The source map is available.'}
      : services.length ? {kind:'app-startup',message:`This preview references ${services.join(', ')}, configured by the app's normal startup. Canvas has not run that startup. Supply a preview with local service state to render it independently.`}
      : providerPlan?.missing.length ? {kind:'environment',message:`This app preview is missing an unambiguous environment provider for ${providerPlan.missing.join(', ')}.`}
      : !entry && !recipe && node ? swiftPreviewBlocker(scans, node.file, node.symbol) : null;
    const issue = blocker?.message ?? entry?.issue ?? null;
    const native = {
      file: node?.file ?? entry!.file, symbol: node?.symbol ?? null, line: node?.line ?? null, context,
      factory: blocker ? null : entry?.factory ?? recipe?.factory ?? null, factoryFile: entry?.file ?? recipe?.file ?? null, identity, issue, blocker,
      previewProviders:providerPlan?.providers.map(provider=>({...provider})) ?? [],
      scene:scene ? {id:scene.id,owner:scene.owner,selector:scene.selector,value:scene.value,root:scene.root,index:Object.keys(scene.cases).indexOf(scene.value),
        destinations:Object.fromEntries(Object.keys(scene.cases).flatMap(value=>keyForScene.has(scene.id+':'+value)?[[value,keyForScene.get(scene.id+':'+value)!]]:[]))} : null,
      recipe: recipe ? {root:recipe.root, projections:recipe.projections, provenance:recipe.provenance} : null,
      previewId:entry?.factory ?? null,
      component:!node && entry && selectedPreviews.has(entry.factory) ? {label:entry.label,animationEvidence:entry.animationEvidence} : null,
      imageFixtures:(existing?.props.native as any)?.imageFixtures ?? {},
      kind: node?.kind ?? (entry && selectedPreviews.has(entry.factory)?'component':'preview'), requirements: [...buildIssues, ...(node?.requirements ?? [])],
      root: !!node && flow.roots.includes(node.id), generatedLinks, linkEvidence: evidence,
      destinations: generatedLinks.map(key => ({key, name: plans.find(p => p.key === key)!.name})),
      unresolved: flow.unresolved.filter(item => item.file === node?.file),
      serviceContext: context==='application' ? 'The original SwiftUI App initializer runs once. App services and globals are shared; this is not an offline preview.' : 'Independent previews; the original App initializer is not run.',
      deviceCapabilities: scans.some(scan=>scan.motionAdapter) ? ['Device motion is unavailable on the Mac preview host. Motion-driven styling uses the app’s neutral state.'] : [],
      externalActions: 'Mail capability is disabled. SwiftUI URL-opening requests are blocked and reported per frame. Direct native calls and network requests are not sandboxed.',
    };
    const notes = `Swift ${native.kind}: ${native.file}${node ? `:${node.line} (${node.symbol})` : ''}. ${issue ?? recipe?.provenance ?? 'Existing #Preview factory; app services and global state are not isolated.'} Flow links are inferred from source syntax, not proof that every runtime state is reachable.`;
    const props = {...existing?.props, native};
    const previous = existing?.props.native as any;
    const previousGeneratedNote = previous ? `Swift ${previous.kind}: ${previous.file}${previous.symbol ? `:${previous.line} (${previous.symbol})` : ''}. ${previous.issue ?? previous.recipe?.provenance ?? 'Existing #Preview factory; app services and global state are not isolated.'} Flow links are inferred from source syntax, not proof that every runtime state is reachable.` : null;
    const updateNotes = existing?.notes === previousGeneratedNote;
    if (existing) {
      if (JSON.stringify(existing.props) !== JSON.stringify(props) || JSON.stringify(existing.links) !== JSON.stringify(links)) {
        operations.push({type: 'screen.update', id: existing.id, patch: {props, links, ...(updateNotes ? {notes} : {}), ...(scene && existing.name===previous?.symbol ? {name:item.name} : {})}});
        document.screens[existing.id] = {...existing, props, links};
      }
    } else {
      const source = `screens/${key}.swift`;
      const screen = ScreenSchema.parse({id: `planned-${key}`, key, name: item.name, exportName: 'default', width: 402, height: 874, x: 0, y: 0, source, props, notes, links});
      document.screenIds.push(screen.id);
      document.screens[screen.id] = screen;
      const {id, ...spec} = screen;
      operations.push({type: 'screen.create', screen: {...spec, code: `// Native source: ${native.file}\n// Use a reviewed experiment override to edit this screen.\n`}});
    }
  }
  // Only place new frames. Re-import preserves the person's existing layout.
  const positions = new Map(arrangeByFlow(document).map(move => [document.screens[move.id].key, move.patch]));
  for (const operation of operations) if (operation.type === 'screen.create') Object.assign(operation.screen, positions.get(operation.screen.key));
  if (operations.length > 128) throw new Error('This import exceeds 128 changes. Split the native target into smaller design projects.');
  const result = operations.length ? await store.execute({...identityOf(session), requestId: randomUUID(), label: 'Import Swift screen map', operations}) : {session};
  return {...result, import: {kind: 'swift-ios', routeMap: flow, candidates: scans.flatMap(f => f.views.map(v => ({...v, file: f.path}))),
    imageAssets, previewCatalog:entries.map(entry=>({...entry,selected:selectedPreviews.has(entry.factory)})),
    buildIssues, unmappedPreviews: (buildIssues.length || currentInputs.buildStrategy === 'xcode') && flow.nodes.length ? unassignedPreviews : [],
    coverage: 'Source-backed SwiftUI navigation, presentations and recognized panes. Existing previews, default initializers and source-backed local demo recipes provide live content; missing preview data stays visible. Arbitrary dynamic routing and service states are not exhaustive.'}};
}
