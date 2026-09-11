import type {SwiftScan, SwiftDeclaration} from './scan';

export interface SwiftScene {
  id:string;
  file:string;
  owner:string;
  selector:string;
  type:string;
  value:string;
  target:string;
  factory:string;
  factoryFile:string;
  root:string;
  cases:Record<string,string>;
}

/** Keep a finite page's authored parent, including its background and controls. */
export function swiftScenes(scans:SwiftScan[]):SwiftScene[] {
  const declarations=scans.flatMap(s=>s.declarations.map(d=>({...d,file:s.path,id:s.path+':'+d.symbol})));
  const resolve=(file:string,name:string)=>{
    const matches=declarations.filter(d=>d.name===name || d.symbol===name);
    return matches.find(d=>d.file===file) ?? (matches.length===1 ? matches[0] : undefined);
  };
  const calls=scans.flatMap(s=>s.calls.map(c=>({...c,file:s.path})));
  function selectorType(owner:typeof declarations[number], selector:string) {
    const parts=selector.split('.');
    if(parts[0]==='self') parts.shift();
    let current:SwiftDeclaration|undefined=owner;
    for(let i=0;i<parts.length;i++) {
      const field=current?.fields.find(f=>f.name===parts[i]);
      if(!field || (i>0 && !field.accessible)) return;
      const key=field.environmentKey?.match(/^\\\.(\w+)$/)?.[1];
      const typedEnvironment=field.environmentKey?.match(/^([\w.]+)\.self$/)?.[1];
      const type=field.type || typedEnvironment || (key ? scans.flatMap(s=>s.extensions.filter(e=>e.type==='EnvironmentValues').flatMap(e=>e.fields)).find(f=>f.name===key)?.type : undefined);
      if(!type) return;
      // A plain stored var on a View is immutable inside body. Only a
      // nonmutating wrapper or a referenced class can supply this setter.
      if(i===parts.length-1) return field.mutable && (field.nonmutating || current?.referenceType) ? type : undefined;
      current=resolve(owner.file,type);
      if(!current?.referenceType) return;
    }
  }
  function distance(file:string,name:string,target:string,seen=new Set<string>()):number {
    const view=resolve(file,name);
    if(!view?.isView || seen.has(view.id)) return Infinity;
    if(view.id===target) return 0;
    seen.add(view.id);
    const next=calls.filter(c=>c.file===view.file && c.owner===view.symbol && !c.inDestination && c.constructor);
    return 1+Math.min(Infinity,...next.map(c=>distance(view.file,c.name,target,new Set(seen))));
  }
  const result:SwiftScene[]=[];
  for(const owner of declarations.filter(d=>d.isView && d.projectable)) {
    const branches=calls.filter(c=>c.file===owner.file && c.owner===owner.symbol && c.constructor && !c.inDestination &&
      /(?:^|\.)(?:page|step|tab|pane|selectedPage|selectedTab|currentStep)$/.test(c.stateSelector??'') && /^\.\w+$/.test(c.stateCase??'') && resolve(c.file,c.name)?.isView);
    for(const selector of new Set(branches.map(c=>c.stateSelector!))) {
      const type=selectorType(owner,selector); if(!type) continue;
      const choices=branches.filter(c=>c.stateSelector===selector);
      const grouped=new Map<string,typeof choices>();
      for(const call of choices) grouped.set(call.stateCase!,[...(grouped.get(call.stateCase!)??[]),call]);
      // Multiple sibling views in a case do not establish one named page.
      const cases=Object.fromEntries([...grouped].filter(([,cs])=>new Set(cs.map(c=>c.name)).size===1).map(([value,cs])=>[value,resolve(owner.file,cs[0].name)!.id]));
      if(Object.keys(cases).length<2) continue;
      const previews=scans.flatMap(s=>s.previews.filter(p=>!p.issue).map(p=>({preview:p,file:s.path,
        distance:Math.min(Infinity,...p.references.map(name=>distance(s.path,name,owner.id)))}))).filter(p=>Number.isFinite(p.distance)).sort((a,b)=>a.distance-b.distance || a.file.localeCompare(b.file) || a.preview.index-b.preview.index);
      const root=previews[0]; if(!root) continue;
      for(const [value,target] of Object.entries(cases)) result.push({id:owner.id+'.'+selector,file:owner.file,owner:owner.symbol,selector,type,value,target,
        factory:root.preview.factory,factoryFile:root.file,root:root.preview.name,cases});
    }
  }
  return result;
}
