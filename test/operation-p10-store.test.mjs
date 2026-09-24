import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { buildCatalog } from '../dist/index/catalog.js';
import { indexTemplates, matchingElements } from '../dist/index/templates.js';
import { analyzeStore, traceStoreDispatch, componentInjectorLayers, storeInputsForSelection } from '../dist/resolve/operation/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(source, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p10-store-'));
  try {
    await mkdir(path.join(root, 'src'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), source);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const t = context.toolchain.typescript;
    const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
    const expr = name => file.statements.filter(t.isVariableStatement).flatMap(s => s.declarationList.declarations)
      .find(d => d.name.getText() === name)?.initializer;
    await check({context,catalog,expr,file,t});
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('registered reducer and selector exist without an effect; collisions stay visible', async () => fixture(`
import {Component, inject} from '@angular/core';
import {Store, createAction, createReducer, on, createSelector, provideStore, provideState} from '@ngrx/store';
export const increment=createAction('[Count] Change');
export const duplicate=createAction('[Count] Change');
export const unrelated=createAction('[Other] Save');
export const countReducer=createReducer(0,on(increment,(state)=>state+1));
export const selectCount=createSelector((s:{count:number})=>s.count,n=>n);
export const rootProviders=[provideStore(),provideState('count',countReducer)];
@Component({selector:'app-root',template:'{{count()}}'}) export class Root {
  store=inject(Store); count=this.store.selectSignal(selectCount);
  run(){this.store.dispatch(increment());}
  runDuplicate(){this.store.dispatch(duplicate());}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert.equal(graph.registrations.length,2);
  assert.equal(graph.reducers.length,1);
  assert.equal(graph.reducers[0].registered,true);
  assert.equal(graph.reducers[0].feature,'count');
  assert.equal(graph.effects.length,0);
  assert(graph.diagnostics.some(d=>d.includes('Action type collision')));
  assert(graph.consumers.some(c=>c.kind==='selectSignal'));
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='action-dispatch'));
  assert(trace.steps.some(s=>s.kind==='action-consume'&&s.target===graph.reducers[0].id));
  assert(trace.steps.some(s=>s.kind==='reactive-link'&&s.target===graph.consumers[0].id));
  assert(!trace.steps.some(s=>s.target.includes('unrelated')));
  const collided=traceStoreDispatch(context,graph,owner,'runDuplicate');
  assert(collided.diagnostics.some(d=>d.includes('Action type collision')));
  assert(collided.steps.some(s=>s.kind==='action-consume'&&s.target===graph.reducers[0].id));
}));

test('selected bootstrap and route ancestry supply only their active Store providers', async () => fixture(`
import {Component} from '@angular/core';
import {createAction,createReducer,on,provideStore,provideState} from '@ngrx/store';
export const action=createAction('[Route] Go');
export const reducer=createReducer(0,on(action,s=>s+1));
@Component({selector:'app-root',template:''}) export class Root {}
export const routes=[{path:'a',providers:[provideState('a',reducer)],component:Root},
  {path:'b',providers:[provideState('b',reducer)],component:Root}];
bootstrapApplication(Root,{providers:[provideStore()]});
`, ({context,catalog,file,t}) => {
  const bootstrapCall=file.statements.find(s=>t.isExpressionStatement(s)&&t.isCallExpression(s.expression)).expression;
  const routesDecl=file.statements.filter(t.isVariableStatement).flatMap(s=>s.declarationList.declarations)
    .find(d=>d.name.getText()==='routes');
  const [a,b]=routesDecl.initializer.elements;
  const span=node=>({file:file.fileName,start:node.getStart(),end:node.getEnd(),line:1,endLine:1,column:1});
  const bootstrap={id:'selected',kind:'application',span:span(bootstrapCall),moduleId:null};
  const aRoute={id:'a',configId:'config',definition:span(a),parentId:null};
  const bRoute={id:'b',configId:'config',definition:span(b),parentId:null};
  const graph={configs:new Map([['config',{bootstrapId:'selected'}]]),byId:new Map([['a',aRoute],['b',bRoute]])};
  const inputs=storeInputsForSelection(context,catalog,graph,bootstrap,aRoute);
  const store=analyzeStore(context,catalog,inputs);
  assert(store.registrations.some(r=>r.key==='a'));
  assert(!store.registrations.some(r=>r.key==='b'));
  assert(store.registrations.some(r=>r.kind==='root'));
  const other=storeInputsForSelection(context,catalog,graph,{...bootstrap,id:'other'},aRoute);
  assert.equal(analyzeStore(context,catalog,other).registrations.filter(r=>r.kind==='feature').length,0);
}));

test('facade call follows its selected provider and stops at unresolved DI', async () => fixture(`
import {Component, Injectable, inject} from '@angular/core';
import {Store, createAction, provideStore} from '@ngrx/store';
export const start=createAction('[Flow] Start');
export abstract class Facade { abstract go():void }
@Injectable() export class RealFacade extends Facade { store=inject(Store); go(){this.store.dispatch(start());} }
@Component({selector:'app-root',template:'',providers:[{provide:Facade,useClass:RealFacade}]})
export class Root {facade=inject(Facade); run(){this.facade.go();}}
export const rootProviders=[provideStore()];
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run',componentInjectorLayers(owner));
  assert(trace.steps.some(s=>s.kind==='call'&&s.target==='facade.go'));
  assert(trace.steps.some(s=>s.kind==='action-dispatch'));
  const unresolved=traceStoreDispatch(context,graph,owner,'run',[]);
  assert(unresolved.steps.some(s=>s.kind==='boundary'&&s.detail?.includes('DI')));
  assert(!unresolved.steps.some(s=>s.kind==='action-dispatch'));
}));

