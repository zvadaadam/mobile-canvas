const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { repository, app, project, frameMMKV } = require('./canvas-host.json');
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'expo-canvas.json'), 'utf8'));
const config = getDefaultConfig(__dirname);
config.cacheVersion = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'preview-routes.cjs'))).update(JSON.stringify({ pagers: require('./canvas-host.json').pagers, guards: require('./canvas-host.json').guards, routeFiles: require('./canvas-host.json').routeFiles })).digest('hex');
config.watchFolders = [app, project, path.join(repository, 'packages/preview')];
config.resolver.disableHierarchicalLookup = false;
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
const aliases = Object.entries(manifest.document?.resolver?.aliases ?? {}).sort(([a], [b]) => b.length - a.length);
const design = manifest.document?.appPreview?.offline;
const { adapters, iconPackages } = require('./design/environment.cjs');
const publicIcons = new Map();
if (design && fs.existsSync(path.join(__dirname, 'node_modules/@hugeicons/core-free-icons'))) {
  const directory = path.join(__dirname, 'node_modules/@hugeicons/core-free-icons/dist/esm');
  for (const match of fs.readFileSync(path.join(directory, 'index.js'), 'utf8').matchAll(/export \{([^}]+)\} from ['"]([^'"]+)['"]/g)) {
    for (const exported of match[1].matchAll(/default as (\w+)/g)) publicIcons.set(exported[1], path.resolve(directory, match[2]));
  }
}
const overrides = manifest.document?.resolver?.modules ?? {};
config.resolver.resolveRequest = (context, name, platform) => {
  if (design && adapters[name]) return { type: 'sourceFile', filePath: path.join(__dirname, 'design', adapters[name]) };
  if (design && iconPackages.some(pkg => name === pkg || name.startsWith(pkg + '/'))) {
    const pkg = iconPackages.find(pkg => name === pkg || name.startsWith(pkg + '/'));
    const subpath = name.slice(pkg.length);
    name = '@hugeicons/core-free-icons' + subpath;
  }
  if (design && name.startsWith('@hugeicons/core-free-icons/')) {
    const filePath = publicIcons.get(name.slice('@hugeicons/core-free-icons/'.length));
    if (filePath) return { type: 'sourceFile', filePath };
  }
  if (name === 'expo-canvas-original-mmkv') return context.resolveRequest({ ...context, originModulePath: path.join(__dirname, 'index.tsx') }, 'react-native-mmkv', platform);
  if (frameMMKV && name === 'react-native-mmkv') return { type: 'sourceFile', filePath: path.join(__dirname, 'MMKV.ts') };
  if (name === 'expo-canvas-route-observer') return { type: 'sourceFile', filePath: path.join(__dirname, 'RouteObserver.ts') };
  if (name === 'expo-canvas-guard-preview') return { type: 'sourceFile', filePath: path.join(__dirname, 'GuardPreview.ts') };
  if (name === 'expo-canvas-pager-preview') return { type: 'sourceFile', filePath: path.join(__dirname, 'PagerPreview.ts') };
  if (name === 'expo-canvas-original-on-action') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules/expo-router/build/react-navigation/core/useOnAction.js') };
  if (name === 'expo-canvas-native-dimensions') return { type: 'sourceFile', filePath: path.join(__dirname, 'node_modules/react-native/Libraries/Utilities/Dimensions.js') };
  if (name === 'expo-canvas-screens') return { type: 'sourceFile', filePath: path.join(project, '.expo-canvas/registry.ts') };
  if (name === '@expo-canvas/preview') return { type: 'sourceFile', filePath: path.join(repository, 'packages/preview/index.tsx') };
  if (name === 'expo-canvas-linked-app') return { type: 'sourceFile', filePath: path.join(__dirname, 'LinkedApp.tsx') };
  if (name === 'expo-canvas-route-context') return { type: 'sourceFile', filePath: path.join(project, '.expo-canvas/route-context.ts') };
  const own = (context.originModulePath.startsWith(app + '/') || context.originModulePath.startsWith(project + '/')) && !context.originModulePath.includes('/node_modules/');
  if (own) {
    if (overrides[name] && !name.match(/\.tsx?$/) && context.originModulePath !== path.join(project, overrides[name]))
      return { type: 'sourceFile', filePath: path.join(project, overrides[name]) };
    for (const [prefix, directory] of aliases) if (name.startsWith(prefix)) { name = path.join(path.isAbsolute(directory) ? directory : path.join(project, directory), name.slice(prefix.length)); break; }
  }
  const bare = !name.startsWith('.') && !path.isAbsolute(name);
  const fromHost = context.originModulePath.startsWith(__dirname + '/');
  const result = context.resolveRequest(bare && !fromHost ? { ...context, originModulePath: path.join(__dirname, 'index.tsx') } : context, name, platform);
  if (result.type === 'sourceFile' && result.filePath === path.join(__dirname, 'node_modules/expo-router/build/react-navigation/core/useOnAction.js'))
    return { type: 'sourceFile', filePath: path.join(__dirname, 'FrameNavigation.ts') };
  if (result.type === 'sourceFile' && result.filePath === path.join(__dirname, 'node_modules/react-native/Libraries/Utilities/Dimensions.js') && context.originModulePath !== path.join(__dirname, 'FrameDimensions.ts'))
    return { type: 'sourceFile', filePath: path.join(__dirname, 'FrameDimensions.ts') };
  if (result.type === 'sourceFile' && result.filePath === path.join(__dirname, 'node_modules/expo-sqlite/build/ExpoSQLite.js'))
    return { type: 'sourceFile', filePath: path.join(__dirname, 'SQLite.ts') };
  if (result.type === 'sourceFile' && result.filePath.startsWith(app + '/')) {
    const relative = path.relative(app, result.filePath);
    if (overrides[relative]) return { type: 'sourceFile', filePath: path.join(project, overrides[relative]) };
  }
  return result;
};
module.exports = config;
