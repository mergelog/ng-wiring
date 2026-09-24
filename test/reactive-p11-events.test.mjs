import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { catalogSignalStores, analyzeEvents, resolveEventDelivery, eventDeliverySteps,
  actionDeliverySteps } from '../dist/adapters/reactive/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(source, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p11e-'));
  try {
    await mkdir(path.join(root, 'src'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, strict: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), source);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    await check({ context, stores: catalogSignalStores(context) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const owner = name => id => id.endsWith(`#${name}`);

const APP = `
import {Component, inject} from '@angular/core';
import {signalStore, withState, type} from '@ngrx/signals';
import {event, eventGroup, on, withReducer, withEventHandlers, Events, Dispatcher, injectDispatch,
  provideDispatcher, toScope, mapToScope} from '@ngrx/signals/events';
import {map, tap} from 'rxjs';
export const pageEvents=eventGroup({source:'Page',events:{increment:type<void>(),loaded:type<number>()}});
export const refreshed=event('[Api] Refreshed');
export const CounterStore=signalStore(withState({count:0,seen:0}),
  withReducer(on(pageEvents.increment,(_e,state)=>({count:state.count+1}))),
  withEventHandlers((store,events=inject(Events))=>({
    quiet$: events.on(pageEvents.increment).pipe(tap(()=>{})),
    next$: events.on(pageEvents.loaded).pipe(map(()=>refreshed())),
    escalated$: events.on(refreshed).pipe(map(()=>[pageEvents.increment(),toScope('global')])),
  })));
@Component({selector:'app-shell',template:'',providers:[provideDispatcher()]})
export class Shell { store=inject(CounterStore); }
@Component({selector:'app-page',template:'',providers:[provideDispatcher()]})
export class Page {
  dispatch=injectDispatch(pageEvents);
  local(){this.dispatch.increment();}
  up(){this.dispatch({scope:'parent'}).increment();}
  everywhere(){this.dispatch({scope:'global'}).increment();}
}
@Component({selector:'app-sibling',template:'',providers:[provideDispatcher()]})
export class Sibling { events=inject(Events); constructor(){this.events.on(pageEvents.increment).subscribe();} }
@Component({selector:'app-direct',template:''})
export class Direct { d=inject(Dispatcher); go(){this.d.dispatch(refreshed(),{scope:'global'});} }
`;

// P11-04 / P11-12
test('event creators, send forms and consumers are separated with their scope and lifetime', async () => fixture(APP,
  ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  assert.deepEqual(graph.creators.map(item => item.type).sort(),
    ['[Api] Refreshed', '[Page] increment', '[Page] loaded']);
  const named = graph.dispatches.filter(item => item.form === 'named-event');
  assert.deepEqual(named.map(item => item.scope).sort(), ['global', 'parent', 'self']);
  assert(named.every(item => item.status === 'resolved' && item.bus === 'signal-store-event'));
  const direct = graph.dispatches.find(item => item.form === 'direct-event');
  assert.equal(direct.scope, 'global');
  assert.equal(direct.creatorType, '[Api] Refreshed');
  const reducer = graph.consumers.find(item => item.kind === 'reducer');
  assert.deepEqual(reducer.creatorTypes, ['[Page] increment']);
  assert.deepEqual(reducer.writes, ['count']);
  assert(reducer.conditions.some(item => item.includes('ReducerEvents receives the event before Events handlers')));
  const handlers = graph.consumers.filter(item => item.kind === 'handler');
  assert.equal(handlers.length, 3);
  assert(handlers.every(item => item.conditions.some(condition => condition.includes('subscribed when the Store is created'))));
  assert(handlers.every(item => item.storeId === [...stores.declarations.values()][0].id));
  // A void side effect is not a redelivery; a produced event is.
  const quiet = handlers.find(item => item.creatorTypes.includes('[Page] increment') && !item.redelivers.length);
  assert(quiet, 'the tap handler redelivers nothing');
  const next = handlers.find(item => item.creatorTypes.includes('[Page] loaded'));
  assert.deepEqual(next.redelivers.map(item => item.creatorType), ['[Api] Refreshed']);
  assert.equal(next.redelivers[0].scope, 'self');
  // A `[event, scope]` tuple carries the scope of the redelivery.
  const escalated = handlers.find(item => item.creatorTypes.includes('[Api] Refreshed'));
  assert.deepEqual(escalated.redelivers.map(item => item.creatorType), ['[Page] increment']);
  assert.equal(escalated.redelivers[0].scope, 'global');
  const subscription = graph.consumers.find(item => item.kind === 'subscription');
  assert(owner('Sibling')(subscription.owner));
}));

// P11-10
test('scope picks the bus instance and an unrelated sibling scope receives nothing', async () => fixture(APP,
  ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  const id = name => graph.dispatcherOwners.find(owner('' + name));
  assert.equal(graph.dispatcherOwners.length, 3);
  const page = id('Page'), shell = id('Shell'), sibling = id('Sibling');
  const ancestry = [page, shell];
  const consumerAncestry = consumer => consumer.kind === 'subscription' ? [sibling, shell] : [shell];
  const send = scope => graph.dispatches.find(item => item.form === 'named-event' && item.scope === scope);
  const self = resolveEventDelivery(graph, send('self'), ancestry, consumerAncestry);
  assert.equal(self.busId, page);
  assert.deepEqual(self.consumers, []);
  assert(self.reasons.some(reason => reason.includes('no matching consumer')));
  const parent = resolveEventDelivery(graph, send('parent'), ancestry, consumerAncestry);
  assert.equal(parent.busId, shell);
  assert.deepEqual(parent.consumers.map(item => item.kind).sort(), ['handler', 'reducer']);
  // The sibling listens to the same event type on its own bus and must not receive this send.
  assert(!parent.consumers.some(item => item.kind === 'subscription'));
  const global = resolveEventDelivery(graph, send('global'), ancestry, consumerAncestry);
  assert.equal(global.busId, 'root');
  assert.deepEqual(global.consumers, []);
  // Without the injector ancestry the bus instance is a boundary, not a guess.
  const unknown = resolveEventDelivery(graph, send('self'), [], consumerAncestry);
  assert.equal(unknown.status, 'boundary');
  assert.equal(unknown.busId, 'unknown');
  assert(unknown.reasons[0].includes('injector ancestry'));
}));

test('a parent send without a local dispatcher stops instead of resolving to the root bus', async () => fixture(`
import {Component, inject} from '@angular/core';
import {type} from '@ngrx/signals';
import {eventGroup, injectDispatch} from '@ngrx/signals/events';
export const pageEvents=eventGroup({source:'Page',events:{increment:type<void>()}});
@Component({selector:'app-page',template:''}) export class Page {
  dispatch=injectDispatch(pageEvents);
  up(){this.dispatch({scope:'parent'}).increment();}
}
`, ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  assert.deepEqual(graph.dispatcherOwners, []);
  const resolution = resolveEventDelivery(graph, graph.dispatches[0], ['src/main.ts#Page']);
  assert.equal(resolution.status, 'boundary');
  assert(resolution.reasons[0].includes('already the root one'));
}));

