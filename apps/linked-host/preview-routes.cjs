// Transforms only the linked app's preview bundle. The app's files/build stay untouched.
module.exports = function({ types: t }) {
  const imported = (scope, local, name) => {
    const binding = scope.getBinding(local);
    return binding?.path.isImportSpecifier() && binding.path.parent.source.value === 'expo-router'
      && (binding.path.node.imported.name || binding.path.node.imported.value) === name;
  };
  const router = (scope, node) => {
    if (!t.isIdentifier(node)) return false;
    if (imported(scope, node.name, 'router')) return true;
    const binding = scope.getBinding(node.name);
    const init = binding?.path.isVariableDeclarator() && binding.path.node.init;
    return t.isCallExpression(init) && t.isIdentifier(init.callee) && imported(binding.path.scope, init.callee.name, 'useRouter');
  };
  // Read a destination expression only. Never evaluate arbitrary functions,
  // assignments, event-dependent handlers, or multi-statement press callbacks.
  const readable = (node, scope) => {
    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isIdentifier(node)) return true;
    if (t.isTemplateLiteral(node)) return node.expressions.every(value => readable(value, scope));
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node))
      return readable(node.object, scope) && (!node.computed || t.isStringLiteral(node.property) || t.isNumericLiteral(node.property));
    if (t.isObjectExpression(node)) return node.properties.every(value => t.isObjectProperty(value) && !value.computed && readable(value.value, scope));
    if (t.isArrayExpression(node)) return node.elements.every(value => value && readable(value, scope));
    if (t.isConditionalExpression(node)) return readable(node.test, scope) && readable(node.consequent, scope) && readable(node.alternate, scope);
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) return readable(node.left, scope) && readable(node.right, scope);
    if (t.isTSAsExpression(node) || t.isTSNonNullExpression(node)) return readable(node.expression, scope);
    return t.isCallExpression(node) && t.isIdentifier(node.callee) && ['encodeURIComponent', 'encodeURI', 'String'].includes(node.callee.name)
      && !scope.getBinding(node.callee.name) && node.arguments.every(value => readable(value, scope));
  };
  const helper = (path, state, name, module = 'expo-canvas-route-observer') => {
    state.canvasHelpers ??= {};
    if (!state.canvasHelpers[name]) {
      const program = path.findParent(parent => parent.isProgram());
      const id = program.scope.generateUidIdentifier(name);
      program.unshiftContainer('body', t.importDeclaration([t.importSpecifier(id, t.identifier(name))], t.stringLiteral(module)));
      state.canvasHelpers[name] = id;
    }
    return t.cloneNode(state.canvasHelpers[name]);
  };
  const observeNavigator = (element, state) => {
    const config = state.opts.app ? state.opts : require('./canvas-host.json');
    const file = state.filename.slice(config.app.length + 1);
    const gate = config.guards?.find(gate => gate.file === file);
    if (!gate || !state.filename.startsWith(config.app + '/')) return;
    // Observe once per enclosing navigator render, before JSX forces guards open.
    state.canvasGuardFunctions ??= new Set();
    const functions = state.canvasGuardFunctions;
      const name = element.node.name;
      if (!t.isJSXMemberExpression(name) || name.property.name !== 'Protected') return;
      const fn = element.getFunctionParent();
      if (!fn || functions.has(fn.node) || !t.isBlockStatement(fn.node.body) || !gate.atoms.every(atom => fn.scope.hasBinding(atom))) return;
      functions.add(fn.node);
      const observe = helper(element, state, 'observeGuardValues', 'expo-canvas-guard-preview');
      // Put observation immediately before the function's own return, after its declarations.
      fn.traverse({ ReturnStatement(ret) {
        if (ret.getFunctionParent() !== fn) return;
        ret.insertBefore(t.expressionStatement(t.callExpression(observe, [t.stringLiteral(file), t.objectExpression(gate.atoms.map(atom => t.objectProperty(t.identifier(atom), t.unaryExpression('!', t.unaryExpression('!', t.identifier(atom)))))), t.objectExpression(gate.atoms.map(atom => {
          const binding = fn.scope.getBinding(atom);
          const names = new Set();
          if (binding?.path.isVariableDeclarator()) binding.path.get('init').traverse({ ReferencedIdentifier(ref) { if (ref.scope.hasBinding(ref.node.name) && ref.node.name !== atom) names.add(ref.node.name); } });
          return t.objectProperty(t.identifier(atom), t.arrayExpression([...names].map(name => t.conditionalExpression(t.binaryExpression('===', t.unaryExpression('typeof', t.identifier(name)), t.stringLiteral('object')), t.nullLiteral(), t.conditionalExpression(t.binaryExpression('===', t.unaryExpression('typeof', t.identifier(name)), t.stringLiteral('function')), t.nullLiteral(), t.identifier(name))))));
        }))])));
      } });
  };
  return { visitor: { ReturnStatement(path, state) {
    const config = state.opts.app ? state.opts : require('./canvas-host.json');
    const file = state.filename.slice(config.app.length + 1);
    if (!state.filename.startsWith(config.app + '/') || !config.routeFiles?.includes(file)) return;
    const fn = path.getFunctionParent();
    if (!fn || !fn.isFunctionDeclaration()) return;
    const program = fn.findParent(parent => parent.isProgram());
    const exported = fn.parentPath.isExportDefaultDeclaration() || (fn.node.id && program.node.body.some(node => t.isExportDefaultDeclaration(node) && t.isIdentifier(node.declaration, { name: fn.node.id.name })));
    if (!exported || path.node.canvasObserved) return;
    path.node.canvasObserved = true;
    path.node.argument = t.callExpression(helper(path, state, 'observeRouteOutput'), [path.node.argument || t.identifier('undefined'), t.stringLiteral(file)]);
  }, VariableDeclarator(path, state) {
    const config = state.opts.app ? state.opts : require('./canvas-host.json');
    const file = state.filename.slice(config.app.length + 1);
    const pager = config.pagers?.find(pager => pager.file === file);
    if (!pager || !state.filename.startsWith(config.app + '/')) return;
    const init = path.node.init;
    if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)) return;
    const binding = t.isIdentifier(path.node.id) ? path.node.id.name : t.isArrayPattern(path.node.id) && t.isIdentifier(path.node.id.elements[1]) ? path.node.id.elements[1].name : null;
    if (binding === pager.transition && init.callee.name === 'useCallback') {
      const callback = init.arguments[0];
      if (!t.isArrowFunctionExpression(callback) || !t.isBlockStatement(callback.body) || callback.params.length !== 1 || !t.isIdentifier(callback.params[0])) return;
      callback.body.body.unshift(t.ifStatement(t.callExpression(helper(path, state, 'navigatePager', 'expo-canvas-pager-preview'), [t.cloneNode(callback.params[0]), t.stringLiteral(file)]), t.returnStatement()));
    }
    if ((binding === pager.setter && init.callee.name === 'useState') || (pager.refs.includes(binding) && init.callee.name === 'useRef') || (pager.shared.includes(binding) && init.callee.name === 'useSharedValue')) {
      init.arguments[0] = t.callExpression(helper(path, state, 'pagerInitial', 'expo-canvas-pager-preview'), [init.arguments[0], t.stringLiteral(file), t.stringLiteral(binding)]);
    }
  }, ImportDeclaration(path, state) {
    const config = state.opts.app ? state.opts : require('./canvas-host.json');
    if (!config.design || !state.filename.startsWith(config.app + '/')) return;
    if (!['@hugeicons-pro/core-stroke-rounded', '@hugeicons-pro/core-solid-rounded'].includes(path.node.source.value)) return;
    if (!path.node.specifiers.length || !path.node.specifiers.every(specifier => t.isImportSpecifier(specifier))) return;
    // Import only the icons used by this file, keeping thousands of unused
    // public icons out of every isolated native runtime.
    path.replaceWithMultiple(path.node.specifiers.map(specifier => t.importDeclaration(
      [t.importDefaultSpecifier(t.cloneNode(specifier.local))],
      t.stringLiteral('@hugeicons/core-free-icons/' + (specifier.imported.name || specifier.imported.value)))));
  }, JSXOpeningElement(path, state) {
    observeNavigator(path, state);
    const { app } = state.opts.app ? state.opts : require('./canvas-host.json');
    if (!state.filename.startsWith(app + '/')) return;
    const file = t.stringLiteral(state.filename.slice(app.length + 1));
    const name = path.node.name;
    if (t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.object) && name.property.name === 'Protected') {
      const binding = path.scope.getBinding(name.object.name);
      if (binding?.path.isImportSpecifier() && binding.path.parent.source.value.startsWith('expo-router')) {
        const guard = path.node.attributes.find(attr => t.isJSXAttribute(attr) && attr.name.name === 'guard');
        if (guard) guard.value = t.jsxExpressionContainer(t.booleanLiteral(true));
      }
    }
    for (const attr of path.node.attributes) {
      if (!t.isJSXAttribute(attr)) continue;
      if (attr.name.name === 'href' && t.isJSXIdentifier(name) && imported(path.scope, name.name, 'Link')) {
        const expression = t.isStringLiteral(attr.value) ? attr.value : t.isJSXExpressionContainer(attr.value) ? attr.value.expression : null;
        if (expression && !t.isJSXEmptyExpression(expression))
          attr.value = t.jsxExpressionContainer(t.callExpression(helper(path, state, 'observeHref'), [expression, file]));
      }
      if (attr.name.name !== 'onPress' || !t.isJSXExpressionContainer(attr.value)) continue;
      const handler = attr.value.expression;
      if (!t.isArrowFunctionExpression(handler) || handler.async || handler.params.length) continue;
      let call = handler.body;
      if (t.isBlockStatement(call)) {
        if (call.body.length !== 1) continue;
        const statement = call.body[0];
        call = t.isExpressionStatement(statement) ? statement.expression : t.isReturnStatement(statement) ? statement.argument : null;
      }
      if (!t.isCallExpression(call) || !t.isMemberExpression(call.callee) || call.callee.computed
        || !router(path.scope, call.callee.object) || !['push', 'navigate', 'replace'].includes(call.callee.property.name)
        || call.arguments.length !== 1 || !readable(call.arguments[0], path.scope)) continue;
      attr.value.expression = t.callExpression(helper(path, state, 'observePress'), [handler, t.arrowFunctionExpression([], t.cloneNode(call.arguments[0], true)), file]);
    }
  } } };
};
