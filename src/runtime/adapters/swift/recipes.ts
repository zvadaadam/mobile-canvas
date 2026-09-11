import {createHash} from 'node:crypto';
import type {SwiftScan} from './scan';
import {projectConstructor} from './projection';

export interface SwiftRecipe {
  target: string;
  root: string;
  file: string;
  expression: string;
  factory: string;
  projections: {file: string; id: string; target: string; line: number; owner: string; expression: string; environment?: {type:string;kind:string;variable:string}[]}[];
  provenance: string;
  guards?: number;
}

/** Reuse app-authored constructor expressions in their original state-owning view. */
export function swiftRecipes(scans: SwiftScan[]): SwiftRecipe[] {
  const declarations = scans.flatMap(scan => scan.declarations.map(d => ({...d, file: scan.path, id: `${scan.path}:${d.symbol}`})));
  const views = declarations.filter(d => d.isView && d.projectable && !d.generic && !d.symbol.includes('.'));
  const names = new Set(declarations.map(d => d.name));
  const resolve = (file: string, name: string) => {
    const matches = views.filter(d => d.name === name);
    const local = matches.filter(d => d.file === file);
    return local.length === 1 ? local[0] : matches.length === 1 ? matches[0] : undefined;
  };
  const environmentFor = (file: string, symbol: string, seen = new Set<string>()): {type:string;kind:string;variable:string}[] => {
    const id = file+':'+symbol;
    if (seen.has(id)) return [];
    seen.add(id);
    const declaration = declarations.find(d=>d.id===id);
    const own = (declaration?.environment ?? []).map(e=>({...e,variable:'_canvasEnvironment_'+e.type.replace(/[^a-zA-Z0-9]/g,'_')}));
    for (const call of scans.find(s=>s.path===file)?.calls.filter(c=>c.owner===symbol && !c.inDestination && c.constructor) ?? []) {
      const matches = declarations.filter(d=>d.name===call.name);
      const child = matches.find(d=>d.file===file) ?? (matches.length===1 ? matches[0] : undefined);
      if (child) own.push(...environmentFor(child.file,child.symbol,seen));
    }
    return [...new Map(own.map(e=>[e.type,e])).values()];
  };
  const argument = (label: string, expression: string) => label === '_' ? expression : `${label}: ${expression}`;
  const nativeControls = new Set(['UILabel','UIButton','UITextField','UITextView','UISwitch','UISlider','UISegmentedControl','UIProgressView','UIPasteControl']);
  const unsupportedBridge = (file: string, symbol: string, seen = new Set<string>()): boolean => {
    const id = file+':'+symbol;
    if (seen.has(id)) return false;
    seen.add(id);
    const declaration = declarations.find(d=>d.id===id);
    if (declaration?.isView && !declaration.projectable) return !nativeControls.has(declaration.nativeViewType);
    return (scans.find(s=>s.path===file)?.calls ?? []).some(call => {
      if (call.owner!==symbol || call.inDestination || !call.constructor) return false;
      const matches=declarations.filter(d=>d.name===call.name);
      const child=matches.find(d=>d.file===file) ?? (matches.length===1 ? matches[0] : undefined);
      return child ? unsupportedBridge(child.file,child.symbol,seen) : false;
    });
  };
  const needsBridgeSetup = (view: typeof views[number]) => {
    const hasData = view.requirements.some(input => !input.endsWith('?') && !/->\s*(?:Void|\(\))$/.test(input));
    return !hasData && !/(?:Demo|Preview)/.test(view.name) && unsupportedBridge(view.file,view.symbol);
  };
  const canSupply = (providers: {type:string}[]) => providers.every(e=>declarations.some(d=>d.name===e.type && !d.isView && !d.requirements.length && !d.generic));
  const result = new Map<string, SwiftRecipe>();
  const factory = (id: string) => 'canvasRecipe_' + createHash('sha256').update(id).digest('hex').slice(0,24);
  // Explicit demo/preview roots may carry local lifecycle work. Other default
  // roots with lifecycle work require an authored preview instead of auto-starting services.
  for (const view of views) {
    const demo = /(?:Demo|Preview)/.test(view.name);
    if (environmentFor(view.file,view.symbol).length || needsBridgeSetup(view)) continue;
    const calls = scans.find(s => s.path === view.file)!.calls.filter(c => c.owner === view.symbol);
    if (!demo && calls.some(c => c.name === 'task')) continue;
    const arguments_: string[] = [];
    let supported = true;
    for (const requirement of view.requirements) {
      if (requirement.endsWith("?")) { arguments_.push(argument(requirement.split(":")[0], "nil")); continue; }
      const match = requirement.match(/^(\w+):\s*(?:@escaping\s+)?\(([^()]*)\)\s*->\s*(?:Void|\(\))$/);
      if (!match) { supported = false; break; }
      const params = match[2].trim() ? match[2].split(',').map(() => '_').join(', ') + ' in ' : '';
      arguments_.push(argument(match[1], `{ ${params} }`));
    }
    if (!supported) continue;
    result.set(view.id, {target:view.id, root:view.id, file:view.file, expression:`${view.symbol}(${arguments_.join(', ')})`, factory:factory(view.id), projections:[],
      provenance: demo ? `App-authored ${view.name} default demo state.` : `App-authored default initializer${arguments_.length ? '; action callbacks are inert' : ''}. No backend data was invented.`});
  }
  // Prefer source constructors with fewer guarded inputs, then shorter owner paths.
  // Only recognized lexical bindings can supply closure-local values.
  const sourceScores = new Map<string, number>();
  const propagate = () => {
    for (let depth=0; depth<5; depth++) {
      for (const scan of scans) for (const call of scan.calls) {
        if (!call.constructor) continue;
        const owner = views.find(d => d.file === scan.path && d.symbol === call.owner);
        if (!owner) continue;
        const parent = result.get(owner.id), target = resolve(scan.path, call.name);
        if (!parent || !target || parent.projections.length !== depth) continue;
        if (result.has(target.id) && !sourceScores.has(target.id)) continue;
        if (parent.root === target.id || parent.projections.some(projection => projection.target === target.id)) continue;
        const environment = environmentFor(target.file,target.symbol);
        if (!canSupply(environment) || needsBridgeSetup(target)) continue;
        const available = new Set([...owner.members, ...owner.members.map(name => '$'+name), ...names, 'self']);
        const projected = projectConstructor(call, available, target.name);
        if (!projected) continue;
        const guards = (parent.guards ?? 0) + projected.guards;
        const score = guards * 100 + parent.projections.length + 1;
        if (score >= (sourceScores.get(target.id) ?? Infinity)) continue;
        sourceScores.set(target.id, score);
        result.set(target.id, {...parent, target:target.id, factory:factory(target.id), guards,
          projections:[...parent.projections,{file:scan.path,id:call.projection,target:target.id,line:call.line,owner:call.owner,expression:projected.expression,environment}],
          provenance:`${parent.provenance} Reuses ${owner.name}'s existing ${target.name} constructor and state (${scan.path}:${call.line}).`});
      }
    }
  };
  propagate();
  // A service parameter with a production default may have an explicit local
  // implementation in this app. Use only a unique, accessible Demo/Preview
  // implementation with a supported zero-argument initializer.
  for (const view of views.filter(view => !result.has(view.id) && view.parameters.length)) {
    if (environmentFor(view.file,view.symbol).length || needsBridgeSetup(view)) continue;
    const args: string[] = [];
    let fixtures = 0, supported = true;
    for (const parameter of view.parameters) {
      const type = parameter.type.replace(/^any /, '').trim();
      const candidates = declarations.filter(d => !d.isView && !d.generic && !d.requirements.length &&
        /(?:Demo|Preview)/.test(d.name) && (d.accessible || d.file === view.file) && d.inherits.includes(type));
      if (candidates.length === 1) { args.push(argument(parameter.name, `${candidates[0].symbol}()`)); fixtures++; }
      else if (!parameter.hasDefault) { supported=false; break; }
    }
    if (!supported || !fixtures) continue;
    result.set(view.id,{target:view.id,root:view.id,file:view.file,expression:`${view.symbol}(${args.join(', ')})`,
      factory:factory(view.id),projections:[],provenance:`App-local preview service implementation: ${args.join(', ')}. The view retains its own loading lifecycle.`});
  }
  propagate();
  // Bind required inputs to typed values already owned by an app-authored demo.
  // This retains the demo's State storage and its real local service implementations.
  const normal = (type: string) => type.replace(/^any /, '').trim();
  const declaredType = (file: string, type: string) => {
    const matches = declarations.filter(d => d.name === normal(type));
    return matches.find(d=>d.file===file) ?? (matches.length === 1 ? matches[0] : undefined);
  };
  const callbacks = (type: string) => {
    const match = type.match(/^(?:@escaping\s+)?\(([^()]*)\)\s*->\s*(?:Void|\(\))$/);
    return match ? `{ ${match[1].trim() ? match[1].split(',').map(()=>'_').join(', ')+' in ' : ''} }` : undefined;
  };
  // Repeat binding and constructor propagation: a newly constructed parent
  // may own the data needed by a destination that appears earlier in the files.
  for (let pass=0; pass<8; pass++) {
    const before = result.size;
    const candidates = new Map<string, {recipe:SwiftRecipe; cost:number}>();
    for (const owner of [...views].sort((a,b)=>(result.get(a.id)?.projections.length ?? 99)-(result.get(b.id)?.projections.length ?? 99))) {
      const root = result.get(owner.id);
      if (!root || root.projections.length >= 4 || !/(?:Demo|Preview)/.test(root.root)) continue;
      const values: {name:string; type:string; expression:string; optional:boolean}[] = [];
      const collect = (name: string, typeName: string, expression: string, optional: boolean, depth: number, seen: Set<string>) => {
        const type = normal(typeName).replace(/\?$/, '');
        const nullable = optional || typeName.endsWith('?');
        if (depth <= 1 || !["String","Bool","Int","Double","Float"].includes(type)) values.push({name,type,expression,optional:nullable});
        if (depth >= 3 || seen.has(type)) return;
        const array = type.match(/^\[([\w.]+)\]$/);
        if (array) {
          collect(name,array[1]+'?',expression+(typeName.endsWith('?') ? '?' : '')+'.first',true,depth+1,seen);
          return;
        }
        const declaration = declaredType(owner.file,type);
        if (!declaration) return;
        const next = new Set([...seen,type]);
        const inherited = scans.flatMap(s=>s.extensions).filter(e=>e.type===declaration.name || declaration.inherits.includes(e.type)).flatMap(e=>e.fields);
        for (const child of [...declaration.fields,...inherited]) {
          if (!child.accessible) continue;
          collect(child.name,child.type,expression+(typeName.endsWith('?') ? '?' : '')+'.'+child.name,nullable,depth+1,next);
        }
      };
      for (const field of owner.fields) collect(field.name,field.type,field.name,false,0,new Set());
      for (const target of views.filter(d => d.id !== owner.id && !result.has(d.id) && (d.accessible || d.file === owner.file))) {
        const args: string[] = [], bindings: string[] = [];
        const environment = environmentFor(target.file,target.symbol);
        if (!canSupply(environment) || needsBridgeSetup(target)) continue;
        let boundValues = 0;
        let supported = true;
        for (const requirement of target.requirements) {
          const separator = requirement.indexOf(':');
          const label = requirement.slice(0,separator), type = requirement.slice(separator+1).trim();
          if (type.endsWith('?')) { args.push(argument(label, "nil")); continue; }
          const callback = callbacks(type);
          if (callback) { args.push(argument(label, callback)); continue; }
          if (type === 'Bool' && label === 'isActive') { args.push(argument(label, "true")); continue; }
          if (type === 'String' && ['selected','filter','query'].includes(label)) { args.push(argument(label, '""')); continue; }
          const matches = values.filter(value => normal(value.type) === normal(type) || declaredType(owner.file,value.type)?.inherits.includes(normal(type))).sort((a,b)=>a.expression.split('.').length-b.expression.split('.').length);
          const eligible = ['String','Bool','Int','Double','Float'].includes(type) ? matches.filter(value=>!value.optional) : matches;
          const value = eligible.find(value=>value.name===label) ?? eligible.find(value=>value.name===label+'s') ?? (!['String','Bool','Int','Double','Float'].includes(type) ? eligible[0] : undefined);
          if (!value) {
            const provider = declarations.some(d=>d.environment.some(e=>e.type===normal(type))) && declarations.find(d=>d.name===normal(type) && !d.isView && !d.requirements.length && !d.generic);
            if (provider) {
              const variable = '_canvasEnvironment_'+provider.name;
              if (!environment.some(e=>e.type===provider.name)) environment.push({type:provider.name,kind:'typed',variable});
              args.push(argument(label, variable)); boundValues++; continue;
            }
            supported=false; break;
          }
          boundValues++;
          let expression = value.expression;
          if (value.optional) { expression = `_canvasValue${bindings.length}`; bindings.push(`${expression} = ${value.expression}`); }
          args.push(argument(label, expression));
        }
        if (!supported || !target.requirements.length || !boundValues) continue;
        let expression = `${target.symbol}(${args.join(', ')})`;
        if (bindings.length) expression = `Group { if let ${bindings.join(', let ')} { ${expression} } else { CanvasRecipeUnavailable("No local example is available for ${target.name}.") } }`;
        const recipe: SwiftRecipe = {...root,target:target.id,factory:factory(target.id), guards:(root.guards ?? 0)+bindings.length,
          projections:[...root.projections,{file:owner.file,owner:owner.symbol,id:owner.symbol+':recipe:'+factory(target.id),target:target.id,line:owner.line,expression,environment}],
          provenance:`${root.provenance} Inputs from ${owner.name}'s local model. Optional inputs are nil, action callbacks inert, and active panes enabled. Missing collection examples stay unavailable.${environment.length ? ` Default app environment: ${environment.map(e=>e.type).join(", ")}; its services are not disconnected.` : ""}`};
        const cost = bindings.length * 100 + root.projections.length;
        if (!candidates.has(target.id) || cost < candidates.get(target.id)!.cost) candidates.set(target.id,{recipe,cost});
      }
    }
    // Make parents with complete inputs available before guessing optional
    // records. Their authored navigation may supply both the record and the
    // lifecycle that loads it; a direct global binding would bypass that owner.
    const hasCompleteInputs = [...candidates.values()].some(candidate => candidate.cost < 100);
    for (const [target, candidate] of candidates) {
      if (!hasCompleteInputs || candidate.cost < 100) result.set(target,candidate.recipe);
    }
    propagate();
    if (result.size === before) break;
  }
  // A sheet whose content is a computed View property can use that property in
  // the same state-owning parent; no separate app-specific fixture is needed.
  for (const scan of scans) for (const boundary of scan.boundaries) {
    if (!['sheet','fullScreenCover'].includes(boundary.kind)) continue;
    const owner = views.find(d=>d.file===scan.path && d.symbol===boundary.owner);
    const parent = owner && result.get(owner.id);
    const property = owner?.fields.find(field=>field.type==='some View' && boundary.destinations.includes(field.name));
    if (!owner || !parent || !property) continue;
    const target = `${scan.path}:${owner.symbol}.${boundary.kind}:${boundary.binding || boundary.line}`;
    result.set(target,{...parent,target,factory:factory(target),projections:[...parent.projections,{file:scan.path,owner:owner.symbol,id:owner.symbol+':property:'+property.name,target,line:boundary.line,expression:property.name}],
      provenance:`${parent.provenance} Existing presentation content: ${property.name}.`});
  }
  return [...result.values()];
}
