import type {SwiftScan} from './scan';

export interface PreviewProvider {type:string;kind:string;expression:string;file:string}
export interface PreviewProviderPlan {providers:PreviewProvider[];missing:string[]}

/** Reuse only unambiguous provider constructors already authored in this app's previews. */
export function swiftPreviewProviders(scans:SwiftScan[]) {
  const declarations=scans.flatMap(scan=>scan.declarations.map(d=>({...d,file:scan.path})));
  const resolve=(file:string,name:string)=>{
    const matches=declarations.filter(d=>d.name===name || d.symbol===name);
    return matches.find(d=>d.file===file) ?? (matches.length===1 ? matches[0] : undefined);
  };
  const candidates=scans.flatMap(scan=>scan.previews.flatMap(preview=>(preview.providers??[]).map(p=>({...p,file:scan.path}))));
  const required=(file:string,name:string,seen=new Set<string>()):{type:string;kind:string}[]=>{
    const view=resolve(file,name); if(!view?.isView || seen.has(view.file+':'+view.symbol)) return [];
    seen.add(view.file+':'+view.symbol);
    const calls=scans.find(s=>s.path===view.file)!.calls.filter(c=>c.owner===view.symbol && !c.inDestination);
    const supplied=new Set<string>();
    for(const call of calls.filter(c=>c.name==='environment'||c.name==='environmentObject')) {
      const argument=call.expression.match(/\.environment(?:Object)?\(\s*(\w+)\s*[()]/)?.[1];
      if(argument) supplied.add(view.fields.find(f=>f.name===argument)?.type ?? argument);
    }
    const all=[...view.environment,...calls.filter(c=>c.constructor).flatMap(c=>required(view.file,c.name,seen))];
    return all.filter(p=>!supplied.has(p.type));
  };
  const plans=new Map<string,PreviewProviderPlan>();
  for(const scan of scans) for(const preview of scan.previews) {
    const supplied=new Set((preview.providers??[]).map(p=>p.type));
    const needs=[...new Map(preview.references.flatMap(name=>required(scan.path,name)).filter(p=>!supplied.has(p.type)).map(p=>[p.type,p])).values()];
    const providers:PreviewProvider[]=[],missing:string[]=[];
    for(const need of needs) {
      const options=candidates.filter(p=>p.type===need.type && p.kind===need.kind &&
        p.identifiers.every(id=>{
          const declaration=resolve(p.file,id);
          return declaration && (declaration.accessible || declaration.file===scan.path);
        }));
      const unique=[...new Map(options.map(p=>[p.expression,p])).values()];
      if(unique.length===1) providers.push({type:need.type,kind:need.kind,expression:unique[0].expression,file:unique[0].file});
      else missing.push(need.type);
    }
    plans.set(preview.factory,{providers,missing});
  }
  return plans;
}