test('unregistered effect stays inactive; registered effect retains dispatch:false and route lifetime', async () => fixture(`
import {Component, Injectable, inject} from '@angular/core';
import {Store, createAction, provideStore} from '@ngrx/store';
import {Actions, createEffect, ofType, provideEffects} from '@ngrx/effects';
import {map,tap} from 'rxjs';
export const start=createAction('[Flow] Start');
export const done=createAction('[Flow] Done');
@Injectable() export class FlowEffects {
  actions=inject(Actions); store=inject(Store);
  run=createEffect(()=>this.actions.pipe(ofType(start),map(()=>done())));
  silent=createEffect(()=>this.actions.pipe(ofType(start),map(()=>done())),{dispatch:false});
  explicit=createEffect(()=>this.actions.pipe(ofType(start),tap(()=>this.store.dispatch(done()))),{dispatch:false});
}
@Component({selector:'app-root',template:''}) export class Root {store=inject(Store); run(){this.store.dispatch(start());}}
export const rootProviders=[provideStore()];
export const routeProviders=[provideEffects(FlowEffects)];
`, ({context,catalog,expr}) => {
  const inactive=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert(inactive.effects.every(e=>!e.registered));
  const active=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')],routeProviders:[expr('routeProviders')]});
  assert(active.effects.every(e=>e.registered));
  assert(active.effects.every(e=>e.conditions.some(c=>c.includes('lazy route'))));
  const withoutRoot=analyzeStore(context,catalog,{rootProviders:[],routeProviders:[expr('routeProviders')]});
  assert(withoutRoot.effects.every(e=>!e.registered));
  assert.equal(active.effects.find(e=>e.id.endsWith(':silent')).dispatch,false);
  assert(active.effects.find(e=>e.id.endsWith(':run')).emits.some(id=>id.endsWith(':done')));
  assert(active.effects.find(e=>e.id.endsWith(':explicit')).explicitDispatches.some(id=>id.endsWith(':done')));
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,active,owner,'run');
  assert(trace.steps.some(s=>s.detail==='explicit Store.dispatch inside the effect'));
  assert(!trace.steps.some(s=>s.source.endsWith(':silent')&&s.kind==='action-dispatch'));
}));

