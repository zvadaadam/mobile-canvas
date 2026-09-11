const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const project = process.env.EXPO_CANVAS_PROJECT;
if (!project) throw new Error('Open an explicit project with mobile-canvas studio open --project <directory>.');
const root = process.env.EXPO_CANVAS_INSTALLATION || path.resolve(__dirname, '../..');
const rootModules = path.join(root, 'node_modules') + path.sep;
const projectModules = path.join(project, 'node_modules');
// Project-declared resolution is read once per Metro session; reopen the canvas after changing it.
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'expo-canvas.json'), 'utf8'));
const declared = manifest.document?.resolver ?? {};
const origin = manifest.document?.origin ?? null;
// A linked app is read in place: its source root is aliased, chosen files are overridden by app path,
// and its own JavaScript-only packages serve it. Native packages always come from this host.
const linked = origin?.mode === 'linked' ? origin.path : null;
const appModules = linked ? path.join(linked, 'node_modules') : null;
const aliases = Object.entries(declared.aliases ?? {}).sort(([a], [b]) => b.length - a.length)
  .map(([prefix, directory]) => [prefix, path.isAbsolute(directory) ? directory : path.join(project, directory)]);
const substitutions = new Map();
const overrides = new Map();
for (const [key, file] of Object.entries(declared.modules ?? {})) {
  if (/\.tsx?$/.test(key)) { if (linked) overrides.set(path.join(linked, key), path.join(project, file)); }
  else substitutions.set(key, path.join(project, file));
}
const packageName = (name) => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
const jsOnlyCache = new Map();
const jsOnly = (directory) => {
  if (!jsOnlyCache.has(directory)) {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch {}
    const native = entries.some((entry) => (entry.isFile() && entry.name.endsWith('.podspec')) || (entry.isDirectory() && (entry.name === 'ios' || entry.name === 'android')))
      || fs.existsSync(path.join(directory, 'expo-module.config.json'));
    jsOnlyCache.set(directory, !native);
  }
  return jsOnlyCache.get(directory);
};
const packageDirectory = (modulesDirectory, filePath) => {
  const rest = filePath.slice(modulesDirectory.length + 1).split(path.sep);
  return path.join(modulesDirectory, ...(rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)));
};
const extensions = ['.tsx', '.ts', '.ios.tsx', '.ios.ts', '.jsx', '.js'];
/** An override applies after resolution (relative imports too) or when an added file does not exist in the app. */
const resolveWithOverrides = (context, request, platform) => {
  try {
    const result = context.resolveRequest(context, request, platform);
    const override = result.type === 'sourceFile' ? overrides.get(result.filePath) : undefined;
    return override ? { type: 'sourceFile', filePath: override } : result;
  } catch (error) {
    if (linked) {
      const base = path.isAbsolute(request) ? request : path.resolve(path.dirname(context.originModulePath), request);
      for (const candidate of [...extensions.map((ext) => base + ext), ...extensions.map((ext) => path.join(base, 'index' + ext))]) {
        const override = overrides.get(candidate);
        if (override) return { type: 'sourceFile', filePath: override };
      }
    }
    throw error;
  }
};
const config = getDefaultConfig(__dirname);
config.watchFolders = [project, path.join(root, 'packages/preview'), ...(linked ? [linked] : [])];
config.resolver.disableHierarchicalLookup = false;
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), projectModules];
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === 'expo-canvas-screens') return { type: 'sourceFile', filePath: path.join(project, '.expo-canvas/registry.ts') };
  if (name === '@expo-canvas/preview') return { type: 'sourceFile', filePath: path.join(root, 'packages/preview/index.tsx') };
  const inProjectModules = context.originModulePath.startsWith(projectModules + path.sep);
  const inAppModules = !!appModules && context.originModulePath.startsWith(appModules + path.sep);
  const inProject = context.originModulePath.startsWith(project + path.sep) && !inProjectModules;
  const inLinkedApp = !!linked && context.originModulePath.startsWith(linked + path.sep) && !inAppModules;
  const substitute = substitutions.get(name);
  // Substitutions adapt the project's (or linked app's) own code; packages keep their real dependencies. The
  // substituting file itself reaches the real package by its bare name. Metro caches resolutions per origin
  // directory, so such a shim must live alone in its directory (or use a subpath).
  if (substitute && (inProject || inLinkedApp) && context.originModulePath !== substitute) {
    if (!fs.existsSync(substitute)) throw new Error(`Mobile Canvas: expo-canvas.json maps "${name}" to a missing project file: ${path.relative(project, substitute)}`);
    return { type: 'sourceFile', filePath: substitute };
  }
  for (const [prefix, directory] of aliases) {
    if (name.startsWith(prefix)) return resolveWithOverrides(context, path.join(directory, name.slice(prefix.length)), platform);
  }
  const bare = !name.startsWith('.') && !path.isAbsolute(name);
  if (!bare) return resolveWithOverrides(context, name, platform);
  const inHost = context.originModulePath.startsWith(__dirname + path.sep);
  const pkg = packageName(name);
  // Bare imports from project or linked-app code resolve against the host's installed packages, a package
  // copied into the project, or a JavaScript-only package of the linked app. They must never fall through to
  // the repository's other SDK.
  let requestContext = context;
  if (!inHost && !inProjectModules && !inAppModules) {
    if (fs.existsSync(path.join(projectModules, pkg))) requestContext = { ...context, originModulePath: path.join(project, 'expo-canvas.json') };
    else if (appModules && !fs.existsSync(path.join(__dirname, 'node_modules', pkg)) && fs.existsSync(path.join(appModules, pkg)) && jsOnly(path.join(appModules, pkg)))
      requestContext = { ...context, originModulePath: path.join(linked, 'package.json') };
    else requestContext = { ...context, originModulePath: path.join(__dirname, 'index.tsx') };
  }
  const result = context.resolveRequest(requestContext, name, platform);
  if (result.type === 'sourceFile' && result.filePath.startsWith(rootModules))
    throw new Error(`Mobile Canvas: "${name}" is not installed in the native host. Add it to apps/native-host (native modules), copy a JavaScript-only package into this project's node_modules, or map it to a project shim in expo-canvas.json resolver.modules.`);
  if (appModules && result.type === 'sourceFile' && result.filePath.startsWith(appModules + path.sep) && !jsOnly(packageDirectory(appModules, result.filePath)))
    throw new Error(`Mobile Canvas: "${name}" resolved into the linked app's native package ${path.relative(appModules, packageDirectory(appModules, result.filePath))}; native modules must come from the host. Add it to apps/native-host or map a shim in expo-canvas.json resolver.modules.`);
  return result;
};
module.exports = config;
