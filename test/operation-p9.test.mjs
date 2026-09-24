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
import { indexTemplates, matchingElements } from '../dist/index/templates.js';
import { resolveElementBindings, traceOperation, inspectAsyncPipe } from '../dist/resolve/operation/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(source, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p9-'));
  try {
    await mkdir(path.join(root, 'src'));
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), source);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const index = await indexTemplates(context, catalog);
    await check({ context, catalog, index, find: id => matchingElements(index, { kind: 'attribute', name: 'data-id', value: id })[0] });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('input/output aliases, model two-way, defaults, and static directive inputs stay per occurrence', async () => fixture(`
import {Component, Directive, input, model, output} from '@angular/core';
@Directive({selector:'[tag]'}) export class Tag { text=input('fallback',{alias:'tag'}); }
@Component({selector:'child-box',template:''}) export class Child {
  title=input('untitled',{alias:'heading'}); count=model(1,{alias:'amount'}); changed=output<string>({alias:'done'});
}
@Component({selector:'app-root',imports:[Child,Tag],template:
  '<child-box data-id="one" [heading]="name" [(amount)]="num" (done)="save($event)" tag="red" /><child-box data-id="two" tag="blue" />'})
export class Root {name='a'; num=3; save(v:string){} }
`, ({context,catalog,find}) => {
  const one = resolveElementBindings(find('one'), context, catalog);
  const two = resolveElementBindings(find('two'), context, catalog);
  assert(one.relations.some(r => r.alias === 'heading' && r.source === 'property'));
  assert(one.relations.some(r => r.alias === 'amount' && r.source === 'two-way'));
  assert(one.relations.some(r => r.alias === 'amountChange' && r.source === 'two-way'));
  assert(one.relations.some(r => r.alias === 'tag' && r.source === 'attribute' && r.expression === 'red'));
  assert(one.relations.some(r => r.alias === 'done' && r.kind === 'output-subscription'));
  assert(!one.relations.some(r => r.alias === 'heading' && r.source === 'default'));
  assert(two.relations.some(r => r.alias === 'heading' && r.source === 'default' && r.expression === "'untitled'"));
}));

test('direct emit and Subject route remain distinct, with registration and debounce timing', async () => fixture(`
import {Component, output} from '@angular/core';
import {Subject, debounceTime, filter, tap} from 'rxjs';
@Component({selector:'app-root',template:'<button data-id="clear" (click)="clear()"></button>'})
export class Root {
  changed=output<string>(); value$=new Subject<string>();
  constructor() { this.value$.pipe(debounceTime(0), filter(v=>v.length===0), tap(v=>this.changed.emit(v))).subscribe(); }
  clear() { this.changed.emit(''); this.value$.next(''); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'clear');
  assert.equal(trace.registrations.length, 1);
  assert.equal(trace.registrations[0].context, 'constructor');
  assert.equal(trace.steps.filter(s => s.kind === 'output-emit').length, 2);
  assert.equal(new Set(trace.steps.filter(s => s.kind === 'output-emit').map(s => s.path.join('|'))).size, 2);
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'debounceTime' && s.timing === 'timer'));
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'filter' && s.conditions.some(c => c.includes('predicate'))));
}));

test('unknown operator stops propagation and same-name user function is not RxJS', async () => fixture(`
import {Component, output} from '@angular/core';
import {Subject, map} from 'rxjs';
const fake = (fn:any) => fn;
@Component({selector:'app-root',template:''}) export class Root {
  changed=output<string>(); value$=new Subject<string>();
  constructor() { this.value$.pipe(map(v=>v), fake(v=>v), map(v=>v)).subscribe(v=>this.changed.emit(v)); }
  run() { this.value$.next('x'); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'run');
  assert(trace.steps.some(s => s.kind === 'boundary' && s.detail?.includes('unknown operator fake')));
  assert(!trace.steps.some(s => s.kind === 'output-emit'));
  assert.equal(trace.steps.filter(s => s.kind === 'reactive-link' && s.target === 'map').length, 1);
}));

