import {readFile, readdir} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {projectPath} from '../../paths';
import {scanSwift,type SwiftScan} from './scan';
import type {Session} from '../../../shared/model';

export async function readSwiftPreviewCatalog(session:Session) {
  const {nativePreview:spec,origin}=session.project.document;
  if(!spec || !origin) throw new Error('The native preview catalog requires a Swift project.');
  const scans=await scanSwift(await Promise.all(spec.files.map(async path=>({path,code:await readFile(await projectPath(spec.overrides[path]?session.directory:origin.path,spec.overrides[path]??path),'utf8')}))));
  const selected=new Set(Object.values(session.project.document.screens).map(s=>(s.props.native as any)?.previewId));
  return {previews:swiftPreviewCatalog(scans).map(p=>({...p,selected:selected.has(p.factory)})),imageAssets:await swiftImageAssets(origin.path,spec.resources),
    imageFixtures:{supported:'Kingfisher KFImage(url) and KFImage.url(url) in app SwiftUI structs',configuration:'Set screen.props.native.imageFixtures to an object mapping the original URL (or * for this frame) to a bundled asset name. Preserve the other native props.',scope:'Explicit per-frame source substitution; layout and processing remain app-authored. Other image libraries are unchanged.'},
    animationDetection:'Source API evidence only. A preview may require interaction or data before it animates; arbitrary animations are not exhaustively detected.'};
}

/** Evidence is a discovery hint; it does not prove an animation is running. */
export function swiftPreviewCatalog(scans:SwiftScan[]) {
  const motion=new Set(['withAnimation','animation','phaseAnimator','keyframeAnimator','TimelineView','layerEffect','colorEffect','distortionEffect','symbolEffect','repeatForever','CAEmitterLayer','CABasicAnimation','CAKeyframeAnimation','CASpringAnimation']);
  const declarations=scans.flatMap(s=>s.declarations.map(d=>({...d,file:s.path})));
  function inspect(file:string,name:string,seen=new Set<string>()):{file:string;line:number;api:string}[] {
    const matches=declarations.filter(d=>d.name===name || d.symbol===name);
    const view=matches.find(d=>d.file===file) ?? (matches.length===1?matches[0]:undefined);
    if(!view || seen.has(view.file+':'+view.symbol)) return [];
    seen.add(view.file+':'+view.symbol);
    const calls=scans.find(s=>s.path===view.file)!.calls.filter(c=>c.owner===view.symbol && !c.inDestination);
    return calls.flatMap(c=>motion.has(c.name)?[{file:view.file,line:c.line,api:c.name}]:c.constructor?inspect(view.file,c.name,seen):[]);
  }
  return scans.flatMap(s=>s.previews.map(p=>({...p,file:s.path,
    label:p.titled?p.name:basename(s.path,'.swift')+(p.index?` ${p.index+1}`:''),
    animationEvidence:p.references.flatMap(name=>inspect(s.path,name)),
  })));
}

/** Only the target's bundled assets, never downloaded or fabricated pictures. */
export async function swiftImageAssets(app:string,resources:string[]) {
  const assets:{name:string;catalog:string;file:string}[]=[];
  async function walk(relative:string,catalog:string,namespace:string[]) {
    const path=await projectPath(app,relative);
    const contents=JSON.parse(await readFile(join(path,'Contents.json'),'utf8').catch(()=>'{}'));
    if(relative.endsWith('.imageset')) {
      if((contents.images??[]).some((image:any)=>typeof image.filename==='string')) assets.push({name:[...namespace,basename(relative,'.imageset')].join('/'),catalog,file:relative});
      return;
    }
    const prefix=contents.properties?.['provides-namespace']?[...namespace,basename(relative)]:namespace;
    for(const entry of await readdir(path,{withFileTypes:true})) if(entry.isDirectory()) await walk(join(relative,entry.name),catalog,prefix);
  }
  for(const resource of resources.filter(r=>r.endsWith('.xcassets'))) await walk(resource,resource,[]);
  return assets.sort((a,b)=>a.name.localeCompare(b.name)||a.file.localeCompare(b.file));
}
