import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { buildRouteMap } from '../src/runtime/adapters/expo/frames';
import { observeGuardValues, setGuardPreview, resetGuardPreview } from '../apps/linked-host/GuardPreview';
import { disconnectedSpeechStart } from '../apps/linked-host/design/speech-adapter';
import { containFrameErrors } from '../apps/native-host/frame-errors';

test('root guards connect first-time authentication, returning users and completion without inventing back edges', async t => {
 const app=await realpath(await mkdtemp(join(tmpdir(),'canvas-gates-')));
 t.after(()=>rm(app,{recursive:true,force:true}));
 const write=async(path:string,code:string)=>{await mkdir(join(app,path,'..'),{recursive:true});await writeFile(join(app,path),code)};
 await write('app/_layout.tsx',`import {Stack} from 'expo-router/stack'; export default function Root(){return <Stack><Stack.Protected guard={!signedIn}><Stack.Screen name="sign-in"/></Stack.Protected><Stack.Protected guard={signedIn && !complete}><Stack.Screen name="setup"/></Stack.Protected><Stack.Protected guard={signedIn && complete}><Stack.Screen name="index"/></Stack.Protected></Stack>}`);
 for(const name of ['sign-in','setup','index'])await write(`app/${name}.tsx`,'export default function Screen(){return null}');
 const map=await buildRouteMap({app,routesDirectory:'app',aliases:{}});
 assert.deepEqual(map.frames.find(f=>f.key==='sign-in')?.links,['setup','index']);
 const setup=map.frames.find(f=>f.key==='setup')!;assert.deepEqual(setup.links,['index']);
 assert.equal(setup.linkEvidence?.[0].kind,'guard');
 assert.deepEqual(map.frames.find(f=>f.key==='index')?.links,[]);
 resetGuardPreview();const visits:string[]=[];setGuardPreview(setup.guardTransitions,key=>visits.push(key));
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:false});
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:false});
 assert.equal(visits.length,0,'mounting protected preview never navigates');
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:true});
 await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(visits,['index'],'completion focuses Home even when offline auth differs from the preview guard assumption');
 resetGuardPreview();setGuardPreview(map.frames.find(f=>f.key==='sign-in')!.guardTransitions,key=>visits.push(key));
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:true});observeGuardValues('app/_layout.tsx',{signedIn:true,complete:true});
 await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(visits,['index','index'],'returning users skip setup');
 resetGuardPreview();setGuardPreview(setup.guardTransitions,key=>visits.push(key));
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:true},{complete:[100]});
 observeGuardValues('app/_layout.tsx',{signedIn:false,complete:true},{complete:[101]});
 await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(visits,['index','index','index'],'a repeated completion action still focuses its destination');
 const layout = `import {Stack} from 'expo-router';export const unstable_settings={initialRouteName:'index'};export default ()=> <Stack><Stack.Protected guard={!complete}><Stack.Screen name="setup"/></Stack.Protected><Stack.Protected guard={complete}><Stack.Screen name="index"/></Stack.Protected></Stack>`;
 await write('app/_layout.tsx',layout);
 assert.equal((await buildRouteMap({app,routesDirectory:'app',aliases:{}})).frames.some(f=>f.guardTransitions?.length),false,'explicit initial route policy is not guessed');
 await write('app/_layout.tsx',`import {Stack} from 'expo-router';export default ()=> <Stack><Stack.Protected guard={getAccess()}><Stack.Screen name="setup"/></Stack.Protected><Stack.Protected guard={!complete}><Stack.Screen name="index"/></Stack.Protected></Stack>`);
 assert.equal((await buildRouteMap({app,routesDirectory:'app',aliases:{}})).frames.some(f=>f.guardTransitions?.length),false,'unsupported conditions fail closed');
});

test('preview observes gate values once per navigator return while keeping protected screens visible', () => {
 const require=createRequire(import.meta.url),babel=require('../apps/native-host/node_modules/@babel/core'),plugin=require('../apps/linked-host/preview-routes.cjs');
 const result=babel.transformSync(`import {Stack} from 'expo-router';export default function Root(){const signedIn=false;const complete=true;return <Stack><Stack.Protected guard={signedIn && !complete}><Stack.Screen name="setup"/></Stack.Protected><Stack.Protected guard={complete}><Stack.Screen name="index"/></Stack.Protected></Stack>}`,{filename:'/app/app/_layout.tsx',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{app:'/app',guards:[{file:'app/_layout.tsx',atoms:['signedIn','complete']}]}], require('../apps/native-host/node_modules/@babel/plugin-transform-react-jsx')]}).code;
 assert.equal((result.match(/_observeGuardValues\(/g)??[]).length,1);
 assert.match(result,/guard: true/);assert.match(result,/signedIn: !!signedIn/);
});

test('disconnected speech Resume emits the documented failure lifecycle without throwing or invoking recording',async()=>{
 const events:any[]=[]; const start=disconnectedSpeechStart((name,value)=>events.push([name,value]));
 assert.doesNotThrow(start);assert.equal(events.length,0,'events run after the caller updates its state');
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(events.map(([name])=>name),['error','end']);assert.equal(events[0][1].error,'not-allowed');
 start();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(events.length,4,'repeated Resume attempts remain handled');
});

test('isolated uncaught errors reach their frame handler and restore the previous handler on disposal',()=>{
 const calls:string[]=[];const original=()=>calls.push('global');let handler=original;
 const restore=containFrameErrors({getGlobalHandler:()=>handler,setGlobalHandler:next=>{handler=next as typeof original}},()=>calls.push('frame'));
 handler();assert.deepEqual(calls,['frame']);restore();handler();assert.deepEqual(calls,['frame','global']);
});