// P11-11 / P11-13
test('the action bus and the event bus stay separate unless an explicit bridge joins them', async () => fixture(`
import {Component, inject} from '@angular/core';
import {Store, createAction, createReducer, on as onAction, provideStore, provideState} from '@ngrx/store';
import {signalStore, withState, type} from '@ngrx/signals';
import {eventGroup, withEventHandlers, Events} from '@ngrx/signals/events';
import {tap} from 'rxjs';
export const viewEvents=eventGroup({source:'View',events:{activateLoader:type<void>()}});
export const activate=createAction('[View] activateLoader');
export const loaderReducer=createReducer(false,onAction(activate,()=>true));
export const BridgeStore=signalStore(withState({on:false}),
  withEventHandlers((store,events=inject(Events),globalStore=inject(Store))=>({
    bridge$: events.on(viewEvents.activateLoader).pipe(tap(()=>globalStore.dispatch(activate()))),
  })));
@Component({selector:'app-root',template:''}) export class Root {
  store=inject(Store);
  send(){this.store.dispatch(viewEvents.activateLoader());}
}
export const rootProviders=[provideStore(),provideState('loader',loaderReducer)];
`, ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  // A SignalStore event handed to Store.dispatch is not an event-bus send.
  assert.deepEqual(graph.dispatches, []);
  assert.equal(graph.crossBus.length, 1);
  assert.equal(graph.crossBus[0].creatorType, '[View] activateLoader');
  assert(graph.crossBus[0].reason.includes('no event consumer receives it without an explicit bridge'));
  assert(graph.diagnostics.some(item => item.includes('[View] activateLoader')));
  // The handler that calls Store.dispatch is the explicit bridge, and it is not counted as a cross-bus send.
  assert.equal(graph.bridges.length, 1);
  assert.equal(graph.bridges[0].toBus, 'ngrx-action');
  assert.equal(graph.bridges[0].fromConsumer, graph.consumers.find(item => item.kind === 'handler').id);
  assert(!graph.crossBus.some(item => item.source === graph.bridges[0].source));
  // The action type string matches the event type string; that alone connects nothing.
  assert.equal(graph.creators[0].type, '[View] activateLoader');
}));