test('functional effect in provideEffects object is registered by its function symbol', async () => fixture(`
import {inject} from '@angular/core';
import {createAction,provideStore} from '@ngrx/store';
import {Actions,createEffect,ofType,provideEffects} from '@ngrx/effects';
import {map} from 'rxjs';
export const start=createAction('[F] Start');
export const done=createAction('[F] Done');
export const run=createEffect((actions=inject(Actions))=>actions.pipe(ofType(start),map(()=>done())),{functional:true});
export const rootProviders=[provideStore(),provideEffects({run})];
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert.equal(graph.effects.length,1);
  assert.equal(graph.effects[0].functional,true);
  assert.equal(graph.effects[0].registered,true,JSON.stringify({registrations:graph.registrations,effects:graph.effects}));
}));

test('NgModule StoreModule and EffectsModule registrations are tied to the selected module', async () => fixture(`
import {NgModule,Injectable,inject} from '@angular/core';
import {StoreModule,createAction,createReducer,on} from '@ngrx/store';
import {EffectsModule,Actions,createEffect,ofType} from '@ngrx/effects';
import {map} from 'rxjs';
export const start=createAction('[Module] Start');
export const done=createAction('[Module] Done');
export const countReducer=createReducer(0,on(start,s=>s+1));
@Injectable() export class ModuleEffects {actions=inject(Actions);
  run=createEffect(()=>this.actions.pipe(ofType(start),map(()=>done())));}
@NgModule({imports:[StoreModule.forRoot({count:countReducer}),EffectsModule.forRoot([ModuleEffects])]})
export class AppModule {}
`, ({context,catalog}) => {
  const module=[...catalog.declarations.values()].find(d=>d.className==='AppModule');
  const active=analyzeStore(context,catalog,{rootProviders:[],modules:[module.node]});
  assert(active.reducers.some(r=>r.registered&&r.feature==='count'));
  assert(active.effects.some(e=>e.registered));
  const inactive=analyzeStore(context,catalog,{rootProviders:[]});
  assert(inactive.reducers.every(r=>!r.registered));
  assert(inactive.effects.every(e=>!e.registered));
}));

test('selector dependency can pass through createFeatureSelector, but unconsumed reads stop', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,createReducer,on,createFeatureSelector,createSelector,provideStore} from '@ngrx/store';
export const action=createAction('[Count] Inc');
export const reducer=createReducer({value:0},on(action,s=>({value:s.value+1})));
export const feature=createFeatureSelector<{value:number}>('count');
export const selected=createSelector(feature,s=>s.value);
export const rootProviders=[provideStore({count:reducer})];
@Component({selector:'app-root',template:'{{value()}}'}) export class Root {
  store=inject(Store); value=this.store.selectSignal(selected);
  unused=this.store.selectSignal(selected);
  run(){this.store.dispatch(action());}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert(graph.consumers.some(c=>c.active));
  assert(graph.consumers.some(c=>!c.active));
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='reactive-link'&&s.target===graph.consumers.find(c=>c.active).id));
  assert(!trace.steps.some(s=>s.kind==='reactive-link'&&s.target===graph.consumers.find(c=>!c.active).id));
}));

test('effect success and error actions keep branch conditions; latest read stays background', async () => fixture(`
import {Component,Injectable,inject} from '@angular/core';
import {Store,createAction,createSelector,provideStore} from '@ngrx/store';
import {Actions,createEffect,ofType,provideEffects} from '@ngrx/effects';
import {map,catchError,of,withLatestFrom} from 'rxjs';
export const start=createAction('[Flow] Start');
export const done=createAction('[Flow] Done');
export const failed=createAction('[Flow] Failed');
export const background=createSelector((s:{count:number})=>s.count,n=>n);
@Injectable() export class Fx {actions=inject(Actions); store=inject(Store); other$=of(1);
  run=createEffect(()=>this.actions.pipe(ofType(start),withLatestFrom(this.store.select(background),this.other$),
    map(()=>done()),catchError(()=>of(failed())))); }
@Component({selector:'app-root',template:''}) export class Root {store=inject(Store); run(){this.store.dispatch(start());}}
export const rootProviders=[provideStore(),provideEffects(Fx)];
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':done')&&
    s.conditions.some(c=>c.includes('successful'))));
  assert(trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':failed')&&
    s.conditions.some(c=>c.includes('error'))));
  assert(trace.backgroundReads.some(r=>r.includes('other$')&&r.includes('direct source declared')));
  assert(trace.backgroundReads.some(r=>r.includes('direct selector')&&r.includes('background')));
  assert(!trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.includes('other$')));
}));