test('decorator aliases, transforms, ngOnChanges and async EventEmitter retain boundaries', async () => fixture(`
import {Component, Input, Output, EventEmitter} from '@angular/core';
@Component({selector:'child-box',template:''}) export class Child {
  @Input({alias:'shown', transform: (v:string)=>v.trim()}) value='base';
  @Output('done') finished=new EventEmitter<string>(true);
  ngOnChanges() {}
}
@Component({selector:'app-root',imports:[Child],template:'<child-box data-id="item" [shown]="name" (done)="save($event)" />'})
export class Root {name=' a '; save(v:string){} }
`, ({context,catalog,find}) => {
  const result = resolveElementBindings(find('item'), context, catalog);
  assert(result.relations.some(r => r.kind === 'input-binding' && r.alias === 'shown' && r.conditions.some(c => c.includes('transform'))));
  assert(result.relations.some(r => r.kind === 'input-change' && r.member === 'ngOnChanges'));
  assert(result.relations.some(r => r.alias === 'done' && r.conditions.some(c => c.includes('asynchronously'))));
}));

test('signal writes and package-created Observable inputs are typed without matching user names', async () => fixture(`
import {Component, signal, computed} from '@angular/core';
import {from, firstValueFrom, of} from 'rxjs';
const signalFake = (x:any) => ({set(v:any){}});
@Component({selector:'app-root',template:''}) export class Root {
  count=signal(0); fake=signalFake(0); double=computed(()=>this.count()*2);
  run() { this.count.set(1); this.fake.set(2); const values=from(Promise.resolve([1]));
    firstValueFrom(values); of(1); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'run');
  assert(trace.steps.some(s => s.kind === 'state-write' && s.target === 'count'));
  assert(!trace.steps.some(s => s.kind === 'state-write' && s.target === 'fake'));
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'from'));
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'firstValueFrom' && s.timing === 'microtask'));
}));

test('one emit source reached twice keeps two operation paths and one evidence location', async () => fixture(`
import {Component, output} from '@angular/core';
import {Subject, tap} from 'rxjs';
@Component({selector:'app-root',template:''}) export class Root {
  changed=output<string>(); value$=new Subject<string>();
  constructor() { this.value$.pipe(tap(()=>this.emitNow())).subscribe(); }
  emitNow() { this.changed.emit(''); }
  clear() { this.emitNow(); this.value$.next(''); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'clear');
  const emits = trace.steps.filter(s => s.kind === 'output-emit');
  assert.equal(emits.length, 2);
  assert.equal(emits[0].location, emits[1].location);
  assert.notDeepEqual(emits[0].path, emits[1].path);
  assert.equal(trace.evidence.filter(e => e === emits[0].location).length, 1);
}));

test('a user pipe named async is not treated as Angular AsyncPipe', async () => fixture(`
import {Component, Pipe, PipeTransform} from '@angular/core';
@Pipe({name:'async'}) export class FakeAsync implements PipeTransform { transform(v:any){return v;} }
@Component({selector:'app-root',imports:[FakeAsync],template:'<div data-id="text">{{ value | async }}</div>'})
export class Root {value='x';}
`, ({context,catalog,find}) => {
  const consumers = inspectAsyncPipe(find('text'), context, catalog);
  assert.equal(consumers.length, 1);
  assert.equal(consumers[0].status, 'boundary');
}));

