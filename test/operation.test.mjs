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
import { resolveEventListeners, resolveTemplateExpressions, uiEvents } from '../dist/resolve/operation/index.js';
import { resolveViewPaths } from '../dist/resolve/view/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(files, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-op-'));
  try {
    await mkdir(path.join(root, 'src'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const index = await indexTemplates(context, catalog);
    const find = id => matchingElements(index, { kind: 'attribute', name: 'data-id', value: id })[0];
    await check({ context, catalog, index, find });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('DOM bubbling stays separate from same-name output subscription and non-bubbling events', async () => fixture({
  'src/main.ts': "import {Component,Directive,output} from '@angular/core'; @Directive({selector:'[mark]',outputs:['changed']}) export class Mark {changed=output();} @Component({selector:'child-box',template:''}) export class Child {changed=output();} @Component({selector:'app-root',imports:[Child,Mark],template:'<div (click)=\"outer()\" (focus)=\"outer()\" (changed)=\"outer()\"><button data-id=target mark (click)=\"inner($event)\" (changed)=\"inner($event)\" (focus)=\"inner($event)\"></button></div>'}) export class Root { outer(){} inner(e:Event){} }",
}, ({ context, catalog, find }) => {
  const selected = find('target');
  const click = resolveEventListeners(selected, context, catalog, 'click');
  assert.equal(click.listeners.length, 2);
  assert.equal(click.listeners[0].listenerElement, selected);
  assert.equal(click.listeners[1].listenerElement.tag, 'div');
  assert(click.derivedEvents.some(item => item.from === 'click' && item.to === 'submit' && item.status === 'boundary'));
  assert.equal(click.outputSubscriptions.length, 0);
  const changed = resolveEventListeners(selected, context, catalog, 'changed');
  assert.equal(changed.listeners.length, 1, 'unknown CustomEvent on target remains unresolved');
  assert.equal(changed.listeners[0].status, 'unresolved');
  assert.equal(changed.outputSubscriptions.length, 1);
  assert.equal(changed.outputSubscriptions[0].eventSource, 'directive-output');
  const focus = resolveEventListeners(selected, context, catalog, 'focus');
  assert.equal(focus.listeners.length, 1, 'focus cannot bubble to div');
  assert.equal(uiEvents.focus.bubbles, false);
}));

test('explicit capture can observe a non-bubbling focus event, while unknown custom events stay unresolved', async () => fixture({
  'src/main.ts': "import {Component,ElementRef,inject} from '@angular/core'; @Component({selector:'app-root',template:'<div (focus)=\"hit()\"><input data-id=target (focus)=\"hit()\"></div>'}) export class Root {host=inject(ElementRef); hit(){} install(){this.host.nativeElement.addEventListener('focus', () => this.hit(), {capture:true}); document.addEventListener('focus', () => this.hit(), true);} }",
}, ({ context, catalog, find }) => {
  const focus = resolveEventListeners(find('target'), context, catalog, 'focus');
  assert.equal(focus.listeners.filter(item => item.registration === 'template').length, 1);
  assert.equal(focus.listeners.filter(item => item.registration === 'capture').length, 2);
  assert(focus.listeners.some(item => item.eventSource === 'host-dom' && item.status === 'conditional'));
  assert(focus.listeners.some(item => item.eventSource === 'global' && item.listenerElement === null));
}));

test('exportAs references bind to the directive and local names remain ahead of private members', async () => fixture({
  'src/main.ts': "import {Component,Directive} from '@angular/core'; @Directive({selector:'[editable]',exportAs:'edit'}) export class Edit {go(){}} @Component({selector:'app-root',imports:[Edit],template:'<button editable #tool=\"edit\" data-id=target (click)=\"tool.go(); this.tool()\"></button>'}) export class Root {private tool(){} }",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  assert(result.references.some(ref => ref.name === 'tool' && ref.kind === 'reference' && ref.targetIds.some(id => id.endsWith('#Edit'))));
  assert(result.calls.some(call => call.callee === 'go' && call.status === 'resolved'));
  assert(result.calls.some(call => call.callee === 'tool' && call.diagnostics.some(item => item.includes('Private'))));
}));

test('TypeScript errors annotate a syntactically identified method without claiming the app runs', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'app-root',template:'<button data-id=target (click)=\"run()\"></button>'}) export class Root {broken:number='bad'; run(){}}",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  const run = result.calls.find(call => call.callee === 'run');
  assert(run?.target);
  assert(run.diagnostics.some(message => message.includes("Type 'string'")));
}));