test('selected lazy route module contributes feature and effect registrations', async () => fixture(`
import {Component,NgModule} from '@angular/core';
import {StoreModule,createAction,createReducer,on,provideStore} from '@ngrx/store';
import {EffectsModule,createEffect,Actions,ofType} from '@ngrx/effects';
import {inject} from '@angular/core';
import {map} from 'rxjs';
export const action=createAction('[Lazy] Start');
export const done=createAction('[Lazy] Done');
export const reducer=createReducer(0,on(action,s=>s+1));
export class Fx {actions=inject(Actions); run=createEffect(()=>this.actions.pipe(ofType(action),map(()=>done())));}
@NgModule({imports:[StoreModule.forFeature('lazy',reducer),EffectsModule.forFeature([Fx])]}) export class LazyModule {}
@Component({selector:'app-root',template:''}) export class Root {}
export const routes=[{path:'lazy',loadChildren:()=>LazyModule,children:[{path:'child',component:Root}]}];
bootstrapApplication(Root,{providers:[provideStore()]});
`, ({context,catalog,file,t}) => {
  const bootstrapCall=file.statements.find(s=>t.isExpressionStatement(s)&&t.isCallExpression(s.expression)).expression;
  const routesDecl=file.statements.filter(t.isVariableStatement).flatMap(s=>s.declarationList.declarations)
    .find(d=>d.name.getText()==='routes');
  const parent=routesDecl.initializer.elements[0];
  const child=parent.properties.find(p=>p.name.getText()==='children').initializer.elements[0];
  const span=node=>({file:file.fileName,start:node.getStart(),end:node.getEnd(),line:1,endLine:1,column:1});
  const bootstrap={id:'selected',kind:'application',span:span(bootstrapCall),moduleId:null};
  const p={id:'p',configId:'config',definition:span(parent),parentId:null};
  const c={id:'c',configId:'config',definition:span(child),parentId:'p'};
  const routes={configs:new Map([['config',{bootstrapId:'selected'}]]),byId:new Map([['p',p],['c',c]])};
  const inputs=storeInputsForSelection(context,catalog,routes,bootstrap,c);
  assert.equal(inputs.routeModules.length,1);
  const graph=analyzeStore(context,catalog,inputs);
  assert(graph.reducers.some(r=>r.registered&&r.feature==='lazy'));
  assert(graph.effects.some(e=>e.registered&&e.conditions.some(x=>x.includes('lazy route'))));
}));

test('dispatch reached through an existing Subject subscription retains its causal path', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,createReducer,on,provideStore} from '@ngrx/store';
import {Subject,tap} from 'rxjs';
export const action=createAction('[Stream] Go');
export const unrelated=createAction('[Other] Go');
export const reducer=createReducer(0,on(action,s=>s+1));
export const rootProviders=[provideStore({count:reducer})];
@Component({selector:'app-root',template:''}) export class Root {
  store=inject(Store); trigger=new Subject<void>();
  constructor(){this.trigger.pipe(tap(()=>this.store.dispatch(action()))).subscribe();
    this.store.dispatch(unrelated());}
  run(){this.trigger.next();}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':action')&&
    s.detail?.includes('subscription')));
  assert(!trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':unrelated')));
}));

test('local functions and dispatch overload are followed; unknown callbacks stop', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,provideStore} from '@ngrx/store';
export const action=createAction('[Call] Go');
export function send(store:Store){store.dispatch(()=>action());}
export declare function external(_cb:()=>void):void;
@Component({selector:'app-root',template:''}) export class Root {store=inject(Store);
  run(){send(this.store); external(()=>this.store.dispatch(action()));}}
