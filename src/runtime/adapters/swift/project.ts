import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { projectPath } from '../../paths';
const run = promisify(execFile);
import { SwiftProjectSchema, type SwiftProject } from '../../../shared/native';

export function appBuildPath(app:string, projectFile:string, value:string) {
  const root=dirname(dirname(resolve(app,projectFile)));
  const expanded=value.replace(/\$\((?:SRCROOT|PROJECT_DIR)\)|\$\{(?:SRCROOT|PROJECT_DIR)\}/g,root);
  if (expanded.includes('$')) throw new Error(`Unresolved Xcode build path: ${value}`);
  return relative(app,resolve(root,expanded));
}

export async function swiftProjectCandidates(app: string) {
  const result: string[] = [];
  for (const folder of ['', 'ios']) {
    for (const name of await readdir(join(app, folder)).catch(() => []))
      if (name.endsWith('.xcodeproj')) result.push([folder, name, 'project.pbxproj'].filter(Boolean).join('/'));
  }
  return result.sort();
}

/** Read Xcode's plist only; does not invoke a target, build phase or app config. */
export async function loadSwiftProject(app: string): Promise<SwiftProject> {
  const candidates = await swiftProjectCandidates(app);
  if (candidates.length !== 1) throw new Error(`Choose an app root with exactly one Xcode project (found ${candidates.length}).`);
  const projectFile = candidates[0];
  const file = await projectPath(app, projectFile);
  const pbx = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', file])).stdout);
  const objects = pbx.objects;
  const targets = Object.values(objects).filter((o: any) => o.isa === 'PBXNativeTarget' && o.productType === 'com.apple.product-type.application') as any[];
  if (targets.length !== 1) throw new Error('Swift preview needs one unambiguous iOS application target.');
  const target = targets[0];
  const buildIssues: string[] = [], buildNotes: string[] = [];
  const buildInputs = new Set<string>();
  let usesXcode = false;
  const products = (target.packageProductDependencies ?? []).map((id: string) => objects[id]?.productName ?? id);
  if (products.length) usesXcode = true;
  for (const ref of Object.values(objects) as any[]) if (ref.isa === 'XCLocalSwiftPackageReference') buildIssues.push('Local Swift package references require an explicit build integration.');
  for (const id of target.dependencies ?? []) {
    const dependency = objects[objects[id]?.target];
    if (dependency?.productType === 'com.apple.product-type.app-extension') {
      usesXcode = true; buildNotes.push(`Preview target omits embedded extension ${dependency.name}.`);
    } else buildIssues.push(`Unsupported target dependency: ${dependency?.name ?? 'external target'}.`);
  }
  const paths = new Map<string, string>();
  const projectDirectory = dirname(dirname(file));
  function walk(id: string, directory: string) {
    const object = objects[id];
    if (!object) return;
    if (object.sourceTree === '<absolute>' && /^\/System\/Library\/Frameworks\/[^/]+\.framework$/.test(object.path ?? '')) return;
    if (!['<group>', '<absolute>', 'SOURCE_ROOT', undefined].includes(object.sourceTree)) return;
    const base = object.sourceTree === 'SOURCE_ROOT' ? projectDirectory : directory;
    const path = object.path ? resolve(base, object.path) : base;
    paths.set(id, path);
    for (const child of object.children ?? []) walk(child, path);
  }
  walk(objects[pbx.rootObject].mainGroup, projectDirectory);
  const files: string[] = [], resources: string[] = [];
  for (const phaseId of target.buildPhases) {
    const phase = objects[phaseId];
    if (phase.isa === 'PBXShellScriptBuildPhase' || phase.isa === 'PBXCopyFilesBuildPhase') {
      usesXcode = true;
      if (phase.isa === 'PBXCopyFilesBuildPhase' && String(phase.dstSubfolderSpec) === '13') buildNotes.push(`Preview target omits ${phase.name ?? 'extension embedding'}.`);
      else if (phase.isa === 'PBXShellScriptBuildPhase' && /Crashlytics\/run/.test(phase.shellScript ?? '')) buildNotes.push(`Preview target omits symbol upload: ${phase.name ?? 'Crashlytics'}.`);
      else buildIssues.push(`Build phase requires integration: ${phase.name ?? phase.isa}. No app scripts or copy phases were run.`);
      continue;
    }
    for (const ref of phase.files ?? []) {
      const buildFile = objects[ref];
      const path = paths.get(buildFile.fileRef);
      if (phase.isa === 'PBXFrameworksBuildPhase') {
        const framework = objects[buildFile.fileRef];
        if (!buildFile.productRef && framework?.sourceTree !== 'SDKROOT') {
          if (framework?.sourceTree === 'DEVELOPER_DIR' && /\/System\/Library\/Frameworks\/[^/]+\.framework$/.test(framework.path ?? '')) usesXcode = true;
          else buildIssues.push(`Unsupported custom framework: ${framework?.name ?? framework?.path ?? 'unresolved framework'}.`);
        }
        continue;
      }
      if (!path) throw new Error('Unresolved Xcode file reference.');
      const name = relative(app, path);
      await projectPath(app, name);
      if (phase.isa === 'PBXSourcesBuildPhase') {
        if (name.endsWith('.metal')) { usesXcode = true; buildInputs.add(name); }
        else if (!name.endsWith('.swift')) buildIssues.push(`Source requires native build integration: ${name}.`);
        else files.push(name);
      } else if (phase.isa === 'PBXResourcesBuildPhase') resources.push(name);
    }
  }
  const configurationList = objects[target.buildConfigurationList];
  const settings = objects[configurationList.buildConfigurations.find((id: string) => objects[id].name === 'Debug')]?.buildSettings ?? {};
  if (settings.SWIFT_OBJC_BRIDGING_HEADER) buildIssues.push('A bridging header requires an explicit native build integration.');
  if (usesXcode) {
    buildNotes.push('Preview uses a separate bundle identity without the original entitlements. Canvas owns the window and delegate lifecycle.');
    // Only project-owned file references are copied. SDK and product references
    // remain Xcode references; no discovery step resolves or executes packages.
    for (const [id, path] of paths) if (objects[id].isa === 'PBXFileReference') {
      const name = relative(app, path);
      await projectPath(app, name);
      if (await stat(path).then(() => true, () => false)) buildInputs.add(name);
    }
    const info=typeof settings.INFOPLIST_FILE==='string' ? appBuildPath(app,projectFile,settings.INFOPLIST_FILE) : undefined;
    for (const name of [join(dirname(projectFile), 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved'), info]) {
      if (typeof name !== 'string' || name.includes('$')) continue;
      if (await stat(await projectPath(app,name)).then(() => true, () => false)) buildInputs.add(name);
    }
  }
  return SwiftProjectSchema.parse({adapter: 'swift-ios', files: [...new Set(files)].sort(), resources: [...new Set(resources)].sort(), projectFile, target: target.name,
    ...(usesXcode ? {buildStrategy:'xcode', buildInputs:[...buildInputs].sort(), buildNotes} : {}),
    ...(buildIssues.length ? {buildIssues:[...new Set(buildIssues)]} : {})});
}

function swiftInputPaths(spec: SwiftProject): string[] {
  return [...new Set([...spec.files, ...spec.resources, ...(spec.buildInputs ?? []), ...(spec.projectFile ? [spec.projectFile] : [])])];
}

/** Resource directories contain build inputs too: changing image bytes or Metal
 * source must invalidate the native binary just like changing Swift source. */
export function isSwiftInput(spec: SwiftProject, path: string): boolean {
  return swiftInputPaths(spec).some(input => path === input || path.startsWith(input + '/'));
}

export async function swiftInputFiles(app: string, spec: SwiftProject, options: {allowMissing?: boolean} = {}): Promise<{path: string; bytes: Buffer}[]> {
  const result: {path: string; bytes: Buffer}[] = [];
  for (const resource of swiftInputPaths(spec)) {
    try {
      const path = await projectPath(app, resource);
      const entries = await readdir(path, {recursive: true, withFileTypes: true}).catch((error) => { if (error.code === 'ENOTDIR') return null; throw error; });
      if (entries === null) result.push({path: resource, bytes: await readFile(path)});
      else for (const entry of entries.filter(x => x.isFile() || x.isSymbolicLink())) {
        const name = relative(app, join(entry.parentPath, entry.name));
        result.push({path: name, bytes: await readFile(await projectPath(app, name))});
      }
    } catch (error) {
      // Deleted sources must invalidate previews without preventing a target
      // refresh. Native builds remain strict about every required input.
      if (!options.allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return [...new Map(result.map(input => [input.path,input])).values()].sort((a,b) => a.path.localeCompare(b.path));
}
