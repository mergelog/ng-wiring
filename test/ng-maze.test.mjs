import { linkTargetWorkspace } from './fixtures/target.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { locateNgmaze, mazeArguments, readNgmaze } from '../dist/adapters/ng-maze/index.js';
import { buildCatalog } from '../dist/index/catalog.js';
import { indexTemplates } from '../dist/index/templates.js';
import { verifyCodeEdge } from '../dist/adapters/ng-maze/verify.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('pinned ngmaze JSON is checked and scoped to the selected Program', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-maze-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: {
      app: { projectType: 'application', root: '', targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } },
    } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), "import { Root } from './root'; export const entry = Root;\n");
    await writeFile(path.join(root, 'src/root.ts'), "import {Component} from '@angular/core'; import {Child} from './child'; @Component({selector:'app-root', template:'<app-child></app-child><ng-container [ngComponentOutlet]=\"dynamic\"></ng-container>', imports:[Child]}) export class Root { dynamic=Child; create(){ this.createComponent(Child); } createComponent(_:unknown){} }\n");
    await writeFile(path.join(root, 'src/child.ts'), "import {Component} from '@angular/core'; @Component({selector:'app-child', template:'<button data-id=go></button>'}) export class Child {}\n");
    await writeFile(path.join(root, 'src/orphan.ts'), "import {Component} from '@angular/core'; @Component({selector:'orphan', template:''}) export class Orphan {}\n");
    await linkTargetWorkspace(root);
    const toolchain = await resolveToolchain(root);
    const project = (await selectProjects(root, toolchain))[0];
    const context = await createContext({ workspaceRoot: root, project, toolchain });
    const codeEdge = { from: 'src/root.ts#Root', to: 'src/child.ts#Child', kind: 'create-component',
      location: { file: 'src/root.ts', line: 1,
        column: context.program.getSourceFile(path.join(root, 'src/root.ts')).text.indexOf('this.createComponent') + 1,
        precision: 'exact' }, order: 0 };
    assert.equal(verifyCodeEdge(context, codeEdge), true);
    assert.equal(verifyCodeEdge(context, { ...codeEdge, to: 'src/orphan.ts#Orphan' }), false);
    const located = await locateNgmaze();
    assert.equal(JSON.stringify(JSON.parse(await readFile(located.schemaPath, 'utf8'))),
      JSON.stringify(JSON.parse(await readFile(path.join(repo, 'docs/ngmaze.schema.json'), 'utf8'))));
    assert.deepEqual(mazeArguments(context), ['--project', root, '--angular-project', 'app', '--json']);
    const graph = await readNgmaze(context);
    assert(graph.components.length > 0);
    assert(graph.omissions.length > 0, 'ngmaze finds more than this Program import closure');
    assert(graph.components.every(component => context.sourceFiles.includes(component.file)));
    assert(graph.edges.every(edge => edge.origin === 'ngmaze'));
    assert(graph.components.some(component => component.className === 'Child'));
    const catalog = await buildCatalog(context);
    const verified = await indexTemplates(context, catalog, graph);
    assert(verified.elements.some(element => element.component?.endsWith('#Child') && element.origin === 'ngmaze'));
    assert(verified.verifiedMazeEdges.some(edge => edge.kind === 'ng-component-outlet'), JSON.stringify({
      graph: graph.edges.filter(edge => edge.kind === 'ng-component-outlet'),
      hosts: verified.elements.filter(element => element.boundExpressions.has('ngComponentOutlet')).map(element => ({ span: element.span, expression: element.boundExpressions.get('ngComponentOutlet') })),
    }));
    const index = await indexTemplates(context, catalog, { ...graph, components: [], edges: [] });
    assert(index.elements.some(element => element.component?.endsWith('#Child') && element.origin === 'ng-wiring'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