export const rootProviders=[provideStore()];
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert.equal(trace.steps.filter(s=>s.kind==='action-dispatch').length,1);
  assert(trace.steps.some(s=>s.kind==='boundary'&&s.target==='external'));
}));

test('recursive calls stop on the branch and record a boundary', async () => fixture(`
import {Component} from '@angular/core';
@Component({selector:'app-root',template:''}) export class Root {
  run(){this.again();}
  again(){this.again();}
}
`, ({context,catalog}) => {
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,analyzeStore(context,catalog,{rootProviders:[]}),owner,'run');
  assert(trace.steps.some(s=>s.kind==='boundary'&&s.detail?.includes('recursive')));
}));

test('effect does not auto-dispatch an action creator merely called inside a map callback', async () => fixture(`
import {inject} from '@angular/core';
import {createAction,provideStore} from '@ngrx/store';
import {Actions,createEffect,ofType,provideEffects} from '@ngrx/effects';
import {map} from 'rxjs';
export const start=createAction('[Side] Start');
export const ignored=createAction('[Side] Ignored');
export const done=createAction('[Side] Done');
export class Fx {actions=inject(Actions);
  run=createEffect(()=>this.actions.pipe(ofType(start),map(()=>{ignored();return done();})));}
export const rootProviders=[provideStore(),provideEffects(Fx)];
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert(graph.effects[0].emits.some(id=>id.endsWith(':done')));
  assert(!graph.effects[0].emits.some(id=>id.endsWith(':ignored')));
}));

test('Store.selectSignal flows through a tracked computed only when the template reads it', async () => fixture(`
import {Component,computed,inject} from '@angular/core';
import {Store,createAction,createReducer,on,createFeatureSelector,createSelector,provideStore} from '@ngrx/store';
export const action=createAction('[Calc] Inc');
export const reducer=createReducer(0,on(action,s=>s+1));
export const feature=createFeatureSelector<number>('count');
export const selected=createSelector(feature,n=>n);
export const rootProviders=[provideStore({count:reducer})];
@Component({selector:'app-root',template:'{{double()}}'}) export class Root {
  store=inject(Store); count=this.store.selectSignal(selected);
  double=computed(()=>this.count()*2); unused=computed(()=>this.count()+1);
  run(){this.store.dispatch(action());}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert.equal(graph.computeds.length,2);
  assert.equal(graph.computeds.filter(c=>c.active).length,1);
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='reactive-link'&&s.target===graph.computeds.find(c=>c.active).id));
  assert(!trace.steps.some(s=>s.kind==='reactive-link'&&s.target===graph.computeds.find(c=>!c.active).id));
}));

test('Store flow stops at the 10,000 expansion state limit with a boundary', async () => fixture(`
import {Component} from '@angular/core';
@Component({selector:'app-root',template:''}) export class Root {
  run(){${Array.from({length:10020},()=> 'this.unknown();').join('')}}
}
`, ({context,catalog}) => {
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,analyzeStore(context,catalog,{rootProviders:[]}),owner,'run');
  assert(trace.steps.some(s=>s.kind==='boundary'&&s.detail?.includes('10000 expansion')));
  assert(trace.diagnostics.some(d=>d.includes('10000 expansion')));
}));

test('a shared call site reached through two branches retains both paths without a false cycle', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,provideStore} from '@ngrx/store';
export const action=createAction('[Join] Go');
export const rootProviders=[provideStore()];
@Component({selector:'app-root',template:''}) export class Root {
  store=inject(Store); choose=true;
  run(){if(this.choose)this.one();else this.one();}
  one(){this.send();}
  send(){this.store.dispatch(action());}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  const paths=trace.steps.filter(s=>s.kind==='action-dispatch'&&s.target.endsWith(':action'));
  assert.equal(paths.length,2);
  assert.notDeepEqual(paths[0].path,paths[1].path);
  assert(!trace.steps.some(s=>s.kind==='boundary'&&s.detail?.includes('recursive')));
}));