test('registration conditions include lifecycle, branch, destruction, and unsubscribe evidence', async () => fixture(`
import {Component, output} from '@angular/core';
import {Subject, take} from 'rxjs';
@Component({selector:'app-root',template:''}) export class Root {
  value$=new Subject<number>(); done=output<number>(); sub:any;
  enabled=true;
  ngOnInit() { if(this.enabled) this.sub=this.value$.pipe(take(1)).subscribe(v=>this.done.emit(v)); }
  ngOnDestroy() { this.sub?.unsubscribe(); }
  run() { this.value$.next(3); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'run');
  const registration = trace.registrations[0];
  assert.equal(registration.context, 'ngOnInit');
  assert(registration.conditions.some(c => c.includes('requires this.enabled')));
  assert(registration.conditions.some(c => c.includes('take limit')));
  assert(registration.conditions.some(c => c.includes('unsubscribe call')));
  assert(trace.steps.some(s => s.kind === 'output-emit' && s.conditions.some(c => c.includes('requires this.enabled'))));
}));

test('Angular Forms accessor and Common AsyncPipe are recognized from their scoped packages', async () => fixture(`
import {Component} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {of} from 'rxjs';
@Component({selector:'app-root',imports:[CommonModule,FormsModule],template:
  '<input data-id="form" [(ngModel)]="value"><div data-id="async">{{ stream$ | async }}</div>'})
export class Root { value='a'; stream$=of('ready'); }
`, ({context,catalog,find}) => {
  const form = resolveElementBindings(find('form'), context, catalog);
  assert(form.relations.some(r => r.kind === 'form-accessor' && r.targetId?.endsWith('#DefaultValueAccessor')));
  const async = inspectAsyncPipe(find('async'), context, catalog);
  assert.equal(async.length, 1);
  assert.equal(async[0].status, 'resolved');
  assert.match(async[0].expression, /stream\$/);
  assert(async[0].conditions.some(c => c.includes('view is destroyed')));
}));

test('RxJS operator families retain their scheduling and cancellation conditions', async () => fixture(`
import {Component, output} from '@angular/core';
import {Subject, of, timer, map, tap, filter, debounce, debounceTime,
  switchMap, mergeMap, concatMap, exhaustMap, withLatestFrom, take,
  catchError, distinctUntilChanged, forkJoin, lastValueFrom} from 'rxjs';
import {concatLatestFrom, tapResponse, mapResponse} from '@ngrx/operators';
@Component({selector:'app-root',template:''}) export class Root {
  source=new Subject<number>(); done=output<number>();
  constructor() {
    this.source.pipe(map(v=>v), tap(v=>this.done.emit(v)), filter(v=>v>0),
      debounce(()=>timer(0)), debounceTime(0), distinctUntilChanged(),
      switchMap(v=>of(v)), mergeMap(v=>of(v)), concatMap(v=>of(v)), exhaustMap(v=>of(v)),
      withLatestFrom(of(1)), concatLatestFrom(()=>of(2)), take(1),
      catchError(()=>of([0,0,0])), tapResponse({next:()=>{},error:()=>{}}),
      mapResponse({next:v=>v,error:()=>[0,0,0]})).subscribe();
  }
  run() { this.source.next(1); lastValueFrom(forkJoin([of(1),of(2)])); }
}
`, ({context,catalog}) => {
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'run');
  const links = trace.steps.filter(s => s.kind === 'reactive-link');
  for (const name of ['map','tap','filter','debounce','debounceTime','switchMap','mergeMap','concatMap',
    'exhaustMap','withLatestFrom','concatLatestFrom','take','catchError','distinctUntilChanged',
    'tapResponse','mapResponse','forkJoin','lastValueFrom'])
    assert(links.some(s => s.target === name), name);
  assert(links.some(s => s.target === 'switchMap' && s.conditions.some(c => c.includes('cancels'))));
  assert(links.some(s => s.target === 'mergeMap' && s.conditions.some(c => c.includes('overlap'))));
  assert(links.some(s => s.target === 'concatMap' && s.conditions.some(c => c.includes('queued'))));
  assert(links.some(s => s.target === 'exhaustMap' && s.conditions.some(c => c.includes('ignored'))));
  assert(links.some(s => s.target === 'withLatestFrom' && s.conditions.some(c => c.includes('background read'))));
}));

test('required input, state writes, effect registration, async output, and DestroyRef lifetime stay distinct', async () => fixture(`
import {Component, Input, Output, EventEmitter, input, signal, computed, effect} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Subject} from 'rxjs';
@Component({selector:'child-box',template:''}) export class Child {name=input.required<string>({alias:'requiredName'});}
@Component({selector:'app-root',imports:[Child],template:'<child-box data-id="child" [requiredName]="title" />'})
export class Root {
  title='x'; count=signal(0); source=new Subject<number>();
  @Output() changed=new EventEmitter<number>(true);
  constructor() { this.source.pipe(takeUntilDestroyed()).subscribe(v=>this.changed.emit(v)); }
  run() { this.title='y'; this.count.update(v=>v+1); computed(()=>this.count());
    effect(()=>this.count()); this.source.next(1); }
}
`, ({context,catalog,find}) => {
  const binding = resolveElementBindings(find('child'), context, catalog);
  assert(binding.relations.some(r => r.alias === 'requiredName' && r.source === 'property'));
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const trace = traceOperation(context, owner, 'run');
  assert(trace.steps.some(s => s.kind === 'state-write' && s.target === 'this.title'));
  assert(trace.steps.some(s => s.kind === 'state-write' && s.target === 'count'));
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'computed'));
  assert(trace.steps.some(s => s.kind === 'reactive-link' && s.target === 'effect' && s.timing === 'change-detection'));
  assert(trace.steps.some(s => s.kind === 'output-emit' && s.timing === 'async-output'));
  assert(trace.registrations[0].conditions.some(c => c.includes('DestroyRef')));
}));
