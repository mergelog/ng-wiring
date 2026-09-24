import { linkTargetWorkspace, writeTargetManifest } from './fixtures/target.mjs';
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

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(fn, setup) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-index-'));
  try {
    await mkdir(path.join(root, 'src'));
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), "import {HostA,HostB} from './host'; export const entry=[HostA,HostB];\n");
    await writeFile(path.join(root, 'src/child.ts'), "import {Component,Directive,Input} from '@angular/core'; export class Base { @Input('baseAlias') base = ''; } @Directive({selector:'[mark]'}) export class Mark { @Input() value = ''; } @Directive({selector:'a-child'}) export class Tag {} @Component({selector:'a-child',template:'<p></p>',hostDirectives:[{directive:Mark,inputs:['value:publicValue']}]}) export class Child extends Base { @Input('aliased') field = ''; }\n");
    await writeFile(path.join(root, 'src/host.ts'), "import {Component} from '@angular/core'; import {Child,Mark,Tag} from './child'; @Component({selector:'host-a',imports:[Child,Mark,Tag],templateUrl:'./shared.html'}) export class HostA {} @Component({selector:'host-b',imports:[Child],templateUrl:'./shared.html'}) export class HostB {}\n");
    await writeFile(path.join(root, 'src/shared.html'), '<a-child data-id="a&amp;b" mark></a-child><a-child data-id=a></a-child>\n<span [attr.data-id]="value"></span><button data-id="multi"\n title="x"></button>\n');
    if (setup) await setup(root);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    await fn(root, context);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('catalog and selector scope keep shared template owners and all directives', async () => fixture(async (root, context) => {
  const catalog = await buildCatalog(context);
  assert.equal(catalog.declarations.size, 5);
  assert.equal(catalog.declarations.get('src/child.ts#Child').inputs.get('baseAlias'), 'base');
  assert.equal(catalog.declarations.get('src/child.ts#Child').inputs.get('aliased'), 'field');
  assert.equal(catalog.declarations.get('src/child.ts#Child').hostDirectiveExposures.get('src/child.ts#Mark').inputs.get('publicValue'), 'value');
  const index = await indexTemplates(context, catalog);
  assert.equal(matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'a&b' }).length, 2);
  assert.equal(matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'a' }).length, 2);
  assert.equal(matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'b' }).length, 0);
  const first = matchingElements(index, { kind: 'source', file: path.join(root, 'src/shared.html'), line: 1 });
  assert.equal(first.length, 4);
  assert(first.some(item => item.owner.className === 'HostA' && item.directives.some(id => id.endsWith('#Mark'))));
  assert(first.some(item => item.owner.className === 'HostB' && item.directives.some(id => id.endsWith('#Mark'))));
  assert(first.some(item => item.owner.className === 'HostA' && item.directives.some(id => id.endsWith('#Tag'))));
  assert(first.some(item => item.owner.className === 'HostB' && item.appliedInputs.get('publicValue')?.some(value => value.endsWith('#Mark.value'))));
  assert(first.filter(item => item.component?.endsWith('#Child')).length === 4);
  assert.equal(matchingElements(index, { kind: 'source', file: path.join(root, 'src/shared.html'), line: 3 }).length, 2);
  assert.equal(matchingElements(index, { kind: 'source', file: path.join(root, 'src/shared.html'), line: 2 }).length, 4);
}));

test('escaped inline templates map start tags to TypeScript source lines', async () => fixture(async (root, context) => {
  const index = await indexTemplates(context, await buildCatalog(context));
  const match = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'inline' });
  assert.equal(match.length, 1);
  assert.equal(match[0].span.file, path.join(root, 'src/host.ts'));
  assert.equal(match[0].span.line, 2);
  assert.equal(matchingElements(index, { kind: 'source', file: path.join(root, 'src/host.ts'), line: 2 }).length, 1);
}, async root => {
  await writeFile(path.join(root, 'src/host.ts'), "import {Component} from '@angular/core'; import {Child,Mark} from './child'; @Component({selector:'host-a',imports:[Child,Mark],templateUrl:'./shared.html'}) export class HostA {} @Component({selector:'host-b',imports:[Child],templateUrl:'./shared.html'}) export class HostB {}\n@Component({selector:'inline-view',template:'\\n<button data-id=inline></button>'}) export class Inline {}\n");
}));