test('component output reaches the selected parent handler and its Store dispatch', async () => fixture(`
import {Component,inject,output} from '@angular/core';
import {Store,createAction,provideStore} from '@ngrx/store';
export const action=createAction('[Output] Go');
export const rootProviders=[provideStore()];
@Component({selector:'child-box',template:''}) export class Child {
  done=output<void>(); run(){this.done.emit();}
}
@Component({selector:'app-root',imports:[Child],template:'<child-box data-id="child" (done)="onDone()" />'})
export class Root {store=inject(Store); onDone(){this.store.dispatch(action());}}
`, async ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const child=[...catalog.declarations.values()].find(d=>d.className==='Child');
  const index=await indexTemplates(context,catalog);
  const element=matchingElements(index,{kind:'attribute',name:'data-id',value:'child'})[0];
  const trace=traceStoreDispatch(context,graph,child,'run',[],{outputElement:element,catalog});
  assert(trace.steps.some(s=>s.kind==='output-emit'&&s.detail?.includes('template subscription')));
  assert(trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':action')));
}));

test('selected SignalStore method may dispatch to the ordinary Store without an effect', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,createReducer,on,provideStore} from '@ngrx/store';
import {signalStore,withMethods} from '@ngrx/signals';
export const action=createAction('[Signals] Go');
export const reducer=createReducer(0,on(action,s=>s+1));
export const rootProviders=[provideStore({count:reducer})];
export const ActionsStore=signalStore(withMethods(()=>{
  const global=inject(Store);
  return { go(){global.dispatch(action());} };
}));

@Component({selector:'app-root',template:'',providers:[ActionsStore]}) export class Root {
  actions=inject(ActionsStore); run(){this.actions.go();}
}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run',componentInjectorLayers(owner));
  assert(trace.steps.some(s=>s.kind==='action-dispatch'&&s.target.endsWith(':action')));
  assert(trace.steps.some(s=>s.kind==='action-consume'&&s.target===graph.reducers[0].id));
  const missing=traceStoreDispatch(context,graph,owner,'run',[]);
  assert(!missing.steps.some(s=>s.kind==='action-dispatch'));
}));

test('Store.select requires a real subscription; plain interpolation is not a notification consumer', async () => fixture(`
import {Component,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Store,createAction,createReducer,on,createFeatureSelector,createSelector,provideStore} from '@ngrx/store';
export const action=createAction('[Obs] Inc');
export const reducer=createReducer(0,on(action,s=>s+1));
export const feature=createFeatureSelector<number>('count');
export const selected=createSelector(feature,n=>n);
export const rootProviders=[provideStore({count:reducer})];
@Component({selector:'app-root',imports:[CommonModule],template:'{{plain$}} {{live$ | async}}'})
export class Root {store=inject(Store); plain$=this.store.select(selected); live$=this.store.select(selected);
  run(){this.store.dispatch(action());}}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert.equal(graph.consumers.filter(c=>c.active).length,1);
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert.equal(trace.steps.filter(s=>s.kind==='reactive-link'&&graph.consumers.some(c=>c.id===s.target)).length,1);
}));

test('dynamic action type stops before runtime type matching', async () => fixture(`
import {Component,inject} from '@angular/core';
import {Store,createAction,provideStore} from '@ngrx/store';
declare const runtimeType:string;
export const dynamic=createAction(runtimeType);
export const rootProviders=[provideStore()];
@Component({selector:'app-root',template:''}) export class Root {store=inject(Store);
  run(){this.store.dispatch(dynamic());}}
`, ({context,catalog,expr}) => {
  const graph=analyzeStore(context,catalog,{rootProviders:[expr('rootProviders')]});
  assert.equal(graph.actions[0].type,null);
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const trace=traceStoreDispatch(context,graph,owner,'run');
  assert(trace.steps.some(s=>s.kind==='boundary'&&s.target==='dynamic action type'));
  assert(!trace.steps.some(s=>s.kind==='action-consume'));
}));
