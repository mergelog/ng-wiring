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
import { resolveViewPaths, defaultViewLimits } from '../dist/resolve/view/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(fn, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-flow-'));
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
    await fn({ root, context, catalog, index,
      find: value => matchingElements(index, { kind: 'attribute', name: 'data-id', value }),
      resolve: (value, limit) => resolveViewPaths(matchingElements(index,
        { kind: 'attribute', name: 'data-id', value })[0], context, catalog, index, limit) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const flow = element => element.controlFlow.map(frame => frame.label);
const conditions = element => element.controlFlow.map(frame => frame.condition);

test('@if branches carry the negation of the branches declared before them', async () => fixture(({ find }) => {
  assert.deepEqual(conditions(find('then')[0]), ['(a)']);
  assert.deepEqual(conditions(find('elif')[0]), ['!(a) && (b)']);
  assert.deepEqual(conditions(find('else')[0]), ['!(a) && !(b)']);
  assert.deepEqual(flow(find('elif')[0]), ['@else if (b)']);
  assert.deepEqual(flow(find('else')[0]), ['@else']);
  const alias = find('alias')[0];
  assert.equal(alias.controlFlow[0].alias, 'u');
  assert(alias.controlFlow[0].notes.some(note => note.includes('alias u')));
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; @Component({selector:'ctl-view',templateUrl:'./ctl.html'}) export class Ctl { a=false; b=false; user(){return null;} }\n",
  'src/ctl.html': '@if (a) {<i data-id=then></i>} @else if (b) {<i data-id=elif></i>} @else {<i data-id=else></i>}\n@if (user(); as u) {<i data-id=alias></i>}\n' }));

test('@for keeps element existence and the empty collection as separate cases', async () => fixture(({ find }) => {
  const row = find('row')[0];
  assert.equal(row.repeated, true);
  assert.equal(row.controlFlow[0].kind, 'for');
  assert.equal(row.controlFlow[0].condition, 'items has at least one item');
  assert.equal(row.controlFlow[0].label, '@for (item of items; track item)');
  assert(row.controlFlow[0].notes.some(note => note.includes('iteration count is unknown')));
  const none = find('none')[0];
  assert.equal(none.repeated, false, 'the @empty branch is not a repeated view');
  assert.equal(none.controlFlow[0].kind, 'for-empty');
  assert.equal(none.controlFlow[0].condition, 'items is empty');
  // The legacy microsyntax keeps the same shape. The *ngFor anchor itself exists once; its content repeats.
  const [anchor, content] = find('legacy');
  assert.equal(anchor.node.constructor.name, 'Template');
  assert.equal(anchor.repeated, false);
  assert.deepEqual(anchor.controlFlow, []);
  assert.equal(content.repeated, true);
  assert.equal(content.controlFlow.at(-1).kind, 'for');
  assert.equal(content.controlFlow.at(-1).condition, 'items has at least one item');
  assert.equal(content.controlFlow.at(-1).label, '*ngFor (items)');
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; import {NgFor} from '@angular/common'; @Component({selector:'ctl-view',imports:[NgFor],templateUrl:'./ctl.html'}) export class Ctl { items=[1]; }\n",
  'src/ctl.html': '@for (item of items; track item) {<i data-id=row></i>} @empty {<i data-id=none></i>}\n<i *ngFor="let n of items" data-id=legacy></i>\n' }));

test('@switch keeps the switch expression paired with each case and default', async () => fixture(({ find }) => {
  assert.equal(find('one')[0].controlFlow[0].condition, 'mode === 1');
  assert.equal(find('one')[0].controlFlow[0].label, '@switch (mode) @case (1)');
  assert.equal(find('two')[0].controlFlow[0].condition, "mode === 'b'");
  assert.equal(find('other')[0].controlFlow[0].condition, "mode matches no @case (1, 'b')");
  assert.equal(find('other')[0].controlFlow[0].label, '@switch (mode) @default');
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; @Component({selector:'ctl-view',templateUrl:'./ctl.html'}) export class Ctl { mode=1; }\n",
  'src/ctl.html': "@switch (mode) { @case (1) {<i data-id=one></i>} @case ('b') {<i data-id=two></i>} @default {<i data-id=other></i>} }\n" }));

test('@let is a value definition and does not become a display branch', async () => fixture(({ index, find }) => {
  assert.deepEqual(index.lets.map(item => [item.name, item.value]), [['total', 'a + b']]);
  assert.equal(index.lets[0].owner.id, 'src/ctl.ts#Ctl');
  assert.deepEqual(find('after')[0].controlFlow, [], '@let must not add a display condition');
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; @Component({selector:'ctl-view',templateUrl:'./ctl.html'}) export class Ctl { a=1; b=2; }\n",
  'src/ctl.html': '@let total = a + b;\n<i data-id=after>{{ total }}</i>\n' }));

test('@defer separates its phases and keeps triggers, prefetch and timings apart', async () => fixture(({ find, resolve }) => {
  const main = find('main')[0].controlFlow.at(-1);
  assert.equal(main.phase, 'main');
  // Several execution triggers on one block combine by OR.
  assert(main.condition.includes('on idle OR on hover(box) OR when ready'), main.condition);
  assert(main.notes.some(note => note.includes('does not return it to the unloaded state')));
  assert(main.notes.some(note => note.includes('prefetch on interaction') && note.includes('without rendering')));
  assert(main.notes.some(note => note.includes('hydrate on viewport') && note.includes('SSR hydration')));
  assert(!main.condition.includes('prefetch'), 'prefetch is not a display trigger');
  assert(!main.condition.includes('hydrate'), 'hydration is not a browser interaction path');
  assert.deepEqual(main.defer.triggers.filter(item => item.group === 'trigger').map(item => item.kind).sort(),
    ['hover', 'idle', 'when']);
  assert.deepEqual(main.defer.triggers.filter(item => item.group !== 'trigger')
    .map(item => [item.group, item.kind]), [['prefetch', 'interaction'], ['hydrate', 'viewport']]);
  assert.equal(main.defer.triggers.find(item => item.kind === 'hover').detail, 'box');
  assert.equal(main.defer.triggers.find(item => item.kind === 'when').detail, 'ready');
  const phases = ['placeholder', 'loading', 'error'].map(id => find(id)[0].controlFlow.at(-1));
  assert.deepEqual(phases.map(frame => frame.phase), ['placeholder', 'loading', 'error']);
  assert.equal(phases[0].condition, `@defer ${main.defer.id} has not started`);
  assert(phases[0].notes.some(note => note.includes('at least 1000ms')));
  assert(phases[1].notes.some(note => note.includes('after 100ms')));
  assert(phases[1].notes.some(note => note.includes('at least 2000ms')));
  assert.equal(phases[2].defer.id, main.defer.id, 'all phases belong to the same @defer block');
  // The enclosing @if and the @defer phase combine by AND across steps.
  const nested = find('nested')[0];
  assert.deepEqual(nested.controlFlow.map(frame => frame.kind), ['if', 'defer']);
  const steps = resolve('nested').paths[0].steps.filter(item => item.relation === 'control-flow');
  assert.deepEqual(steps.map(item => item.controlFlow.kind), ['defer', 'if'], 'innermost frame comes first');
  assert(steps[1].displayCondition.startsWith('(ready)'));
  // @defer without triggers falls back to Angular's `on idle`.
  assert(find('bare')[0].controlFlow.at(-1).condition.includes('on idle (Angular default)'));
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; @Component({selector:'ctl-view',templateUrl:'./ctl.html'}) export class Ctl { ready=false; }\n",
  'src/ctl.html': '<b #box></b>\n@defer (on idle; on hover(box); when ready; prefetch on interaction; hydrate on viewport) {<i data-id=main></i>}\n@placeholder (minimum 1s) {<i data-id=placeholder></i>}\n@loading (after 100ms; minimum 2s) {<i data-id=loading></i>}\n@error {<i data-id=error></i>}\n@if (ready) { @defer (on viewport) {<i data-id=nested></i>} }\n@defer {<i data-id=bare></i>}\n' }));

test('template AST that is not understood is reported as unsupported instead of being skipped', async () => fixture(({ index, find }) => {
  assert.equal(find('icu').length, 0, 'markup inside an ICU message is not indexed');
  const icu = index.unsupported.find(item => item.kind === 'Icu');
  assert(icu, JSON.stringify(index.unsupported));
  assert.equal(icu.ownerId, 'src/ctl.ts#Ctl');
  assert.equal(icu.span.line, 1);
  assert(index.diagnostics.some(message =>
    message.startsWith('src/ctl.ts#Ctl: unsupported template node Icu') && message.includes('ctl.html:1')));
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; @Component({selector:'ctl-view',templateUrl:'./ctl.html'}) export class Ctl { count=0; }\n",
  'src/ctl.html': '{count, plural, =0 {none} other {<i data-id=icu></i>}}\n' }));

test('recursion stops at a cycle boundary while other root paths stay enumerated', async () => fixture(({ resolve }) => {
  const resolution = resolve('leaf');
  const cycles = resolution.paths.filter(item => item.end === 'cycle');
  const rooted = resolution.paths.filter(item => item.end !== 'cycle');
  assert(cycles.length >= 1, JSON.stringify(resolution.paths.map(item => [item.end, item.reason])));
  assert(cycles.every(item => item.reason.startsWith('Recursion boundary:')));
  assert(cycles.every(item => /re-entered through (component-use|element)/.test(item.reason)));
  assert(rooted.length >= 1, 'the non-cyclic root path is reported next to the boundary');
  assert(rooted.some(item => item.steps.some(step => step.ownerId === 'src/ctl.ts#Ctl')));
  // Two uses of the same class in one template stay separate candidates, not one cycle.
  const twice = resolve('twice');
  const uses = twice.paths.map(item => item.steps.filter(step => step.relation === 'component-use')
    .map(step => `${step.span.start}`).join(','));
  assert.equal(new Set(uses).size, uses.length, JSON.stringify(uses));
  assert.equal(uses.length, 2);
  assert.equal(twice.paths.filter(item => item.end === 'cycle').length, 0);
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; import {Outer} from './rec'; import {Twice} from './twice'; @Component({selector:'ctl-view',imports:[Outer,Twice],template:'<outer-box></outer-box><twice-box></twice-box><twice-box></twice-box>'}) export class Ctl {}\n",
  'src/rec.ts': "import {Component} from '@angular/core'; @Component({selector:'outer-box',imports:[Inner],template:'<inner-box></inner-box><i data-id=leaf></i>'}) export class Outer {} @Component({selector:'inner-box',imports:[Outer],template:'<outer-box></outer-box>'}) export class Inner {}\n",
  'src/twice.ts': "import {Component} from '@angular/core'; @Component({selector:'twice-box',template:'<i data-id=twice></i>'}) export class Twice {}\n" }));

test('finitization limits stop the expansion and record the range left unenumerated', async () => fixture(({ resolve }) => {
  assert.deepEqual(defaultViewLimits, { depth: 200, paths: 1_000, states: 100_000 });
  const full = resolve('leaf');
  assert.equal(full.limits.depth, 200);
  assert.equal(full.limits.paths, 1_000);
  assert.equal(full.limits.states, 100_000);
  assert.equal(full.limits.depthStops + full.limits.pathStops + full.limits.stateStops, 0);
  const capped = resolve('leaf', { depth: 2 });
  assert(capped.limits.depthStops >= 1);
  assert(capped.paths.some(item => item.end === 'limit' &&
    item.reason.startsWith('Parent path depth limit 2 reached at ')));
  assert(capped.limits.unexplored >= 1);
  const few = resolve('leaf', { paths: 1 });
  assert.equal(few.limits.pathStops, 1);
  assert.equal(few.limits.unexplored, 1, 'the branches left out are counted once');
  assert(few.paths.some(item => item.reason.includes('Candidate limit 1 reached at') &&
    item.reason.includes('branches were not enumerated')));
  const short = resolve('leaf', { states: 1 });
  assert.equal(short.limits.stateStops, 1);
  assert(short.paths.some(item => item.reason.startsWith('View expansion stopped after 1 states at ')));
}, { 'src/main.ts': "import {Ctl} from './ctl'; export const entry=[Ctl];\n",
  'src/ctl.ts': "import {Component} from '@angular/core'; import {Leaf} from './leaf'; @Component({selector:'ctl-view',imports:[Leaf],template:'<leaf-box></leaf-box><leaf-box></leaf-box>'}) export class Ctl {}\n",
  'src/leaf.ts': "import {Component} from '@angular/core'; @Component({selector:'leaf-box',template:'<div><span><i data-id=leaf></i></span></div>'}) export class Leaf {}\n" }));
