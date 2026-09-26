import { linkTargetWorkspace } from './fixtures/target.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { buildCatalog } from '../dist/index/catalog.js';
import { analyzeHttp, analyzeHttpFlows, traceHttpFromEffect, traceHttpFromEventConsumer,
  traceHttpFromMethod, analyzeStore } from '../dist/resolve/operation/index.js';
import { analyzeEvents, analyzeReactiveMethods, catalogSignalStores } from '../dist/adapters/reactive/index.js';
import { httpTraceEdges } from '../dist/assemble/steps.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(files, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p12f-'));
  try {
    await mkdir(path.join(root, 'src'));
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2022', 'dom'], skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, 'src', name), text);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const t = context.toolchain.typescript;
    const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
    const expr = name => file.statements.filter(t.isVariableStatement).flatMap(s => s.declarationList.declarations)
      .find(d => d.name.getText() === name)?.initializer;
    const owner = name => [...catalog.declarations.values()].find(d => d.className === name);
    await check({ context, catalog, owner, expr, file, t });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const client = `
import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
export interface Item { id: string }
@Injectable({providedIn: 'root'})
export class GeneratedClient {
  private readonly http = inject(HttpClient);
  load(): Observable<Item[]> { return this.http.get<Item[]>('/api/items'); }
  poll(): Observable<Item[]> { return this.http.get<Item[]>('/api/poll'); }
  save(item: Item): Observable<void> { return this.http.post<void>('/api/items', item); }
  search(key: string): Observable<Item[]> { return this.http.get<Item[]>('/api/search'); }
  audit(key: string): Observable<Item[]> { return this.http.get<Item[]>('/api/audit'); }
}`;
const flowFor = (flows, url) => flows.find(item => item.request.url.text === url);

// P12-01 / P12-04 / P12-07
test('a subscription through two wrappers confirms the start; an unsubscribed one stays a candidate', async () => fixture({
  'client.ts': client,
  'main.ts': `
import {Component, inject, Injectable} from '@angular/core';
import {GeneratedClient, Item} from './client';
@Injectable({providedIn: 'root'})
export class ItemFacade {
  private readonly client = inject(GeneratedClient);
  list() { return this.client.load(); }
  polling() { return this.client.poll(); }
}
@Component({selector: 'app-root', template: ''})
export class Root {
  private readonly facade = inject(ItemFacade);
  items: Item[] = [];
  refresh() { this.facade.list().subscribe(items => { this.items = items; }); }
  prepare() { const pending = this.facade.polling(); }
}`,
}, ({ context, owner }) => {
  const catalog = analyzeHttp(context);
  const flows = analyzeHttpFlows(context, catalog);
  const load = flowFor(flows, '/api/items');
  assert.equal(load.start, 'confirmed');
  assert.equal(load.consumption.kind, 'subscribe');
  // The wrapper chain is recorded from the request out to the subscriber.
  assert.equal(load.stages.length, 2);
  const poll = flowFor(flows, '/api/poll');
  assert.equal(poll.start, 'candidate');
  assert.equal(poll.consumption.kind, 'none');
  assert.match(poll.reason, /held in pending and never subscribed/);
  assert(poll.consumption.gaps.includes('no caller of polling subscribes to the value'));
  // A request that is never reached from the selected operation is not reported by the trace.
  const trace = traceHttpFromMethod(context, catalog, owner('Root'), 'refresh');
  assert.deepEqual(trace.steps.filter(step => step.kind === 'call').map(step => step.target),
    ['facade.list', 'client.load']);
  const created = trace.steps.filter(step => step.kind === 'http-create');
  assert.deepEqual(created.map(step => step.target), ['GET /api/items']);
  assert.deepEqual(trace.steps.filter(step => step.kind === 'type-use').map(step => step.target),
    ['src/client.ts#Item']);
  const consumed = trace.steps.filter(step => step.kind === 'http-consume');
  assert.deepEqual(consumed.map(step => step.target), ['subscribe']);
  assert(created[0].conditions.some(item => item.includes('number of network calls is not proven')));
  // The same operation without a subscriber reports a candidate, not a network call.
  const idle = traceHttpFromMethod(context, catalog, owner('Root'), 'prepare');
  assert.deepEqual(idle.steps.filter(step => step.kind === 'http-consume'), []);
  const boundary = idle.steps.find(step => step.kind === 'boundary');
  assert.equal(boundary.target, 'request candidate');
  assert.match(boundary.detail, /held in pending and never subscribed/);
}));

// P12-05
test('a Promise API starts at the call and its result is a separate stage', async () => fixture({
  'main.ts': `
import {Injectable} from '@angular/core';
@Injectable({providedIn: 'root'})
export class FetchService {
  fire() { fetch('/api/fire'); }
  async read() { const response = await fetch('/api/read'); return response.json(); }
  chained() { return fetch('/api/chained').then(response => response.json()); }
}`,
}, ({ context }) => {
  const flows = analyzeHttpFlows(context, analyzeHttp(context));
  const fire = flowFor(flows, '/api/fire');
  assert.equal(fire.start, 'confirmed');
  assert.equal(fire.consumption.kind, 'none');
  assert.match(fire.reason, /starts the request when it is called; its result is not read/);
  assert.equal(flowFor(flows, '/api/read').consumption.kind, 'promise-result');
  assert.equal(flowFor(flows, '/api/read').start, 'confirmed');
  assert.equal(flowFor(flows, '/api/chained').consumption.kind, 'promise-result');
}));

// P12-04
test('lastValueFrom, toSignal and the async pipe are each a confirmed subscription', async () => fixture({
  'client.ts': client,
  'main.ts': `
import {Component, inject, Injectable} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {forkJoin, lastValueFrom} from 'rxjs';
import {GeneratedClient} from './client';
@Injectable({providedIn: 'root'})
export class SettingsService {
  private readonly client = inject(GeneratedClient);
  async all() { return lastValueFrom(forkJoin([this.client.load(), this.client.save({id: 'a'})])); }
}
@Component({selector: 'app-signal', template: ''})
export class SignalWidget {
  private readonly client = inject(GeneratedClient);
  readonly rows = toSignal(this.client.search('x'));
}
@Component({selector: 'app-async', template: '<span>{{ audit$ | async }}</span>'})
export class AsyncWidget {
  private readonly client = inject(GeneratedClient);
  readonly audit$ = this.client.audit('x');
}`,
}, ({ context, catalog }) => {
  const http = analyzeHttp(context);
  const flows = analyzeHttpFlows(context, http, { catalog });
  for (const url of ['/api/items', '/api/search', '/api/audit']) assert.equal(flowFor(flows, url).start, 'confirmed', url);
  assert.equal(flowFor(flows, '/api/items').consumption.kind, 'promise-consume');
  assert(flowFor(flows, '/api/items').consumption.conditions.some(item => item.includes('forkJoin passes the subscription')));
  assert.equal(flowFor(flows, '/api/search').consumption.kind, 'to-signal');
  assert.equal(flowFor(flows, '/api/audit').consumption.kind, 'async-pipe');
  // Without the component catalog the template subscription cannot be confirmed and is not assumed.
  const blind = analyzeHttpFlows(context, http);
  assert.equal(flowFor(blind, '/api/audit').start, 'candidate');
  assert(flowFor(blind, '/api/audit').consumption.gaps.some(item => item.includes('no component catalog was supplied')));
}));

// P12-04 / P12-06 / P12-07
test('a flattened request inside an effect needs the effect registration', async () => fixture({
  'client.ts': client,
  'main.ts': `
import {Component, inject, Injectable} from '@angular/core';
import {Actions, createEffect, ofType, provideEffects} from '@ngrx/effects';
import {createAction, props, provideStore} from '@ngrx/store';
import {map, switchMap, retry} from 'rxjs';
import {GeneratedClient, Item} from './client';
export const load = createAction('[Items] Load');
export const loaded = createAction('[Items] Loaded', props<{items: Item[]}>());
@Injectable()
export class ItemEffects {
  private readonly actions$ = inject(Actions);
  private readonly client = inject(GeneratedClient);
  load$ = createEffect(() => this.actions$.pipe(ofType(load),
    switchMap(() => this.client.load().pipe(retry(1), map(items => loaded({items}))))));
}
@Injectable()
export class AuditEffects {
  private readonly actions$ = inject(Actions);
  private readonly client = inject(GeneratedClient);
  audit$ = createEffect(() => this.actions$.pipe(ofType(load), switchMap(() => this.client.audit('x'))));
}
@Component({selector: 'app-root', template: ''}) export class Root {}
export const rootProviders = [provideStore(), provideEffects(ItemEffects)];`,
}, ({ context, catalog, expr }) => {
  const store = analyzeStore(context, catalog, { rootProviders: [expr('rootProviders')] });
  const flows = analyzeHttpFlows(context, analyzeHttp(context), { store });
  const registered = flowFor(flows, '/api/items');
  assert.equal(registered.consumption.kind, 'effect-flattening');
  assert.equal(registered.start, 'confirmed');
  assert(registered.consumption.registration.some(item => /effect at .* is registered/.test(item)));
  // The pipeline branches of both the inner and the outer pipe are kept.
  assert.deepEqual(registered.consumption.branches.map(item => item.operator).sort(), ['retry', 'switchMap']);
  assert(!registered.consumption.gaps.some(item => item.includes('ofType')));
  // An effect class that is never registered does not start a request.
  const unregistered = flowFor(flows, '/api/audit');
  assert.equal(unregistered.consumption.kind, 'effect-flattening');
  assert.equal(unregistered.start, 'candidate');
  assert.match(unregistered.reason, /is not registered/);
}));

test('a selected effect follows constructor injected wrappers and keeps its filter and Action branches', async () => fixture({
  'main.ts': `
import {Injectable} from '@angular/core';
import {HttpClient, provideHttpClient} from '@angular/common/http';
import {Actions, createEffect, ofType, provideEffects} from '@ngrx/effects';
import {createAction, provideStore} from '@ngrx/store';
import {catchError, filter, mergeMap} from 'rxjs';
export const save = createAction('[Record] Save');
export const saved = createAction('[Record] Saved');
export const extra = createAction('[Record] Extra');
export const failed = createAction('[Record] Failed');
export function downloadObjectAsJson(value: unknown) { void value; }
@Injectable() export class Transport {
  constructor(private http: HttpClient) {}
  post(url: string) { return this.http.post(url, {}); }
}
@Injectable() export class RecordApi {
  constructor(private transport: Transport) {}
  update() { return this.transport.post('/api/items/update'); }
  unrelated() { return this.transport.post('/unrelated'); }
}
@Injectable() export class SaveEffects {
  constructor(private actions$: Actions, private api: RecordApi) {}
  save$ = createEffect(() => this.actions$.pipe(ofType(save), filter((action: any) => action.valid),
    mergeMap((action: any) => this.api.update().pipe(
      mergeMap(() => { downloadObjectAsJson(action); return [saved(), ...(action.more ? [extra()] : [])]; }),
      catchError(() => [failed()])))));
}
@Injectable() export class UnusedEffects {
  constructor(private actions$: Actions, private api: RecordApi) {}
  unused$ = createEffect(() => this.actions$.pipe(ofType(save), mergeMap(() => this.api.unrelated())));
}
export const rootProviders = [provideStore(), provideHttpClient(), Transport, RecordApi, provideEffects(SaveEffects)];`,
}, ({ context, catalog, expr }) => {
  const providers = [expr('rootProviders')];
  const store = analyzeStore(context, catalog, { rootProviders: providers });
  const http = analyzeHttp(context);
  const layers = [{ id: 'root', kind: 'root', providers }];
  const selected = store.effects.find(item => item.id.includes('save$'));
  const unused = store.effects.find(item => item.id.includes('unused$'));
  assert.equal(selected.registered, true);
  assert.equal(unused.registered, false);
  const trace = traceHttpFromEffect(context, http, selected, { catalog, store, layers });
  assert.deepEqual(trace.steps.filter(step => step.kind === 'http-consume').map(step => step.source),
    ['POST /api/items/update']);
  const modelEdges = httpTraceEdges(trace);
  assert.deepEqual(modelEdges.filter(edge => edge.kind === 'http-create')
    .map(edge => edge.details.urlExpression.value), ['/api/items/update']);
  assert(modelEdges.find(edge => edge.kind === 'http-create').details.tracePath.value.includes('main.ts:'));
  const download = trace.steps.find(step => step.kind === 'call' && step.target === 'downloadObjectAsJson');
  assert(download, 'the success callback side effect is retained in the HTTP trace');
  assert(download.conditions.includes('successful source notification'));
  assert(!trace.steps.some(step => JSON.stringify(step).includes('/unrelated')));
  assert(trace.steps.find(step => step.kind === 'http-consume').conditions.some(item =>
    item.includes('filter requires')));
  assert.deepEqual(selected.emits.map(id => id.slice(id.lastIndexOf(':') + 1)).sort(),
    ['extra', 'failed', 'saved']);
  assert(selected.emissionConditions[selected.emits.find(id => id.endsWith(':extra'))].some(item =>
    item.includes('action.more')));
  const idle = traceHttpFromEffect(context, http, unused, { catalog, store, layers });
  assert.deepEqual(idle.steps.filter(step => step.kind === 'http-consume'), []);
}));

// P12-04 / P12-07
test('an rxMethod pipeline starts a request only once the method is called', async () => fixture({
  'client.ts': client,
  'main.ts': `
import {Component, inject} from '@angular/core';
import {signalStore, withMethods} from '@ngrx/signals';
import {rxMethod} from '@ngrx/signals/rxjs-interop';
import {pipe, switchMap} from 'rxjs';
import {GeneratedClient} from './client';
export const SearchStore = signalStore({providedIn: 'root'},
  withMethods((store, client = inject(GeneratedClient)) => ({
    search: rxMethod<string>(pipe(switchMap((key: string) => client.search(key)))),
    audit: rxMethod<string>(pipe(switchMap((key: string) => client.audit(key)))),
  })));
@Component({selector: 'app-root', template: ''})
export class Root {
  private readonly store = inject(SearchStore);
  run() { this.store.search('x'); }
}`,
}, ({ context }) => {
  const methods = analyzeReactiveMethods(context, catalogSignalStores(context));
  const flows = analyzeHttpFlows(context, analyzeHttp(context), { methods });
  const called = flowFor(flows, '/api/search');
  assert.equal(called.consumption.kind, 'rx-method');
  assert.equal(called.start, 'confirmed');
  assert(called.consumption.registration.some(item => item.includes('is called')));
  const never = flowFor(flows, '/api/audit');
  assert.equal(never.consumption.kind, 'rx-method');
  assert.equal(never.start, 'candidate');
  assert.match(never.reason, /never called/);
  // The registration is unconfirmed without the reactive method graph, so the request stays a candidate.
  const blind = analyzeHttpFlows(context, analyzeHttp(context));
  assert.equal(flowFor(blind, '/api/search').start, 'candidate');
  assert.match(flowFor(blind, '/api/search').reason, /no reactive method graph was supplied/);
}));

// P12-04
test('a withEventHandlers subscription starts a request only for a created Store', async () => fixture({
  'client.ts': client,
  'main.ts': `
import {Component, inject} from '@angular/core';
import {signalStore, withState} from '@ngrx/signals';
import {event, eventGroup, Events, withEventHandlers} from '@ngrx/signals/events';
import {type} from '@ngrx/signals';
import {switchMap} from 'rxjs';
import {GeneratedClient} from './client';
export const pageEvents = eventGroup({source: 'Page', events: {opened: type<void>()}});
export const LogStore = signalStore(withState({rows: 0}),
  withEventHandlers((store, events = inject(Events), client = inject(GeneratedClient)) => ({
    rows$: events.on(pageEvents.opened).pipe(switchMap(() => client.load())),
  })));
export const IdleStore = signalStore(withState({rows: 0}),
  withEventHandlers((store, events = inject(Events), client = inject(GeneratedClient)) => ({
    audit$: events.on(pageEvents.opened).pipe(switchMap(() => client.audit('x'))),
  })));
@Component({selector: 'app-root', template: ''})
export class Root { private readonly store = inject(LogStore); }`,
}, ({ context }) => {
  const stores = catalogSignalStores(context);
  const flows = analyzeHttpFlows(context, analyzeHttp(context), { stores });
  const live = flowFor(flows, '/api/items');
  assert.equal(live.consumption.kind, 'event-handler');
  assert.equal(live.start, 'confirmed');
  assert(live.consumption.registration.some(item => /LogStore is created/.test(item)));
  const idle = flowFor(flows, '/api/audit');
  assert.equal(idle.consumption.kind, 'event-handler');
  assert.equal(idle.start, 'candidate');
  assert.match(idle.reason, /declared but never created/);
}));

test('fromFetch in a selected SignalStore handler is conditional and an unused handler stays idle', async () => fixture({
  'main.ts': `
import {Component, inject} from '@angular/core';
import {signalStore, withState, type} from '@ngrx/signals';
import {eventGroup, Events, withEventHandlers} from '@ngrx/signals/events';
import {fromFetch} from 'rxjs/fetch';
import {of, switchMap} from 'rxjs';
export const logEvents = eventGroup({source: 'Log', events: {download: type<void>()}});
export const LogStore = signalStore(withState({ready: false}),
  withEventHandlers((store, events = inject(Events)) => ({
    download$: events.on(logEvents.download).pipe(switchMap(() => store.ready()
      ? fromFetch('/api/logs/download', {method: 'POST'}) : of(null))),
  })));
export const IdleStore = signalStore(withState({ready: false}),
  withEventHandlers((store, events = inject(Events)) => ({
    idle$: events.on(logEvents.download).pipe(switchMap(() => fromFetch('/unused'))),
  })));
@Component({selector: 'app-root', template: ''})
export class Root { private readonly store = inject(LogStore); }`,
}, ({ context, catalog }) => {
  const stores = catalogSignalStores(context);
  const events = analyzeEvents(context, stores);
  const http = analyzeHttp(context);
  const [live, idle] = events.consumers.filter(item => item.kind === 'handler')
    .sort((left, right) => Number(left.source.split(':').at(-2)) - Number(right.source.split(':').at(-2)));
  assert(live && idle);
  const trace = traceHttpFromEventConsumer(context, http, live, { catalog, stores });
  assert.deepEqual(trace.steps.filter(step => step.kind === 'http-consume').map(step => step.source),
    ['POST /api/logs/download']);
  assert(trace.steps.find(step => step.kind === 'http-consume').conditions.some(item =>
    item.includes('store.ready()')));
  assert(!trace.steps.some(step => JSON.stringify(step).includes('/unused')));
  const unused = traceHttpFromEventConsumer(context, http, idle, { catalog, stores });
  assert.deepEqual(unused.steps.filter(step => step.kind === 'http-consume'), []);
}));

test('a stop at an external package receiver says so, while an app receiver keeps the DI reason', async () => fixture({
  'main.ts': `
import {Injectable} from '@angular/core';
import {HttpClient, provideHttpClient} from '@angular/common/http';
import {Store, createAction, provideStore} from '@ngrx/store';
import {Actions, createEffect, ofType, provideEffects} from '@ngrx/effects';
import {mergeMap, tap} from 'rxjs';
export const save = createAction('[Record] Save');
@Injectable() export class Audit { note() { return 1; } }
@Injectable() export class RecordApi {
  constructor(private http: HttpClient) {}
  update() { return this.http.post('/api/items/update', {}); }
}
@Injectable() export class SaveEffects {
  constructor(private actions$: Actions, private api: RecordApi, private store: Store,
    private audit: Audit) {}
  save$ = createEffect(() => this.actions$.pipe(ofType(save),
    tap(() => this.store.dispatch(save())),
    tap(() => this.audit.note()),
    mergeMap(() => this.api.update())));
}
export const rootProviders = [provideStore(), provideHttpClient(), RecordApi, provideEffects(SaveEffects)];`,
}, ({ context, catalog, expr }) => {
  const providers = [expr('rootProviders')];
  const store = analyzeStore(context, catalog, { rootProviders: providers });
  const layers = [{ id: 'root', kind: 'root', providers }];
  const selected = store.effects.find(item => item.id.includes('save$'));
  const trace = traceHttpFromEffect(context, analyzeHttp(context), selected, { catalog, store, layers });
  const stops = trace.steps.filter(step => step.kind === 'boundary');
  // Store and HttpClient come from packages whose sources §4.2 does not traverse; Audit is the app's own
  // class with no provider in the selected injector, which stays an unresolved injection.
  const external = stops.filter(step => step.detail.includes('external package type'));
  assert.deepEqual(external.map(step => step.target).sort(), ['http.post', 'store.dispatch']);
  assert(external.every(step => step.conditions.some(item => item.includes('external package'))));
  const unresolved = stops.filter(step => step.detail.includes('not uniquely resolved by DI'));
  assert.deepEqual(unresolved.map(step => step.target), ['audit.note']);
  assert(unresolved[0].conditions.some(item => item.startsWith('no provider for')));
  assert(trace.steps.some(step => step.kind === 'http-consume' && step.source === 'POST /api/items/update'),
    'the request the effect does reach is unaffected');
}));