test('NgModule declarations and imports are resolved within the selected context', async () => fixture(async (_root, context) => {
  const catalog = await buildCatalog(context);
  const index = await indexTemplates(context, catalog);
  const element = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'module' })[0];
  assert(element.component.endsWith('#Child'));
  assert(element.directives.some(id => id.endsWith('#Local')));
  assert.equal(element.gaps.length, 0);
}, async root => {
  await writeFile(path.join(root, 'src/main.ts'), "import {HostA,HostB} from './host'; import {ModuleHost} from './module'; export const entry=[HostA,HostB,ModuleHost];\n");
  await writeFile(path.join(root, 'src/module.ts'), "import {Component,Directive,NgModule} from '@angular/core'; import {Child} from './child'; @Directive({selector:'[local]',standalone:false}) export class Local {} @Component({selector:'module-host',standalone:false,template:'<a-child local data-id=module></a-child>'}) export class ModuleHost {} @NgModule({declarations:[ModuleHost,Local],imports:[Child],exports:[ModuleHost]}) export class FeatureModule {}\n");
}));

test('published d.ts directive metadata contributes to NgModule export scope', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-public-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules/@angular'), { recursive: true });
    await mkdir(path.join(root, 'node_modules/public-lib'));
    for (const name of ['core', 'compiler']) await symlink(path.join(repo, 'node_modules/@angular', name), path.join(root, 'node_modules/@angular', name), 'dir');
    await symlink(path.join(repo, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'), 'dir');
    await writeTargetManifest(root);
    await writeFile(path.join(root, 'node_modules/public-lib/package.json'), JSON.stringify({ name: 'public-lib', version: '1.0.0', types: './index.d.ts' }));
    await writeFile(path.join(root, 'node_modules/public-lib/index.d.ts'), "import * as i0 from '@angular/core'; export declare class PublicDirective { static ɵdir: i0.ɵɵDirectiveDeclaration<PublicDirective, '[public]', never, {field:'alias'}, {}, never, never, true>; } export declare class PublicModule { static ɵmod: i0.ɵɵNgModuleDeclaration<PublicModule, never, never, [typeof PublicDirective]>; }\n");
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '', targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), "import {Component} from '@angular/core'; import {PublicModule} from 'public-lib'; @Component({selector:'app-root',imports:[PublicModule],template:'<div public data-id=external></div>'}) export class Root {}\n");
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const index = await indexTemplates(context, catalog);
    const element = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'external' })[0];
    assert(element.directives.some(id => id.endsWith('#PublicDirective')), JSON.stringify({ external: [...catalog.external.values()].map(x => ({id:x.id,kind:x.kind,selector:x.selector,exports:x.exports})), gaps: catalog.gaps, directives: element.directives, elementGaps: element.gaps }));
    assert.equal(element.gaps.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('@for identifies the source element without inventing row instances', async () => fixture(async (_root, context) => {
  const index = await indexTemplates(context, await buildCatalog(context));
  const matches = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'row' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].repeated, true);
}, async root => {
  await writeFile(path.join(root, 'src/host.ts'), "import {Component} from '@angular/core'; import {Child,Mark} from './child'; @Component({selector:'host-a',imports:[Child,Mark],templateUrl:'./shared.html'}) export class HostA {} @Component({selector:'host-b',imports:[Child],templateUrl:'./shared.html'}) export class HostB {} @Component({selector:'for-view',template:'@for (item of items; track item) { <button data-id=row></button> }'}) export class ForView { items=[1,2]; }\n");
}));

test('ambiguous components and non-start-tag source lines do not create a false target', async () => fixture(async (root, context) => {
  const index = await indexTemplates(context, await buildCatalog(context));
  const elements = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'same' });
  assert.equal(elements.length, 2);
  assert(elements.every(element => element.component === null && element.gaps.some(gap => gap.includes('Ambiguous component'))));
  for (const line of [2, 3, 4]) assert.equal(matchingElements(index,
    { kind: 'source', file: path.join(root, 'src/shared.html'), line }).length, 0);
}, async root => {
  await writeFile(path.join(root, 'src/child.ts'), "import {Component} from '@angular/core'; @Component({selector:'a-child',template:''}) export class Child {} @Component({selector:'a-child',template:''}) export class Other {}\n");
  await writeFile(path.join(root, 'src/host.ts'), "import {Component} from '@angular/core'; import {Child,Other} from './child'; @Component({selector:'host-a',imports:[Child,Other],templateUrl:'./shared.html'}) export class HostA {} @Component({selector:'host-b',imports:[Child,Other],templateUrl:'./shared.html'}) export class HostB {}\n");
  await writeFile(path.join(root, 'src/shared.html'), '<a-child data-id=same>\nbody\n</a-child>\n<!-- only a comment -->\n');
}));
