import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const exec=promisify(execFile);

export async function writeXcodeProject(host:string,sources:string[],resources:string[],team:string,bundleId:string) {
  const objects:Record<string,any>={};let count=0;
  const add=(object:any)=>{const id=(++count).toString(16).padStart(24,'0').toUpperCase();objects[id]=object;return id;};
  const buildFiles=(files:string[])=>files.map(path=>add({isa:'PBXBuildFile',fileRef:add({isa:'PBXFileReference',path,sourceTree:'<absolute>',lastKnownFileType:path.endsWith('.swift')?'sourcecode.swift':path.endsWith('.xcassets')?'folder.assetcatalog':'file'})}));
  const sourcesPhase=add({isa:'PBXSourcesBuildPhase',buildActionMask:2147483647,files:buildFiles(sources),runOnlyForDeploymentPostprocessing:0});
  const resourcePhase=add({isa:'PBXResourcesBuildPhase',buildActionMask:2147483647,files:buildFiles(resources),runOnlyForDeploymentPostprocessing:0});
  const product=add({isa:'PBXFileReference',explicitFileType:'wrapper.application',path:'CanvasSwift.app',sourceTree:'BUILT_PRODUCTS_DIR'});
  const products=add({isa:'PBXGroup',children:[product],name:'Products',sourceTree:'<group>'});
  const main=add({isa:'PBXGroup',children:[products,...Object.keys(objects).filter(id=>objects[id].isa==='PBXFileReference'&&id!==product)],sourceTree:'<group>'});
  const settings={SDKROOT:'iphoneos',IPHONEOS_DEPLOYMENT_TARGET:'17.0',SWIFT_VERSION:'6.0',SWIFT_ACTIVE_COMPILATION_CONDITIONS:'DEBUG',SWIFT_OPTIMIZATION_LEVEL:'-Onone',CLANG_ENABLE_MODULES:'YES',PRODUCT_NAME:'CanvasSwift',PRODUCT_BUNDLE_IDENTIFIER:bundleId,INFOPLIST_FILE:join(host,'Info.plist'),GENERATE_INFOPLIST_FILE:'NO',DEVELOPMENT_TEAM:team,CODE_SIGN_STYLE:'Automatic',TARGETED_DEVICE_FAMILY:'1,2',SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD:'YES',ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS:'YES'};
  const config=add({isa:'XCBuildConfiguration',name:'Debug',buildSettings:settings});
  const configs=add({isa:'XCConfigurationList',buildConfigurations:[config],defaultConfigurationName:'Debug',defaultConfigurationIsVisible:0});
  const target=add({isa:'PBXNativeTarget',name:'CanvasSwift',productName:'CanvasSwift',productType:'com.apple.product-type.application',productReference:product,buildConfigurationList:configs,buildPhases:[sourcesPhase,resourcePhase],buildRules:[],dependencies:[]});
  const project=add({isa:'PBXProject',attributes:{LastUpgradeCheck:'2600'},buildConfigurationList:configs,compatibilityVersion:'Xcode 14.0',developmentRegion:'en',knownRegions:['en','Base'],mainGroup:main,productRefGroup:products,projectDirPath:'',projectRoot:'',targets:[target]});
  const directory=join(host,'CanvasSwift.xcodeproj');await mkdir(directory,{recursive:true});
  const path=join(directory,'project.pbxproj');await writeFile(path,JSON.stringify({archiveVersion:'1',objectVersion:'56',classes:{},objects,rootObject:project}));
  await exec('plutil',['-convert','xml1',path]);
}
