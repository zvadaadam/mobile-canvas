import ts from 'typescript';
import { relative, sep } from 'node:path';
import type { RoutePager } from '../../../shared/routes';

type Reader = (file: string) => Promise<string>;
type Resolver = (file: string, specifier: string) => string | null;
const unwrap = (node: ts.Expression): ts.Expression => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
const nodes = (root: ts.Node) => { const result: ts.Node[] = []; const visit = (node: ts.Node) => { result.push(node); ts.forEachChild(node, visit); }; visit(root); return result; };
const property = (node: ts.Node) => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;

/** Recognize a finite, declarative pager, not arbitrary application state.
 * The ordered keys, component registry, selected index, visited-page bound,
 * transition and animation/ref initializers must all agree before splitting.
 */
export async function discoverPager(app: string, route: string, read: Reader, resolve: Resolver): Promise<RoutePager | undefined> {
  const module = async (file: string) => ts.createSourceFile(file, await read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let file = route, source = await module(file);
  // Route files commonly re-export their screen component.
  const seen = new Set<string>();
  while (!seen.has(file)) {
    seen.add(file);
    const exported = source.statements.find(node => ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(item => item.name.text === 'default')) as ts.ExportDeclaration | undefined;
    if (!exported || seen.size > 8) break;
    const target = resolve(file, (exported.moduleSpecifier as ts.StringLiteral).text);
    if (!target) break;
    file = target; source = await module(file);
  }
  const hookSources = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements)
      if (!binding.propertyName) hookSources.set(binding.name.text, statement.moduleSpecifier.text);
  }
  if (['useState', 'useRef', 'useCallback'].some(name => hookSources.get(name) !== 'react') || hookSources.get('useSharedValue') !== 'react-native-reanimated') return undefined;
  const imports = new Map<string, { file: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const target = resolve(file, statement.moduleSpecifier.text);
    if (!target) continue;
    if (statement.importClause.name) imports.set(statement.importClause.name.text, { file: target, name: 'default' });
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) imports.set(binding.name.text, { file: target, name: (binding.propertyName ?? binding.name).text });
  }
  const all = nodes(source);
  const variables = new Map(all.filter(ts.isVariableDeclaration).filter(v => ts.isIdentifier(v.name)).map(v => [(v.name as ts.Identifier).text, v]));
  const array = async (name: string) => {
    let value = variables.get(name)?.initializer;
    if (!value && imports.has(name)) {
      const imported = imports.get(name)!;
      value = nodes(await module(imported.file)).filter(ts.isVariableDeclaration).find(v => ts.isIdentifier(v.name) && v.name.text === imported.name)?.initializer;
    }
    if (!value || !ts.isArrayLiteralExpression(unwrap(value))) return null;
    const entries = (unwrap(value) as ts.ArrayLiteralExpression).elements;
    if (entries.length < 2 || entries.length > 12 || !entries.every(ts.isStringLiteral)) return null;
    const keys = entries.map(v => (v as ts.StringLiteral).text);
    return new Set(keys).size === keys.length && keys.every(key => /^[a-z][a-z0-9-]*$/.test(key)) ? keys : null;
  };
  for (const call of all.filter(ts.isCallExpression)) {
    if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'map' || !ts.isIdentifier(call.expression.expression)) continue;
    const callback = call.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || callback.parameters.length < 2) continue;
    const step = callback.parameters[0].name.getText(source), ordinal = callback.parameters[1].name.getText(source);
    const keys = await array(call.expression.expression.text);
    if (!keys) continue;
    const registryUse = nodes(callback).filter(ts.isElementAccessExpression).find(n => ts.isIdentifier(n.expression) && n.argumentExpression.getText(source) === step);
    if (!registryUse) continue;
    const registry = variables.get(registryUse.expression.getText(source))?.initializer;
    if (!registry || !ts.isObjectLiteralExpression(registry)) continue;
    const pages = new Map(registry.properties.filter(ts.isPropertyAssignment).map(p => [property(p.name), p.initializer.getText(source)]));
    if (!keys.every(key => imports.has(pages.get(key) ?? ''))) continue;
    const equality = nodes(callback).filter(ts.isBinaryExpression).find(n => n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && n.left.getText(source) === ordinal && ts.isIdentifier(n.right));
    const visited = nodes(callback).filter(ts.isBinaryExpression).find(n => n.operatorToken.kind === ts.SyntaxKind.GreaterThanToken && n.left.getText(source) === ordinal && ts.isIdentifier(n.right));
    if (!equality || !visited) continue;
    const selectedName = equality.right.getText(source), visitedName = visited.right.getText(source);
    const state = all.filter(ts.isVariableDeclaration).find(v => ts.isArrayBindingPattern(v.name) && v.name.elements[0] && ts.isBindingElement(v.name.elements[0]) && ts.isObjectBindingPattern(v.name.elements[0].name)
      && v.name.elements[0].name.elements.some(e => e.name.getText(source) === selectedName)
      && v.initializer && ts.isCallExpression(v.initializer) && v.initializer.expression.getText(source) === 'useState');
    if (!state || !ts.isArrayBindingPattern(state.name) || !state.initializer || !ts.isCallExpression(state.initializer)) continue;
    const binding = state.name.elements[0] as ts.BindingElement;
    const fields = (binding.name as ts.ObjectBindingPattern).elements;
    if (fields.length !== 2 || !fields.some(e => e.name.getText(source) === visitedName)) continue;
    const initial = state.initializer.arguments[0];
    if (!initial || !ts.isObjectLiteralExpression(initial) || initial.properties.length !== fields.length || !fields.every(field => initial.properties.some(p => ts.isPropertyAssignment(p) && property(p.name) === (field.propertyName ?? field.name).getText(source))) || !initial.properties.every(p => ts.isPropertyAssignment(p) && ts.isNumericLiteral(p.initializer) && p.initializer.text === '0')) continue;
    const setter = state.name.elements[1].getText(source);
    const transition = [...variables.values()].find(v => v.initializer && ts.isCallExpression(v.initializer) && v.initializer.expression.getText(source) === 'useCallback'
      && v.initializer.arguments[0] && ts.isArrowFunction(v.initializer.arguments[0]) && nodes(v.initializer.arguments[0]).some(n => ts.isCallExpression(n) && n.expression.getText(source) === setter));
    if (!transition || !ts.isIdentifier(transition.name) || !transition.initializer || !ts.isCallExpression(transition.initializer)) continue;
    const fn = transition.initializer.arguments[0] as ts.ArrowFunction;
    if (fn.parameters.length !== 1 || !ts.isIdentifier(fn.parameters[0].name)) continue;
    const next = fn.parameters[0].name.text;
    const advances = nodes(callback).some(n => ts.isCallExpression(n) && n.expression.getText(source) === transition.name.getText(source) && n.arguments.length === 1
      && ts.isBinaryExpression(n.arguments[0]) && n.arguments[0].operatorToken.kind === ts.SyntaxKind.PlusToken && n.arguments[0].left.getText(source) === ordinal && n.arguments[0].right.getText(source) === '1');
    const assignsIndex = nodes(fn).some(n => ts.isPropertyAssignment(n) && property(n.name) === selectedName && n.initializer.getText(source) === next);
    if (!advances || !assignsIndex) continue;
    const refs = nodes(fn).filter(ts.isBinaryExpression).filter(n => n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'current' && n.right.getText(source) === next)
      .map(n => (n.left as ts.PropertyAccessExpression).expression.getText(source));
    const shared = all.filter(ts.isBinaryExpression).filter(n => n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'value'
      && ts.isCallExpression(n.right) && n.right.arguments[0]?.getText(source) === selectedName).map(n => (n.left as ts.PropertyAccessExpression).expression.getText(source));
    if (!refs.length || !shared.length || ![...refs, ...shared].every(name => {
      const init = variables.get(name)?.initializer;
      return init && ts.isCallExpression(init) && ['useRef', 'useSharedValue'].includes(init.expression.getText(source)) && init.arguments[0]?.getText(source) === '0';
    })) continue;
    const steps = await Promise.all(keys.map(async key => {
      const page = imports.get(pages.get(key)!)!;
      const text = await read(page.file);
      const title = /\btitle="([^"]+)"/.exec(text)?.[1] ?? key[0].toUpperCase() + key.slice(1);
      return { key, title, file: relative(app, page.file).split(sep).join('/') };
    }));
    return { file: relative(app, file).split(sep).join('/'), steps, setter, fields: fields.map(e => (e.propertyName ?? e.name).getText(source)), refs, shared, transition: transition.name.text };
  }
  return undefined;
}