test('lexical names shadow members, this bypasses shadowing, and private members remain diagnostic', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'app-root',template:'@let value = 3; @for (item of items; track item) {<button data-id=target #self (click)=\"use(value, item, self, this.value); hidden()\"></button>}'}) export class Root {value=1; items=[1]; private hidden(){} use(...args:unknown[]){} }",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  assert(result.references.some(ref => ref.name === 'value' && ref.kind === 'local'));
  assert(result.references.some(ref => ref.name === 'value' && ref.kind === 'member'));
  assert(result.references.some(ref => ref.name === 'item' && ref.kind === 'local'));
  assert(result.references.some(ref => ref.name === 'self' && ref.kind === 'reference' && ref.origin === 'dom-element'));
  assert(result.calls.some(call => call.callee === 'use' && call.status === 'resolved'));
  assert(result.calls.some(call => call.callee === 'hidden' && call.diagnostics.some(item => item.includes('Private'))));
}));

test('query keeps optional and required creation conditions without treating a type as an instance', async () => fixture({
  'src/main.ts': "import {Component,viewChild} from '@angular/core'; @Component({selector:'child-box',template:''}) export class Child { run(){} } @Component({selector:'app-root',imports:[Child],template:'<child-box #kid data-id=target (click)=\"this.chosen()?.run(); this.must().run()\"></child-box>'}) export class Root {chosen=viewChild<Child>('kid'); must=viewChild.required<Child>('kid');}",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  assert(result.queries.some(query => query.member === 'chosen' && query.conditions.some(item => item.includes('undefined')) && query.occurrences.length === 1));
  assert(result.queries.some(query => query.member === 'must' && query.conditions.some(item => item.includes('can fail'))));
  assert(result.calls.some(call => call.status === 'unresolved' && call.callee === 'run'));
}));

test('global listeners have no invented element and stopPropagation differs from preventDefault', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'app-root',template:'<div (click)=\"outer()\" (window:keydown)=\"outer()\"><span (click)=\"$event.preventDefault()\"><button data-id=target (click)=\"$event.stopPropagation()\"></button></span></div>'}) export class Root {outer(){}}",
}, ({ context, catalog, find }) => {
  const click = resolveEventListeners(find('target'), context, catalog, 'click');
  assert.equal(click.listeners.length, 3);
  assert(click.listeners.at(-1).conditions.some(item => item.includes('stop propagation')));
  assert(!click.listeners.at(-1).conditions.some(item => item.includes('preventDefault')));
  const keydown = resolveEventListeners(find('target'), context, catalog, 'keydown');
  assert.equal(keydown.listeners.length, 1);
  assert.equal(keydown.listeners[0].eventSource, 'global');
  assert.equal(keydown.listeners[0].listenerElement, null);
}));

test('component output alias and component reference resolve without making the output a DOM ancestor', async () => fixture({
  'src/main.ts': "import {Component,output} from '@angular/core'; class Base { changed=output({alias:'valueChanged'}); run(){} } @Component({selector:'child-box',template:''}) export class Child extends Base {} @Component({selector:'app-root',imports:[Child],template:'<div (click)=\"onClick()\"><child-box #child data-id=target (valueChanged)=\"onClick()\" (click)=\"child.run()\"></child-box></div>'}) export class Root {onClick(){}}",
}, ({ context, catalog, index, find }) => {
  const selected = find('target');
  const click = resolveEventListeners(selected, context, catalog, 'click');
  assert.equal(click.listeners.length, 2);
  const output = resolveEventListeners(selected, context, catalog, 'valueChanged');
  assert.equal(output.outputSubscriptions.length, 1);
  assert.equal(output.outputSubscriptions[0].eventSource, 'component-output');
  assert(output.outputSubscriptions[0].conditions.some(item => item.includes('explicit output emit')));
  const expression = resolveTemplateExpressions(selected, context, catalog, index);
  assert(expression.references.some(ref => ref.name === 'child' && ref.origin === 'component-host'));
  assert(expression.calls.some(call => call.callee === 'run' && call.status === 'resolved'));
}));

