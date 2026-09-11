import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayoutInfo, RouteFrame } from '../../../shared/routes';
import { evaluateGuard, type GuardExpression, type GuardTransition } from '../../../shared/guards';

function expression(node: ts.Expression): GuardExpression | null {
  if (ts.isIdentifier(node)) return { atom: node.text };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { value: node.kind === ts.SyntaxKind.TrueKeyword };
  if (ts.isParenthesizedExpression(node)) return expression(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) { const value = expression(node.operand); return value && { not: value }; }
  if (ts.isBinaryExpression(node)) {
    const left = expression(node.left), right = expression(node.right);
    if (left && right && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return { and: [left, right] };
    if (left && right && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return { or: [left, right] };
  }
  return null;
}
const atoms = (value: GuardExpression): string[] => 'atom' in value ? [value.atom] : 'not' in value ? atoms(value.not) : 'and' in value ? value.and.flatMap(atoms) : 'or' in value ? value.or.flatMap(atoms) : [];

/** Prove forward eligibility changes in a finite boolean gate. No app code runs.
 * These describe a guard becoming unavailable and the first available destination,
 * not a claim that an authentication/service action has succeeded.
 */
export async function connectRouteGuards(app: string, layouts: LayoutInfo[], frames: RouteFrame[]) {
  const layoutSources = new Map(await Promise.all(layouts.map(async layout => [layout.file, await readFile(join(app, layout.file), 'utf8')] as const)));
  for (const layout of layouts) {
    const source = ts.createSourceFile(layout.file, layoutSources.get(layout.file)!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const navigators = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/^expo-router(?:\/stack)?$/.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) if ((binding.propertyName ?? binding.name).text === 'Stack') navigators.add(binding.name.text);
    }
    const roots: ts.JsxElement[] = [];
    const visit = (node: ts.Node) => { if (ts.isJsxElement(node) && navigators.has(node.openingElement.tagName.getText(source))) roots.push(node); ts.forEachChild(node, visit); };
    visit(source);
    for (const root of roots) {
      const groups: { expression: GuardExpression; text: string; names: string[] }[] = [];
      let supported = true;
      for (const child of root.children) {
        if (ts.isJsxText(child) || ts.isJsxExpression(child) && !child.expression) continue;
        if (!ts.isJsxElement(child) || !navigators.has(child.openingElement.tagName.getText(source).replace(/\.Protected$/, '')) || !child.openingElement.tagName.getText(source).endsWith('.Protected')) { supported = false; break; }
        const guard = child.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'guard') as ts.JsxAttribute | undefined;
        const value = guard?.initializer && ts.isJsxExpression(guard.initializer) ? guard.initializer.expression : undefined;
        const parsed = value && expression(value);
        if (!parsed) { supported = false; break; }
        const names: string[] = [];
        for (const screen of child.children) {
          if (ts.isJsxText(screen) || ts.isJsxExpression(screen) && !screen.expression) continue;
          const opening = ts.isJsxSelfClosingElement(screen) ? screen : ts.isJsxElement(screen) ? screen.openingElement : null;
          if (!opening || opening.tagName.getText(source) !== `${root.openingElement.tagName.getText(source)}.Screen`) { supported = false; break; }
          const name = opening.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'name') as ts.JsxAttribute | undefined;
          if (!name?.initializer || !ts.isStringLiteral(name.initializer)) { supported = false; break; }
          names.push(name.initializer.text);
        }
        groups.push({ expression: parsed, text: value!.getText(source), names });
      }
      const variables = [...new Set(groups.flatMap(group => atoms(group.expression)))].sort();
      if (!supported || groups.length < 2 || variables.length > 8) continue;
      const members = groups.map(group => frames.filter(frame => {
        const index = frame.chain.indexOf(layout.file);
        return index >= 0 && group.names.includes(frame.names[index]);
      }));
      const entry = members.map((group, index) => {
        const firstName = groups[index].names[0];
        const candidates = group.filter(frame => (!frame.step || frame.step.index === 0) && frame.names[frame.chain.indexOf(layout.file)] === firstName);
        // Explicit or computed initial-route policies need their own analysis;
        // choosing a plausible-looking index would invent the wrong destination.
        if (candidates.some(frame => frame.chain.some(file => /\b(initialRouteName|anchor)\b/.test(layoutSources.get(file) ?? '')))) return undefined;
        if (candidates.length === 1) return candidates[0];
        const indices = candidates.filter(frame => /(^|\/)index(?:\.ios|\.native)?\.[jt]sx?$/.test(frame.file));
        return indices.length === 1 ? indices[0] : undefined;
      });
      // A pager exits from its final design, rather than every step in the corridor.
      const exits = entry.map(frame => frame?.step ? members.flat().find(candidate => candidate.step?.routeKey === frame.step!.routeKey && candidate.step.index === candidate.step.count - 1) : frame);
      for (let mask = 0; mask < 2 ** variables.length; mask++) {
        const before = Object.fromEntries(variables.map((name, i) => [name, !!(mask & (1 << i))]));
        const from = groups.findIndex(group => evaluateGuard(group.expression, before));
        if (from < 0 || !exits[from]) continue;
        for (const atom of variables) {
          // Forward eligibility: boolean becomes true. Reverse/auth revocation
          // remains a guard condition, not a line from every protected screen.
          if (before[atom]) continue;
          const after = { ...before, [atom]: true };
          if (evaluateGuard(groups[from].expression, after)) continue;
          const to = groups.findIndex(group => evaluateGuard(group.expression, after));
          if (to <= from || !entry[to]) continue;
          const frame = exits[from]!, target = entry[to]!.key;
          const transition: GuardTransition = { file: layout.file, target, condition: `${groups[from].text} → ${groups[to].text}; ${atom} becomes true`, change: { atom, value: true }, before: Object.fromEntries(Object.entries(before).filter(([key]) => groups.slice(0, to + 1).some(group => atoms(group.expression).includes(key)))) };
          frame.guardTransitions ??= [];
          if (!frame.guardTransitions.some(edge => JSON.stringify(edge) === JSON.stringify(transition))) frame.guardTransitions.push(transition);
          if (!frame.links.includes(target)) frame.links.push(target);
          if (!frame.linkEvidence?.some(edge => edge.target === target && edge.kind === 'guard')) frame.linkEvidence?.push({ target, file: layout.file, kind: 'guard' });
        }
      }
    }
  }
  for (const frame of frames) if (frame.guardTransitions?.length) {
    frame.notes = frame.notes.replace('Completion may change app state without an explicit route call; its destination is not inferred.', 'Completion follows the root route guard.').replace(/ Opens: .*$/, '') + ` Conditional flow: ${[...new Set(frame.guardTransitions.map(edge => `${edge.target} (${edge.condition})`))].join('; ')}. Opens: ${frame.links.join(', ')}.`;
  }
}
