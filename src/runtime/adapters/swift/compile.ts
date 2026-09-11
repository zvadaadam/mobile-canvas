import {scanSwift} from './scan';
import {swiftRecipes} from './recipes';
import {swiftPreviewProviders} from './providers';
import {swiftScenes} from './scenes';

/** Shared source projection and factory registration for both native build strategies. */
export async function compileSwiftPreviews(swiftInputs:{path:string;code:string}[], requested:Set<string>, context:'isolated'|'application'='isolated') {
  const discovery = await scanSwift(swiftInputs);
  const recipes = swiftRecipes(discovery).filter(recipe => requested.has(recipe.factory));
  const projections = recipes.flatMap(recipe => recipe.projections);
  const providerPlans=swiftPreviewProviders(discovery);
  const scenes=[...new Map(swiftScenes(discovery).filter(s=>requested.has(s.factory)).map(s=>[s.id,s])).values()];
  const previewModifiers=JSON.stringify(Object.fromEntries([...providerPlans].filter(([factory])=>requested.has(factory)).map(([factory,plan])=>[factory,plan.providers.map(p=>`.${p.kind==='object'?'environmentObject':'environment'}(${p.expression})`).join('')])));
  const scanned = await scanSwift(swiftInputs.map(input => ({...input, previewModifiers, scenes:JSON.stringify(scenes.filter(s=>s.file===input.path)), projections: JSON.stringify([...new Map(projections.filter(p=>p.file===input.path).map(p=>[p.id,p])).values()])})));
  let initialize:string|undefined;
  if(context==='application') {
    const mains=discovery.flatMap(scan=>scan.declarations.filter(d=>d.main && d.inherits.some(t=>t==='App'||t==='SwiftUI.App')).map(d=>({...d,file:scan.path})));
    if(mains.length!==1 || mains[0].requirements.length) throw new Error('Application context requires one SwiftUI App with a zero-argument initializer.');
    const main=mains[0]; initialize='canvasInitializeApplication';
    scanned.find(scan=>scan.path===main.file)!.compiledSource+=`\n@MainActor func ${initialize}() -> Any { ${main.symbol}() }\n`;
  }
  for (const recipe of recipes) {
    const scan = scanned.find(scan => scan.path === recipe.file)!;
    const route = JSON.stringify(recipe.projections.map(p=>p.id));
    scan.compiledSource += `\n@MainActor func ${recipe.factory}(_ context: CanvasPreviewContext) -> UIViewController {\nCanvasPreviewHost.make(NavigationStack { ${recipe.expression}.environment(\\.canvasProjection, ${route}) }, context: context)\n}\n`;
  }
  return {scanned, initialize, factories:[...scanned.flatMap(x=>x.previews.filter(p=>!p.issue && requested.has(p.factory))), ...recipes]};
}