test('a view path can supply a component host DOM ancestor without inventing an output bubble', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'child-box',template:'<button data-id=target></button>'}) export class Child {} @Component({selector:'app-root',imports:[Child],template:'<div (click)=\"hit()\"><child-box></child-box></div>'}) export class Root {hit(){}}",
}, ({ context, catalog, index, find }) => {
  const selected = find('target');
  const view = resolveViewPaths(selected, context, catalog, index);
  const path = view.paths.find(item => item.steps.some(step => step.relation === 'component-use'));
  assert(path);
  const click = resolveEventListeners(selected, context, catalog, 'click', { index, path });
  assert(click.listeners.some(listener => listener.listenerElement?.tag === 'div'));
}));

test('key modifiers, disabled controls and shadow retargeting remain conditions', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'app-root',template:'<div (keydown)=\"hit()\"><button disabled data-id=target (keydown.enter)=\"hit()\"></button></div>'}) export class Root {hit(){}}",
}, ({ context, catalog, find }) => {
  const result = resolveEventListeners(find('target'), context, catalog, 'keydown');
  assert.equal(result.listeners.length, 2);
  assert.deepEqual(result.listeners[0].modifiers, ['enter']);
  assert(result.listeners[0].conditions.some(item => item.includes('must match')));
  assert(result.listeners.every(item => item.conditions.some(condition => condition.includes('disabled'))));
  assert(result.listeners[1].conditions.some(item => item.includes('retargeting')));
}));

test('fragment variables and scoped pipes resolve before TS members', async () => fixture({
  'src/main.ts': "import {Component,Pipe,PipeTransform} from '@angular/core'; @Pipe({name:'decorate'}) export class Decorate implements PipeTransform {transform(v:unknown){return v;}} @Component({selector:'app-root',imports:[Decorate],template:'<ng-template let-row><button data-id=target [title]=\"row | decorate\"></button></ng-template>'}) export class Root {row='member';}",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  assert(result.references.some(ref => ref.name === 'row' && ref.kind === 'local' && ref.origin.startsWith('fragment:')));
  assert(result.references.some(ref => ref.name === 'decorate' && ref.kind === 'pipe' && ref.targetIds.some(id => id.endsWith('#Decorate'))));
}));

test('content query keeps projected occurrences and read token separate from returned instance', async () => fixture({
  'src/main.ts': "import {Component,contentChild,ElementRef} from '@angular/core'; @Component({selector:'child-box',template:'<button data-id=target (click)=\"this.projection()\"></button><ng-content></ng-content>'}) export class Child {projection=contentChild('slot', {read:ElementRef});} @Component({selector:'app-root',imports:[Child],template:'<child-box><span #slot></span><span #slot></span></child-box>'}) export class Root {}",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  const query = result.queries.find(item => item.member === 'projection');
  assert.equal(query.kind, 'contentChild');
  assert.equal(query.occurrences.length, 2);
  assert.equal(query.read, 'ElementRef');
  assert(query.conditions.some(item => item.includes('not uniquely')));
  assert(query.conditions.some(item => item.includes('projected content')));
}));

test('function values and computed property calls stop at an unresolved boundary', async () => fixture({
  'src/main.ts': "import {Component} from '@angular/core'; @Component({selector:'app-root',template:'<button data-id=target (click)=\"fn(); registry[key]()\"></button>'}) export class Root {fn=()=>1; key='x'; registry:Record<string,()=>number>={x:()=>2};}",
}, ({ context, catalog, index, find }) => {
  const result = resolveTemplateExpressions(find('target'), context, catalog, index);
  assert(result.calls.some(call => call.callee === 'fn' && call.status === 'unresolved' && call.conditions.some(item => item.includes('function value'))));
  assert(result.calls.some(call => call.callee === '(computed property)' && call.status === 'unresolved'));
}));
