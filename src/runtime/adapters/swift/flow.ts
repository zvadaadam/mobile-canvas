import type { SwiftScan, SwiftDeclaration } from './scan';

export interface SwiftFlowNode {
  id: string;
  file: string;
  symbol: string;
  name: string;
  line: number;
  requirements: string[];
  kind: 'screen' | 'presentation';
}
export interface SwiftFlowEdge { from: string; to: string; kind: string; file: string; line: number }
export interface SwiftFlow {
  nodes: SwiftFlowNode[];
  edges: SwiftFlowEdge[];
  roots: string[];
  previews: Record<string, string[]>;
  unresolved: { file: string; line: number; kind: string; reason: string }[];
}
type Declaration = SwiftDeclaration & { id: string; file: string };

/** A navigation catalog, separate from whether a destination can be instantiated. */
export function buildSwiftFlow(scans: SwiftScan[]): SwiftFlow {
  const declarations: Declaration[] = scans.flatMap(scan => scan.declarations.map(d => ({...d, file: scan.path, id: `${scan.path}:${d.symbol}`})));
  const byId = new Map(declarations.map(d => [d.id, d]));
  const resolveRaw = (file: string, name: string): Declaration | undefined => {
    const matches = declarations.filter(d => d.name === name || d.symbol === name);
    const local = matches.filter(d => d.file === file);
    return local.length === 1 ? local[0] : matches.length === 1 ? matches[0] : undefined;
  };
  const endpointNames = new Set(scans.flatMap(scan => scan.boundaries.flatMap(boundary => boundary.destinations)));
  const resolve = (file: string, name: string): Declaration | undefined => {
    let target = resolveRaw(file, name);
    const seen = new Set<string>();
    while (target?.bodyRoot && !seen.has(target.id)) {
      seen.add(target.id);
      const child = resolveRaw(target.file, target.bodyRoot);
      if (!child?.isView || (!endpointNames.has(child.name) && !/(?:Screen|Sheet)$/.test(child.name))) break;
      target = child;
    }
    return target;
  };
  const calls = scans.flatMap(scan => scan.calls.map(call => ({...call, file: scan.path, ownerId: `${scan.path}:${call.owner}`})));
  const boundaries = scans.flatMap(scan => scan.boundaries.map(boundary => ({...boundary, file: scan.path, ownerId: `${scan.path}:${boundary.owner}`})));
  const children = (id: string) => calls.filter(c => c.ownerId === id && !c.inDestination).flatMap(c => {
    const target = resolve(c.file, c.name);
    return target?.isView ? [{target, call: c}] : [];
  });
  const selected = new Set<string>();
  const roots = new Set<string>();
  const rawEdges: SwiftFlowEdge[] = [];
  const presentations: SwiftFlowNode[] = [];
  const unresolved: SwiftFlow['unresolved'] = [];
  const routes = new Map<string, Declaration[]>();
  const add = (d?: Declaration) => { if (d?.isView) selected.add(d.id); };

  const expandedReferences = (file: string, owner: string, names: string[], seen = new Set<string>()): string[] => names.flatMap(name => {
    if (seen.has(name)) return [];
    seen.add(name);
    const property = scans.find(scan => scan.path === file)?.properties.find(p => p.owner === owner && p.name === name);
    return [name, ...(property ? expandedReferences(file, owner, property.references, seen) : [])];
  });
  for (const boundary of boundaries) {
    const targets = expandedReferences(boundary.file, boundary.owner, boundary.destinations).map(name => resolve(boundary.file, name)).filter((d): d is Declaration => !!d?.isView);
    targets.forEach(add);
    if (boundary.kind === 'WindowGroup') {
      for (const target of targets) { roots.add(target.id); children(target.id).filter(c => c.target.name.endsWith('View')).forEach(c => add(c.target)); }
    } else if (boundary.route) {
      routes.set(boundary.route, [...(routes.get(boundary.route) ?? []), ...targets]);
    } else if (!boundary.value) {
      for (const target of targets) rawEdges.push({from: boundary.ownerId, to: target.id, kind: boundary.kind, file: boundary.file, line: boundary.line});
      if (!targets.length && ['sheet', 'fullScreenCover', 'navigationDestination'].includes(boundary.kind)) {
        const binding = boundary.binding.replace(/^\$/, '').replace(/^(showing|show|presented|editing)/, '');
        const symbol = `${boundary.owner}.${boundary.kind}:${boundary.binding || boundary.line}`;
        const id = `${boundary.file}:${symbol}`;
        presentations.push({id, file: boundary.file, symbol, name: binding || `${boundary.owner} ${boundary.kind}`, line: boundary.line,
          requirements: ['Presentation uses inline or computed content; supply a preview of this state.'], kind: 'presentation'});
        rawEdges.push({from: boundary.ownerId, to: id, kind: boundary.kind, file: boundary.file, line: boundary.line});
        unresolved.push({file: boundary.file, line: boundary.line, kind: boundary.kind, reason: 'Inline or computed presentation has no resolved named view.'});
      }
    }
    if (boundary.value && !targets.length) { /* Resolve after all route registrations have been read. */ }
  }
  // Titles, explicit screen/sheet declarations and switch-selected panes remain
  // discoverable even when their presentation is driven through a callback.
  for (const declaration of declarations) if (declaration.isView && /(?:Screen|Sheet)$/.test(declaration.name)) add(declaration);
  for (const call of calls) if (call.name === 'navigationTitle') add(resolve(call.file, byId.get(call.ownerId)?.name ?? ''));
  // Expand switch-selected panes only from known screens, not from every enum
  // switch in a transcript renderer, icon or formatting component.
  let expanded = true;
  while (expanded) {
    const before = selected.size;
    const composed = new Set<string>();
    function visit(id:string) {
      if (composed.has(id)) return;
      composed.add(id); children(id).forEach(child=>visit(child.target.id));
    }
    selected.forEach(visit);
    for (const call of calls) if (call.stateBranch && !call.inDestination && composed.has(call.ownerId) &&
      /(?:^|\.)(?:page|step|tab|pane|selectedPage|selectedTab|currentStep)$/.test(call.stateSelector ?? '')) add(resolve(call.file, call.name));
    expanded = selected.size !== before;
  }
  const routeTargets = (name: string) => routes.get(name) ?? [];
  for (const boundary of boundaries.filter(b => b.value)) {
    const targets = routeTargets(boundary.value);
    for (const target of targets) rawEdges.push({from: boundary.ownerId, to: target.id, kind: 'NavigationLink(value:)', file: boundary.file, line: boundary.line});
    if (!targets.length) unresolved.push({file: boundary.file, line: boundary.line, kind: boundary.kind, reason: `No unambiguous navigation destination for ${boundary.value}.`});
  }
  // A coordinator method constructing a registered route can be followed from
  // its call sites. Ambiguous same-named methods are deliberately not guessed.
  const methods = new Map<string, Map<string, Set<string>>>();
  for (const call of calls) if (call.function && routes.has(call.name)) {
    const owners = methods.get(call.function) ?? new Map<string, Set<string>>();
    const values = owners.get(call.ownerId) ?? new Set<string>();
    values.add(call.name); owners.set(call.ownerId, values); methods.set(call.function, owners);
  }
  const destinationsForMethod = (name: string) => {
    const owners = methods.get(name);
    return owners?.size === 1 ? [...[...owners.values()][0]].flatMap(routeTargets) : [];
  };
  for (const call of calls) {
    for (const target of destinationsForMethod(call.name)) rawEdges.push({from: call.ownerId, to: target.id, kind: 'coordinator', file: call.file, line: call.line});
    const child = resolve(call.file, call.name);
    if (child?.isView) for (const callback of call.callbacks) for (const target of destinationsForMethod(callback)) {
      rawEdges.push({from: child.id, to: target.id, kind: 'callback', file: call.file, line: call.line});
    }
  }
  const nodes: SwiftFlowNode[] = [...selected].map(id => {
    const {file, symbol, name, line, requirements} = byId.get(id)!;
    return {id, file, symbol, name, line, requirements, kind: 'screen'};
  });
  nodes.push(...presentations);
  const canonical = new Set(nodes.map(n => n.id));
  const edges: SwiftFlowEdge[] = [];
  for (const source of nodes) {
    const visited = new Set<string>();
    function walk(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      edges.push(...rawEdges.filter(edge => edge.from === id && edge.to !== source.id).map(edge => ({...edge, from: source.id})));
      for (const {target, call} of children(id)) {
        if (target.id === source.id) continue;
        if (canonical.has(target.id)) {
          // Explicit navigation has priority over the enclosing composition.
          if (!rawEdges.some(edge => edge.from === id && edge.to === target.id))
            edges.push({from: source.id, to: target.id, kind: 'content', file: call.file, line: call.line});
        } else walk(target.id);
      }
    }
    walk(source.id);
  }
  const unique = new Map<string, SwiftFlowEdge>();
  for (const edge of edges) {
    if (!canonical.has(edge.to)) continue;
    const key = `${edge.from}->${edge.to}`;
    if (!unique.has(key) || unique.get(key)!.kind === 'content') unique.set(key, edge);
  }
  const previews: SwiftFlow['previews'] = {};
  for (const scan of scans) for (const preview of scan.previews) {
    const found = new Set<string>();
    const visited = new Set<string>();
    function walk(declaration: Declaration) {
      if (visited.has(declaration.id)) return;
      visited.add(declaration.id);
      if (canonical.has(declaration.id)) { found.add(declaration.id); return; }
      for (const {target} of children(declaration.id)) walk(target);
    }
    preview.references.map(name => resolve(scan.path, name)).filter((d): d is Declaration => !!d?.isView).forEach(walk);
    previews[preview.factory] = [...found];
  }
  return {nodes: nodes.sort((a,b) => a.file.localeCompare(b.file) || a.line-b.line), edges: [...unique.values()], roots: [...roots], previews, unresolved};
}
