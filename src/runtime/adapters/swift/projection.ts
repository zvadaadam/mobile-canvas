import type {SwiftCall} from './scan';

/** Recreate only the lexical data bindings needed by an app-authored constructor. */
export function projectConstructor(call: SwiftCall, members: Iterable<string>, destination: string): {expression:string; guards:number} | undefined {
  const available = new Set(members);
  const locals = new Set(call.locals);
  const needed = new Set(call.identifiers.filter(name => locals.has(name)));
  const selected: SwiftCall['scopeBindings'] = [];
  // Resolve inner bindings back to their outer data source. Unknown closures,
  // parameters, and local computations must not leak into a generated body.
  for (const binding of [...call.scopeBindings].reverse()) {
    if (!needed.delete(binding.name)) continue;
    selected.unshift(binding);
    for (const name of binding.identifiers) {
      if (name !== binding.name && locals.has(name)) needed.add(name);
      else if (!available.has(name)) return;
    }
  }
  if (needed.size) return;
  for (const binding of selected) available.add(binding.name);
  if (call.identifiers.some(name => !available.has(name))) return;
  let expression = call.expression;
  // Nested scopes preserve legal shadowing (if let item = item), and bind each
  // optional only once. Missing data remains explicit, never force-unwrapped.
  for (const binding of [...selected].reverse()) {
    expression = `Group { if let ${binding.name} = ${binding.expression} { ${expression} } else { CanvasRecipeUnavailable("No local example is available for ${destination}.") } }`;
  }
  return {expression, guards:selected.length};
}