// P11-04 model output
test('delivery steps keep bus, form, scope and registration on both halves', async () => fixture(APP,
  ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  const page = graph.dispatcherOwners.find(owner('Page'));
  const shell = graph.dispatcherOwners.find(owner('Shell'));
  const dispatch = graph.dispatches.find(item => item.scope === 'parent');
  const resolution = resolveEventDelivery(graph, dispatch, [page, shell], () => [shell]);
  const steps = eventDeliverySteps(graph, dispatch, resolution);
  const sent = steps.find(step => step.kind === 'event-dispatch');
  assert.equal(sent.delivery.bus, 'signal-store-event');
  assert.equal(sent.delivery.busId, shell);
  assert.equal(sent.delivery.form, 'named-event');
  assert.equal(sent.delivery.scope, 'parent');
  assert.equal(sent.capability, 'signals-events/injectDispatch');
  const consumed = steps.filter(step => step.kind === 'event-consume');
  assert(consumed.length >= 2);
  assert(consumed.every(step => step.delivery.busId === shell && step.delivery.registration.length > 0));
  const write = steps.find(step => step.kind === 'state-write');
  assert.equal(write.state.framework, 'signal-store');
  assert.equal(write.state.key, 'count');
  assert.equal(write.state.declaration, [...stores.declarations.values()][0].id);
  // No part of the event path is turned into an effect node.
  assert(!steps.some(step => step.kind === 'effect'));
}));

test('action delivery steps carry the action bus and its registration state', async () => fixture(`
import {Component, inject} from '@angular/core';
import {Store, createAction, createReducer, on, provideStore, provideState} from '@ngrx/store';
export const bump=createAction('[Counter] Bump');
export const counter=createReducer(0,on(bump,s=>s+1));
@Component({selector:'app-root',template:''}) export class Root { store=inject(Store); go(){this.store.dispatch(bump());} }
export const rootProviders=[provideStore(),provideState('counter',counter)];
`, async ({ context }) => {
  const { buildCatalog } = await import('../dist/index/catalog.js');
  const { analyzeStore } = await import('../dist/resolve/operation/index.js');
  const catalog = await buildCatalog(context);
  const t = context.toolchain.typescript;
  const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
  const providers = file.statements.filter(t.isVariableStatement).flatMap(s => s.declarationList.declarations)
    .find(d => d.name.getText() === 'rootProviders').initializer;
  const store = analyzeStore(context, catalog, { rootProviders: [providers] });
  const steps = actionDeliverySteps(store, store.actions[0], 'Root.go');
  const sent = steps.find(step => step.kind === 'action-dispatch');
  assert.equal(sent.delivery.bus, 'ngrx-action');
  assert.equal(sent.delivery.busId, 'root');
  assert.equal(sent.delivery.form, 'action-instance');
  assert.deepEqual(sent.delivery.registration, []);
  const consumed = steps.filter(step => step.kind === 'action-consume');
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].capability, 'ngrx-store/createReducer');
  assert(!steps.some(step => step.kind === 'event-dispatch' || step.kind === 'event-consume'));
}));

// P11-12: a handler that passes the received event on re-sends that same event.
test('a handler that returns its received event is a redelivery, not a silent stop', async () => fixture(`
import {inject} from '@angular/core';
import {signalStore, withState, type} from '@ngrx/signals';
import {eventGroup, withEventHandlers, Events} from '@ngrx/signals/events';
import {map, tap} from 'rxjs';
export const pageEvents=eventGroup({source:'Page',events:{increment:type<void>()}});
export const Store1=signalStore(withState({a:0}),
  withEventHandlers((store,events=inject(Events))=>({
    through$: events.on(pageEvents.increment).pipe(map(e=>e)),
    bare$: events.on(pageEvents.increment),
    quiet$: events.on(pageEvents.increment).pipe(tap(()=>{})),
  })));
`, ({ context, stores }) => {
  const graph = analyzeEvents(context, stores);
  const handlers = graph.consumers.filter(item => item.kind === 'handler');
  assert.equal(handlers.length, 3);
  const redelivering = handlers.filter(item => item.redelivers.length);
  assert.equal(redelivering.length, 2, 'the map pass-through and the bare subscription both re-send');
  assert(redelivering.every(item => item.redelivers[0].creatorType === '[Page] increment'));
  assert.equal(handlers.filter(item => !item.redelivers.length).length, 1);
}));
