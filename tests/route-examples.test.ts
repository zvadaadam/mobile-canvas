import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { observedHref, paramsForRoute } from '../src/shared/route-samples';
import { chooseRouteExample } from '../src/runtime/adapters/expo/route-examples';
import { ScreenSchema } from '../src/shared/model';
import { observePress, getRouteDestinations } from '../apps/linked-host/RouteObserver';

const screen = ScreenSchema.parse({id:'screen-detail',key:'detail',name:'Detail',source:'screens/detail.tsx',x:0,y:0,props:{route:{fullPath:'/(flavours)/flavours/[id]'}},notes:'Preserved',links:['index']});
test('concrete destinations preserve encoded IDs, query arrays, catchalls and explicit route groups', () => {
  assert.equal(observedHref({pathname:'/flavours/[id]',params:{id:12,title:'Café & Cocoa'}}), '/flavours/12?title=Caf%C3%A9+%26+Cocoa');
  assert.deepEqual(paramsForRoute('/(flavours)/flavours/[id]','/flavours/a%2Fb?title=Caf%C3%A9&tag=x&tag=y'), {id:'a/b',title:'Café',tag:['x','y']});
  assert.deepEqual(paramsForRoute('/docs/[...path]','/docs/a/b%20c'),{path:['a','b c']});
  assert.equal(paramsForRoute('/(flavours)/flavours/[id]','/(locations)/flavours/1'),null);
  for(const href of ['https://example.com/flavours/1','//example.com/flavours/1','/flavours/[id]','/flavours/1/extra','/flavours/%xx']) assert.equal(paramsForRoute('/flavours/[id]',href),null);
});
test('examples are ordered consistently, preserve authored props and never replace explicit IDs', () => {
  const examples=[{href:'/flavours/2',from:'index',file:'app/index.tsx'},{href:'/flavours/1',from:'index',file:'app/index.tsx'}];
  const result=chooseRouteExample(screen,examples)!;
  assert.deepEqual(result,chooseRouteExample(screen,[...examples].reverse()));
  assert.deepEqual(result.params,{id:'1'});
  assert.equal((result.routeExample as any).href,'/flavours/1');
  assert.equal(chooseRouteExample({...screen,props:{...screen.props,params:{id:'99'}}},examples),null);
  assert.equal(chooseRouteExample({...screen,props:{...screen.props,autoParams:false}},examples),null);
});
test('render observation never invokes the original press handler', async () => {
  let count=0;
  const handler=()=>count++;
  assert.equal(observePress(handler,()=>'/flavours/42','app/index.tsx'),handler);
  assert.equal(count,0);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(getRouteDestinations().some(item=>item.href==='/flavours/42'));
  handler(); assert.equal(count,1);
});
test('preview transform observes real render values without executing handlers or arbitrary calls', () => {
  const require=createRequire(resolve('apps/native-host/package.json'));
  const babel=require('@babel/core');
  const source=`import {router, Link, Stack} from 'expo-router';
    export function render(item) { return <View><Button onPress={()=>router.push('/flavours/'+item.id)} /><Link href={{pathname:'/flavours/[id]',params:{id:item.id}}}/><Button onPress={()=>{ mutate(); router.push('/flavours/9'); }}/><Button onPress={()=>router.push(getId())}/><Stack.Protected guard={false}/></View>; }`;
  const transform=(filename:string)=>babel.transformSync(source,{filename,configFile:false,babelrc:false,plugins:[[resolve('apps/linked-host/preview-routes.cjs'),{app:'/linked'}],require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
  const destinations:unknown[]=[]; let pushes=0;
  const sandbox:any={exports:{},React:{createElement:(_type:any,props:any,...children:any[])=>({props,children})},View:'View',Button:'Button',require:(name:string)=>name==='expo-router'?{router:{push:()=>pushes++},Link:'Link',Stack:{Protected:'Protected'}}:{observeHref:(value:any)=>{destinations.push(value);return value;},observePress:(handler:any,read:any)=>{destinations.push(read());return handler;}}};
  vm.runInNewContext(transform('/linked/app/index.jsx'),sandbox);
  const tree=sandbox.exports.render({id:7});
  assert.equal(pushes,0); assert.equal(destinations.length,2); assert.equal(destinations[0],'/flavours/7');
  assert.equal(tree.children.at(-1).props.guard,true);
  tree.children[0].props.onPress(); assert.equal(pushes,1);
  assert.ok(!transform('/package/index.jsx').includes('expo-canvas-route-observer'));
});

test('native navigation adapter sends the proposed route to the canvas without committing it', async () => {
  const {readFile}=await import('node:fs/promises');
  const ts=await import('typescript');
  const code=ts.transpileModule(await readFile('apps/linked-host/FrameNavigation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const state={key:'tabs',index:0,routes:[{name:'flavours'},{name:'locations'}]};
  const navigation:string[]=[];
  const sandbox:any={exports:{},require:(name:string)=>{
    if(name==='react')return {useMemo:(fn:()=>any)=>fn()};
    if(name==='expo-canvas-original-on-action')return {useOnAction:(options:any)=>options.router};
    if(name.endsWith('router-store'))return {store:{navigationRef:{getRootState:()=>state},linking:{config:{screens:{}}}}};
    if(name.endsWith('getPathFromState'))return {getPathFromState:(next:any)=>'/'+next.routes[next.index].name};
    throw Error(name);
  }};
  vm.runInNewContext(code,sandbox);
  sandbox.exports.setFrameNavigation((href:string)=>navigation.push(href));
  const router=sandbox.exports.useOnAction({router:{getStateForAction:()=>({...state,index:1}),shouldActionChangeFocus:()=>true}});
  const result=router.getStateForAction(state,{type:'JUMP_TO'},{});
  assert.equal(result.index,0); assert.equal(result.routes,state.routes);
  assert.deepEqual(navigation,['/locations']);
  assert.equal(router.shouldActionChangeFocus({type:'JUMP_TO'}),false);
  assert.equal(router.getStateForAction(state,{type:'SET_PARAMS'},{}).index,1);
});
