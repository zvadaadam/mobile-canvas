import {writeXcodeProject} from './standalone';
import {writeDerivedXcodeProject, readAppInfo} from './xcode-build';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, cp, symlink, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { repository } from '../../paths';
import { nativeAppPath, signingTeam } from '../../installation';
import { swiftInputFiles } from './project';
import {compileSwiftPreviews} from './compile';
import type { Session } from '../../../shared/model';
const exec = promisify(execFile);
async function writeChanged(path:string,bytes:string|Buffer) {
  const next=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const previous=await readFile(path).catch(error=>{if(error.code==='ENOENT') return null;throw error;});
  if(!previous?.equals(next)) await writeFile(path,next);
}
export const swiftHostPaths = (project: string) => ({host:join(project,'.expo-canvas/swift-host'),output:join(project,'.expo-canvas/swift-build')});

/** Build real app previews for supported targets, or a source-map-only native shell. */
export async function prepareSwiftHost(session: Session, signal?: AbortSignal) {
  const spec = session.project.document.nativePreview!;
  const app = session.project.document.origin!.path;
  const {host,output} = swiftHostPaths(session.directory);
  const team = await signingTeam(session.directory);
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) throw new Error('Run expo-canvas setup to choose a development signing team.');
  const inputs = await swiftInputFiles(app,spec);
  const catalogOnly = !!spec.buildIssues?.length;
  const shellNames = ['CanvasHost.swift','CanvasInspector.swift','CanvasRenderer.swift'];
  const shell = await Promise.all(shellNames.map(async name=>({name,bytes:await readFile(join(repository,'apps/native-host/native',name))})));
  shell.push({name:'SwiftRenderer.swift',bytes:await readFile(join(repository,'apps/swift-host/SwiftRenderer.swift'))});
  shell.push({name:'DeviceCapabilities.swift',bytes:await readFile(join(repository,'apps/swift-host/DeviceCapabilities.swift'))});
  shell.push({name:'PreviewImages.swift',bytes:await readFile(join(repository,'apps/swift-host/PreviewImages.swift'))});
  const version = (await exec('xcodebuild',['-version'])).stdout;
  const fingerprint = createHash('sha256').update(JSON.stringify({nativeVersion:session.nativeVersion,version,team}));
  for(const file of shell) fingerprint.update(file.bytes);
  fingerprint.update(await readFile(join(repository,'src/runtime/adapters/swift/build.ts')));
  fingerprint.update(await readFile(join(repository,'src/runtime/adapters/swift/Scan.swift')));
  fingerprint.update(await readFile(join(repository,'src/runtime/adapters/swift/recipes.ts')));
  fingerprint.update(await readFile(join(repository,'src/runtime/adapters/swift/projection.ts')));
  for (const file of ['standalone.ts','xcode-build.ts','project.ts','compile.ts','providers.ts','scenes.ts']) fingerprint.update(await readFile(join(repository,'src/runtime/adapters/swift',file)));
  const key=fingerprint.digest('hex');
  const previous=JSON.parse(await readFile(join(output,'build.json'),'utf8').catch(()=>'{}'));
  if(previous.fingerprint===key && await access(previous.app).then(()=>true,()=>false)) return {host,output};
  await mkdir(host,{recursive:true}); await mkdir(output,{recursive:true});
  const sourceFiles: string[]=[];
  const resourceFiles: string[]=[];
  for (const [original, override] of Object.entries(spec.overrides)) {
    const input = inputs.find(x=>x.path===original);
    if (input) input.bytes = await readFile(await import('../../paths').then(m=>m.projectPath(session.directory,override)));
  }
  const swiftInputs = inputs.filter(x=>!catalogOnly && spec.files.includes(x.path)).map(x=>({path:x.path,code:x.bytes.toString('utf8')}));
  const requested = new Set<string>(Object.values(session.project.document.screens).map(s => (s.props.native as any)?.factory).filter(Boolean));
  const {scanned, factories, initialize} = await compileSwiftPreviews(swiftInputs, requested, catalogOnly ? 'isolated' : spec.context);
  for(const file of catalogOnly ? [] : inputs) {
    const dest=join(host,'inputs',file.path); await mkdir(dirname(dest),{recursive:true});
    const scan=scanned.find(x=>x.path===file.path);
    await writeChanged(dest,scan?.compiledSource??file.bytes);
    if(scan) sourceFiles.push(dest);
  }
  for(const name of catalogOnly ? [] : spec.resources) resourceFiles.push(join(host,'inputs',name));
  for(const file of shell) { const dest=join(host,file.name); await writeChanged(dest,file.bytes);sourceFiles.push(dest); }
  for(const name of ['ExpoWordmark.imageset','InterMedium.dataset']) {
    const dest=join(host,'CanvasAssets.xcassets',name);await cp(join(repository,'apps/native-host/assets',name),dest,{recursive:true});
  }
  resourceFiles.push(join(host,'CanvasAssets.xcassets'));
  const registry=join(host,'Registry.swift');
  await writeFile(registry,`import UIKit\n@MainActor enum CanvasSwiftRegistry {\nstatic let nativeVersion = ${JSON.stringify(session.nativeVersion)}\nprivate static var application: Any?\nstatic func initializeApplication() { ${initialize ? `if application == nil { application = ${initialize}() }` : ''} }\nstatic let factories: [String: @MainActor (CanvasPreviewContext) -> UIViewController] = [\n${factories.length ? factories.map(p=>`${JSON.stringify(p.factory)}: ${p.factory}`).join(',\n') : ':'}\n]\n}\n`);
  sourceFiles.push(registry);
  const bundleId='dev.expocanvas.swift.p'+createHash('sha256').update(session.directory).digest('hex').slice(0,12);
  const appInfo = !catalogOnly && spec.buildStrategy === 'xcode' ? await readAppInfo(app,spec) : {};
  const info={...appInfo, CFBundleIdentifier:bundleId,CFBundleExecutable:'CanvasSwift',CFBundleName:'CanvasSwift',CFBundlePackageType:'APPL',CFBundleVersion:'1',CFBundleShortVersionString:'1.0',LSRequiresIPhoneOS:true,
    UISupportsTrueScreenSizeOnMac:true, UIApplicationSupportsIndirectInputEvents:true,
    UISupportedInterfaceOrientations:['UIInterfaceOrientationPortrait','UIInterfaceOrientationPortraitUpsideDown','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],
    UILaunchScreen:{},
    UIApplicationSceneManifest:{UIApplicationSupportsMultipleScenes:false,UISceneConfigurations:{UIWindowSceneSessionRoleApplication:[{UISceneConfigurationName:'Canvas',UISceneDelegateClassName:'$(PRODUCT_MODULE_NAME).CanvasSceneDelegate'}]}}};
  await writeFile(join(host,'Info.plist'),JSON.stringify(info));
  await exec('plutil',['-convert','xml1',join(host,'Info.plist')]);
  const build = !catalogOnly && spec.buildStrategy === 'xcode'
    ? await writeDerivedXcodeProject({app,spec,host,sourceFiles:sourceFiles.filter(file=>!file.startsWith(join(host,'inputs')+'/')),resourceFiles:[join(host,'CanvasAssets.xcassets')],team,bundleId})
    : (await writeXcodeProject(host,sourceFiles,resourceFiles,team,bundleId), {project:join(host,'CanvasSwift.xcodeproj'),scheme:'CanvasSwift'});
  const args=['-project',build.project,'-scheme',build.scheme,'-configuration','Debug','-destination','platform=macOS,variant=Designed for iPad','-derivedDataPath',join(output,'DerivedData'),'-clonedSourcePackagesDirPath',join(output,'SourcePackages'),'-allowProvisioningUpdates','-allowProvisioningDeviceRegistration','-jobs','4','build'];
  const log=join(output,'build.log');
  console.log('Building Swift native previews…');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('xcodebuild',args,{cwd:host,signal,stdio:['ignore','pipe','pipe']});
    let text='';child.stdout.on('data',x=>{text+=x;});child.stderr.on('data',x=>{text+=x;});
    child.on('error',reject);child.on('close',async code=>{await writeFile(log,text);code===0?resolve():reject(new Error(`Swift build failed. ${text.split('\n').filter(x=>x.includes('error:')).slice(0,5).join('\n')} See ${log}`));});
  });
  signal?.throwIfAborted();
  const built=join(output,'DerivedData/Build/Products/Debug-iphoneos/CanvasSwift.app');
  const wrapper=nativeAppPath(output);
  await rm(wrapper,{recursive:true,force:true});await mkdir(join(wrapper,'Wrapper'),{recursive:true});
  await cp(built,join(wrapper,'Wrapper/CanvasSwift.app'),{recursive:true});
  await symlink('Wrapper/CanvasSwift.app',join(wrapper,'WrappedBundle'));
  await writeFile(join(output,'build.json'),JSON.stringify({app:wrapper,bundleId,executable:'CanvasSwift',adapter:'swift-ios',context:catalogOnly?'isolated':spec.context??'isolated',applicationInitializer:initialize??null,buildStrategy:catalogOnly?'catalog':spec.buildStrategy??'standalone',target:spec.target,buildNotes:spec.buildNotes??[],nativeVersion:session.nativeVersion,fingerprint:key,builtAt:new Date().toISOString()}));
  return {host,output};
}

export {writeXcodeProject} from './standalone';
