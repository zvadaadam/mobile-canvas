import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile, mkdir} from 'node:fs/promises';
import {join, dirname, resolve, relative} from 'node:path';
import {createHash} from 'node:crypto';
import type {SwiftProject} from '../../../shared/native';
import {projectPath} from '../../paths';
import {appBuildPath} from './project';
const run=promisify(execFile);

/** Retain app fonts and permission descriptions, replacing only the host's identity and lifecycle. */
export async function readAppInfo(app:string,spec:SwiftProject):Promise<Record<string,unknown>> {
  const pbx=JSON.parse((await run('plutil',['-convert','json','-o','-',await projectPath(app,spec.projectFile!)])).stdout);
  const objects=pbx.objects;
  const target:any=Object.values(objects).find((o:any)=>o.isa==='PBXNativeTarget' && o.name===spec.target);
  const settings=objects[objects[target.buildConfigurationList].buildConfigurations.find((id:string)=>objects[id].name==='Debug')]?.buildSettings ?? {};
  const file=settings.INFOPLIST_FILE;
  if (!file) return {};
  if (typeof file!=='string') throw new Error('The Info.plist build setting needs an explicit path before previewing.');
  return JSON.parse((await run('plutil',['-convert','json','-o','-',await projectPath(app,appBuildPath(app,spec.projectFile!,file))])).stdout);
}

/** Derive an isolated iOS preview target while retaining the original package graph and build settings. */
export async function writeDerivedXcodeProject(input: {
  app:string; spec:SwiftProject; host:string; sourceFiles:string[]; resourceFiles:string[]; team:string; bundleId:string;
}) {
  const {app,spec,host,team,bundleId}=input;
  if (!spec.projectFile || spec.buildIssues?.length) throw new Error('This Xcode target has unresolved build requirements.');
  const original=join(app,spec.projectFile);
  const pbx=JSON.parse((await run('plutil',['-convert','json','-o','-',original])).stdout);
  const objects:Record<string,any>=pbx.objects;
  const project=objects[pbx.rootObject];
  const targetId=project.targets.find((id:string)=>objects[id].name===spec.target && objects[id].productType==='com.apple.product-type.application');
  if (!targetId) throw new Error('The selected Xcode application target changed. Re-import the app.');
  const target=objects[targetId];
  const root=dirname(dirname(original));
  const copyRoot=join(host,'inputs');
  function relocate(id:string,directory:string) {
    const object=objects[id]; if (!object) return;
    if (object.sourceTree === '<absolute>' && /^\/System\/Library\/Frameworks\/[^/]+\.framework$/.test(object.path ?? '')) {
      object.sourceTree='SDKROOT'; object.path=object.path.slice(1); return;
    }
    if (!['<group>','<absolute>','SOURCE_ROOT',undefined].includes(object.sourceTree)) return;
    const base=object.sourceTree==='SOURCE_ROOT' ? root : directory;
    const path=object.path ? resolve(base,object.path) : base;
    if (object.isa==='PBXFileReference') {
      const local=relative(app,path);
      if (local.startsWith('../') || local==='..') throw new Error('Xcode source references outside the app require an explicit integration.');
      object.path=join(copyRoot,local);object.sourceTree='<absolute>';
    }
    for (const child of object.children ?? []) relocate(child,path);
  }
  relocate(project.mainGroup,root);
  for (const object of Object.values(objects)) {
    if (object.isa==='PBXFileReference' && object.sourceTree==='DEVELOPER_DIR') {
      const sdkPath=object.path?.match(/\/System\/Library\/Frameworks\/([^/]+\.framework)$/);
      if (sdkPath) {object.sourceTree='SDKROOT';object.path='System/Library/Frameworks/'+sdkPath[1];}
    }
  }
  const add=(label:string,value:any)=>{
    let id=createHash('sha256').update('Canvas:'+label).digest('hex').slice(0,24).toUpperCase();
    while (objects[id]) id=createHash('sha256').update(id).digest('hex').slice(0,24).toUpperCase();
    objects[id]=value;return id;
  };
  const append=(phaseName:string,files:string[])=>{
    const phase=objects[target.buildPhases.find((id:string)=>objects[id].isa===phaseName)];
    if (!phase) throw new Error(`Missing ${phaseName} in selected target.`);
    for (const path of files) {
      const ref=add(path,{isa:'PBXFileReference',sourceTree:'<absolute>',path,lastKnownFileType:path.endsWith('.swift')?'sourcecode.swift':'folder.assetcatalog'});
      objects[project.mainGroup].children.push(ref);
      phase.files.push(add('build:'+path,{isa:'PBXBuildFile',fileRef:ref}));
    }
  };
  append('PBXSourcesBuildPhase',input.sourceFiles);
  append('PBXResourcesBuildPhase',input.resourceFiles);
  // Discovery has already classified these phases. Do not execute app uploads
  // or embed a widget extension in the independent preview host.
  target.buildPhases=target.buildPhases.filter((id:string)=>!['PBXShellScriptBuildPhase','PBXCopyFilesBuildPhase'].includes(objects[id].isa));
  target.dependencies=[];
  project.targets=[targetId];
  for (const owner of [project,target]) for (const id of objects[owner.buildConfigurationList].buildConfigurations) {
    const settings=objects[id].buildSettings ?? (objects[id].buildSettings={});
    for (const key of Object.keys(settings)) if (/^(CODE_SIGN|PROVISIONING|DEVELOPMENT_TEAM|INFOPLIST|GENERATE_INFOPLIST)/.test(key)) delete settings[key];
    Object.assign(settings,{SDKROOT:'iphoneos',SUPPORTED_PLATFORMS:'iphoneos iphonesimulator',
      TARGETED_DEVICE_FAMILY:'1,2',SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD:'YES',SUPPORTS_MACCATALYST:'NO',
      PRODUCT_NAME:'CanvasSwift',PRODUCT_BUNDLE_IDENTIFIER:bundleId,DEVELOPMENT_TEAM:team,CODE_SIGN_STYLE:'Automatic',
      INFOPLIST_FILE:join(host,'Info.plist'),GENERATE_INFOPLIST_FILE:'NO',
      ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS:'YES'});
  }
  objects[target.productReference].path='CanvasSwift.app';
  const path=join(copyRoot,spec.projectFile);
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(pbx));await run('plutil',['-convert','xml1',path]);
  return {project:dirname(path),scheme:target.name};
}
