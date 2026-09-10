import type { CanvasDocument, Screen } from "../shared/model";

export type Move = { type: "screen.update"; id: string; patch: { x: number; y: number } };

/**
 * Lay frames out as a flow, top down: the entry screen first, then a row per
 * navigation depth, each row centered and ordered by where its parents sit so
 * connectors cross as little as possible. Design variants (frames that share a
 * source with a linked screen but are linked from nowhere) form a band under
 * the flow, each under the screen it varies. Returns only the moves that
 * change a position; the name above each frame and the gaps leave room for connectors.
 */
export function arrangeByFlow(document: CanvasDocument, gapX = 150, gapY = 200, header = 28): Move[] {
  const order = document.screenIds;
  const screens = order.map((id) => document.screens[id]);
  const stepGroups = new Map<string, Screen[]>();
  const stepIds = new Set<string>();
  for (const screen of screens) {
    const step = (screen.props.route as any)?.step;
    if (!step || typeof step.routeKey !== 'string' || !Number.isInteger(step.index)) continue;
    stepIds.add(screen.id);
    stepGroups.set(step.routeKey, [...(stepGroups.get(step.routeKey) ?? []), screen]);
  }
  const byKey = new Map(screens.map((screen) => [screen.key, screen]));
  const outgoing = new Map<string, string[]>(screens.map((screen) => [screen.id, []]));
  const incoming = new Map<string, Set<string>>(screens.map((screen) => [screen.id, new Set()]));
  for (const screen of screens)
    for (const key of screen.links) {
      const target = byKey.get(key);
      if (!target || target.id === screen.id) continue;
      outgoing.get(screen.id)!.push(target.id);
      incoming.get(target.id)!.add(screen.id);
    }
  const inDegree = (id: string) => incoming.get(id)!.size;

  // A variant shares its source with the group's base screen and nothing links to it.
  const groups = new Map<string, Screen[]>();
  for (const screen of screens.filter(screen => !stepIds.has(screen.id))) groups.set(screen.source, [...(groups.get(screen.source) ?? []), screen]);
  const baseOf = new Map<string, Screen>();
  const variants = new Set<string>();
  for (const members of groups.values()) {
    const base = [...members].sort((a, b) => inDegree(b.id) - inDegree(a.id) || order.indexOf(a.id) - order.indexOf(b.id))[0];
    for (const member of members) {
      if (member !== base && inDegree(member.id) === 0) {
        variants.add(member.id);
        baseOf.set(member.id, base);
      }
    }
  }
  const excluded = new Set([...variants, ...stepIds]);
  const regular = screens.filter((screen) => !excluded.has(screen.id));
  const reach = (start: string) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) for (const next of outgoing.get(queue.shift()!)!) if (!excluded.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    return seen.size;
  };

  // The entry is the unlinked screen that reaches the most of the app; other unlinked screens are top level beside its children.
  const roots = regular.filter((screen) => inDegree(screen.id) === 0);
  const entry = [...roots].sort((a, b) => reach(b.id) - reach(a.id) || order.indexOf(a.id) - order.indexOf(b.id))[0] ?? regular[0];
  const depth = new Map<string, number>();
  if (entry) depth.set(entry.id, 0);
  for (const root of roots) if (root !== entry) depth.set(root.id, 1);
  const queue = [...depth.keys()];
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of outgoing.get(id)!) {
      if (excluded.has(target) || depth.has(target)) continue;
      depth.set(target, depth.get(id)! + 1);
      queue.push(target);
    }
  }
  for (const screen of regular) if (!depth.has(screen.id)) depth.set(screen.id, 1);

  const rows = new Map<number, Screen[]>();
  for (const screen of regular) rows.set(depth.get(screen.id)!, [...(rows.get(depth.get(screen.id)!) ?? []), screen]);
  const depths = [...rows.keys()].sort((a, b) => a - b);

  // Columns within a row: a screen sits near the average column of the parents that open it.
  const column = new Map<string, number>();
  for (const level of depths) {
    const nodes = rows.get(level)!;
    const score = (screen: Screen) => {
      const parents = [...incoming.get(screen.id)!].filter((parent) => column.has(parent) && depth.get(parent)! < level);
      return parents.length ? parents.reduce((sum, parent) => sum + column.get(parent)!, 0) / parents.length : Number.POSITIVE_INFINITY;
    };
    nodes.sort((a, b) => score(a) - score(b) || order.indexOf(a.id) - order.indexOf(b.id));
    nodes.forEach((screen, index) => column.set(screen.id, index));
  }

  const rowWidth = (nodes: Screen[]) => nodes.reduce((sum, screen) => sum + screen.width, 0) + gapX * (nodes.length - 1);
  const widest = Math.max(0, ...depths.map((level) => rowWidth(rows.get(level)!)));
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  const placedSteps = new Set<string>();
  const placeSteps = (key: string, members: Screen[]) => {
    members.sort((a, b) => (a.props.route as any).step.index - (b.props.route as any).step.index);
    let x = 0;
    for (const screen of members) { positions.set(screen.id, { x, y }); x += screen.width + gapX; }
    y += Math.max(...members.map(screen => screen.height)) + header + gapY;
    placedSteps.add(key);
  };
  for (const level of depths) {
    const nodes = rows.get(level)!;
    let x = Math.round((widest - rowWidth(nodes)) / 2);
    for (const screen of nodes) {
      positions.set(screen.id, { x, y });
      x += screen.width + gapX;
    }
    y += Math.max(...nodes.map((screen) => screen.height)) + header + gapY;
    // A connected corridor belongs immediately after its entry, before the
    // destination rows. Unconnected state variants still use the trailing band.
    for (const [key, members] of stepGroups) {
      if (placedSteps.has(key)) continue;
      const parents = members.flatMap(screen => [...incoming.get(screen.id)!]).filter(id => !stepIds.has(id));
      if (parents.length && parents.every(id => positions.has(id))) placeSteps(key, members);
    }
  }
  // Variants: a band under the flow, each under the screen it varies, stacking when several share a base.
  const stacked = new Map<string, number>();
  for (const screen of screens) {
    if (!variants.has(screen.id)) continue;
    const base = baseOf.get(screen.id)!;
    const index = stacked.get(base.id) ?? 0;
    stacked.set(base.id, index + 1);
    const anchor = positions.get(base.id) ?? { x: 0, y };
    positions.set(screen.id, { x: anchor.x, y: y + gapY / 2 + index * (screen.height + header + gapY) });
  }
  // Finite route steps form their own ordered bands, separate from route depth.
  y = Math.max(y, ...screens.filter(screen => positions.has(screen.id)).map(screen => positions.get(screen.id)!.y + screen.height + header + gapY));
  for (const [key, members] of stepGroups) if (!placedSteps.has(key)) placeSteps(key, members);
  return screens
    .filter((screen) => {
      const position = positions.get(screen.id)!;
      return position.x !== screen.x || position.y !== screen.y;
    })
    .map((screen) => ({ type: "screen.update", id: screen.id, patch: positions.get(screen.id)! }));
}
