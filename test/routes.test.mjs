import { writeTargetManifest } from './fixtures/target.mjs';
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
import { buildRouteGraph } from '../dist/resolve/view/routes.js';
import { resolveViewPaths } from '../dist/resolve/view/index.js';
import { buildIndexedCandidates } from '../dist/index/candidates.js';
import { filterCandidates } from '../dist/cli/candidates.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROUTER_TYPES = "import * as i0 from '@angular/core';\n" +
  'export declare interface Route { [key: string]: any }\n' +
  'export declare type Routes = Route[];\n' +
  "export declare class RouterOutlet { static ɵdir: i0.ɵɵDirectiveDeclaration<RouterOutlet, 'router-outlet', ['outlet'], {'name':'name'}, {}, never, never, true>; }\n" +
  'export declare class RouterModule { static forRoot(routes: Routes, config?: any): any; static forChild(routes: Routes): any;' +
  ' static ɵmod: i0.ɵɵNgModuleDeclaration<RouterModule, never, never, [typeof RouterOutlet]>; }\n' +
  'export declare function provideRouter(routes: Routes, ...features: any[]): any;\n' +
  'export declare class Router { resetConfig(routes: Routes): void; }\n';
const PLATFORM_TYPES = "import * as i0 from '@angular/core';\n" +
  'export declare function bootstrapApplication(component: any, options?: any): Promise<any>;\n' +
  'export declare function platformBrowser(): i0.PlatformRef;\n';

async function workspace(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-route-'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules/@angular'), { recursive: true });
  for (const name of ['core', 'compiler']) {
    await symlink(path.join(repo, 'node_modules/@angular', name), path.join(root, 'node_modules/@angular', name), 'dir');
  }
  await symlink(path.join(repo, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'), 'dir');
  await writeTargetManifest(root);
  for (const [name, types] of [['router', ROUTER_TYPES], ['platform-browser', PLATFORM_TYPES]]) {
    await mkdir(path.join(root, 'node_modules/@angular', name));
    await writeFile(path.join(root, 'node_modules/@angular', name, 'package.json'),
      JSON.stringify({ name: `@angular/${name}`, version: '22.1.5', types: './index.d.ts' }));
    await writeFile(path.join(root, 'node_modules/@angular', name, 'index.d.ts'), types);
  }
  await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
    targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
  await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
    target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
  }, include: ['src/**/*.ts'] }));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  const toolchain = await resolveToolchain(root);
  const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
  const catalog = await buildCatalog(context);
  const index = await indexTemplates(context, catalog);
  return { root, context, catalog, index };
}

const component = (selector, className, template, imports = '') =>
  `import {Component} from '@angular/core';${imports ? imports : ''} @Component({selector:'${selector}',` +
  `${imports ? `imports:[${imports.match(/\{([^}]*)\}/)[1]}],` : ''}template:'${template}'}) export class ${className} {}\n`;

const APP_FILES = {
  'src/main.ts': "import {bootstrapApplication} from '@angular/platform-browser'; import {provideRouter} from '@angular/router';\n" +
    "import {AppRoot} from './app-root'; import {routes} from './app.routes';\n" +
    'bootstrapApplication(AppRoot, {providers: [provideRouter(routes)]});\n',
  'src/app-root.ts': component('app-root', 'AppRoot',
    '<div><button data-id=root></button><router-outlet></router-outlet><router-outlet name=aside></router-outlet></div>',
    " import {RouterOutlet} from '@angular/router';"),
  'src/shell.ts': component('app-shell', 'Shell',
    '<section><button data-id=shell></button><router-outlet></router-outlet></section>',
    " import {RouterOutlet} from '@angular/router';"),
  'src/detail.ts': component('app-detail', 'Detail', '<button data-id=detail></button>'),
  'src/inner.ts': component('app-inner', 'Inner', '<button data-id=inner></button>'),
  'src/aside.ts': component('app-aside', 'Aside', '<button data-id=aside></button>'),
  'src/users.ts': component('app-users', 'Users', '<button data-id=users></button>'),
  'src/legacy.ts': component('app-legacy', 'Legacy', '<button data-id=legacy></button>'),
  'src/form.ts': component('app-form', 'Form', '<button data-id=form></button>'),
  'src/no-outlet.ts': component('app-no-outlet', 'NoOutlet', '<p>no outlet here</p>'),
  'src/child2.ts': component('app-child2', 'Child2', '<button data-id=noout-child></button>'),
  'src/dual.ts': component('app-dual', 'Dual', '<router-outlet></router-outlet><router-outlet></router-outlet>',
    " import {RouterOutlet} from '@angular/router';"),
  'src/dual-child.ts': component('app-dual-child', 'DualChild', '<button data-id=dual-child></button>'),
  'src/wrap.ts': component('wrap-box', 'Wrap', '<ng-content></ng-content>'),
  'src/proj.ts': "import {Component} from '@angular/core'; import {RouterOutlet} from '@angular/router'; import {Wrap} from './wrap';\n" +
    "@Component({selector:'app-proj',imports:[RouterOutlet,Wrap],template:'<wrap-box><router-outlet></router-outlet></wrap-box>'}) export class Proj {}\n",
  'src/proj-child.ts': component('app-proj-child', 'ProjChild', '<button data-id=proj-child></button>'),
  'src/orphan.ts': component('app-orphan', 'Orphan', '<button data-id=orphan></button>'),
  'src/guards.ts': 'export const authGuard = () => true;\n',
  'src/shared.routes.ts': "import {Routes} from '@angular/router'; import {Form} from './form';\n" +
    "export const sharedRoutes: Routes = [{path:'form', component:Form}];\n",
  'src/admin.routes.ts': "import {Routes} from '@angular/router'; import {Users} from './users';\n" +
    "export const adminRoutes: Routes = [{path:'users', component:Users}];\n",
  'src/legacy.module.ts': "import {NgModule} from '@angular/core'; import {RouterModule, Routes} from '@angular/router'; import {Legacy} from './legacy';\n" +
    "const legacyRoutes: Routes = [{path:'old', component:Legacy}];\n" +
    '@NgModule({imports:[RouterModule.forChild(legacyRoutes)]}) export class LegacyModule {}\n',
  'src/orphan.routes.ts': "import {Routes} from '@angular/router'; import {Orphan} from './orphan';\n" +
    "export const orphanRoutes: Routes = [{path:'orphan', component:Orphan}];\n",
  'src/dynamic-routes.ts': "import {Router} from '@angular/router';\n" +
    'export class DynamicRoutes { constructor(private router: Router) {} reload() { this.router.resetConfig([]); } }\n',
  'src/not-router.ts': 'export class FakeRouter { resetConfig(_routes: unknown) {} }\n' +
    'export function reset(fake: FakeRouter) { fake.resetConfig([]); }\n',
  'src/app.routes.ts': "import {Routes} from '@angular/router';\n" +
    "import {Shell} from './shell'; import {Inner} from './inner'; import {Aside} from './aside';\n" +
    "import {NoOutlet} from './no-outlet'; import {Child2} from './child2'; import {Dual} from './dual';\n" +
    "import {DualChild} from './dual-child'; import {Proj} from './proj'; import {ProjChild} from './proj-child';\n" +
    "import {sharedRoutes} from './shared.routes'; import {authGuard} from './guards';\n" +
    'export const routes: Routes = [\n' +
    "  {path:'', pathMatch:'full', redirectTo:'home'},\n" +
    "  {path:'home', component:Shell, canActivate:[authGuard], children:[\n" +
    "    {path:'detail', loadComponent:() => import('./detail').then(m => m.Detail)},\n" +
    "    {path:'group', children:[{path:'inner', component:Inner}]},\n" +
    '  ]},\n' +
    "  {path:'admin', loadChildren:() => import('./admin.routes').then(m => m.adminRoutes)},\n" +
    "  {path:'legacy', loadChildren:() => import('./legacy.module').then(m => m.LegacyModule)},\n" +
    "  {path:'side', component:Aside},\n" +
    "  {path:'side', component:Aside, outlet:'aside'},\n" +
    "  {path:'noout', component:NoOutlet, children:[{path:'child', component:Child2}]},\n" +
    "  {path:'dual', component:Dual, children:[{path:'x', component:DualChild}]},\n" +
    "  {path:'proj', component:Proj, children:[{path:'y', component:ProjChild}]},\n" +
    "  {path:'a', children:sharedRoutes},\n" +
    "  {path:'b', children:sharedRoutes},\n" +
    '];\n',
};

test('routes and bootstrap are reconstructed from source and placed in the nearest outlet', async () => {
  const { root, context, catalog, index } = await workspace(APP_FILES);
  try {
    const graph = buildRouteGraph(context, catalog);
    const pattern = id => graph.byComponent.get(id) ?? [];

    // P6-08: the bootstrap reachable from the selected entry, and only that one.
    assert.equal(graph.bootstraps.length, 1);
    assert.equal(graph.bootstraps[0].kind, 'application');
    assert.deepEqual(graph.bootstraps[0].componentIds, ['src/app-root.ts#AppRoot']);
    assert.equal(graph.bootstraps[0].entry, 'src/main.ts');

    // P6-01: provideRouter, children, loadComponent, loadChildren array and loadChildren + forChild.
    assert.equal(pattern('src/shell.ts#Shell')[0].pattern, '/home');
    assert.equal(pattern('src/detail.ts#Detail')[0].pattern, '/home/detail');
    assert.equal(pattern('src/inner.ts#Inner')[0].pattern, '/home/group/inner');
    assert.equal(pattern('src/users.ts#Users')[0].pattern, '/admin/users');
    assert.equal(pattern('src/legacy.ts#Legacy')[0].pattern, '/legacy/old');
    assert.deepEqual(catalog.declarations.get('src/legacy.module.ts#LegacyModule').gaps, []);

    // P6-02: the same routes array taken in from two paths stays two occurrences.
    const forms = pattern('src/form.ts#Form');
    assert.equal(forms.length, 2);
    assert.deepEqual(forms.map(item => item.pattern).sort(), ['/a/form', '/b/form']);
    assert.equal(forms[0].definition.start, forms[1].definition.start);
    assert.notEqual(forms[0].id, forms[1].id);
    assert.notEqual(forms[0].loaders.at(-1).start, forms[1].loaders.at(-1).start);
    assert(forms.every(item => item.loaders[0].file.endsWith('main.ts')));

    // P6-03: componentless routes and static redirects stay conditions, not component sections.
    const redirect = graph.occurrences.find(item => item.redirectTo === 'home');
    assert.equal(redirect.componentId, null);
    assert.equal(redirect.componentless, true);
    assert(graph.redirects.includes(redirect));
    const group = graph.occurrences.find(item => item.pattern === '/home/group');
    assert.equal(group.componentless, true);
    assert(!graph.byComponent.has('src/app.routes.ts#none'));

    // P6-04: guards, pathMatch, matcher and declaration order are conditions, not activation proof.
    const detailConditions = pattern('src/detail.ts#Detail')[0].conditions;
    const detailText = detailConditions.map(item => item.text).join(' | ');
    assert(detailConditions.some(item => item.kind === 'guard' && item.text.includes('canActivate')));
    assert(detailText.includes('preceded by'));
    assert(detailConditions.some(item => item.kind === 'order' && item.text.includes('first candidate in its array')));
    assert(redirect.conditions.some(item => item.kind === 'path-match' && item.text === 'pathMatch=full'));

    // P6-05: a routes array with no resolved load origin is not attached to the bootstrap.
    const orphan = pattern('src/orphan.ts#Orphan')[0];
    assert.equal(orphan.rooted, false);
    assert(graph.gaps.some(gap => gap.includes('orphan.routes.ts') &&
      gap.includes('not reachable from a resolved root router configuration')));

    // P6-10: runtime reconfiguration is a reachability gap.
    const resetGaps = graph.gaps.filter(gap => gap.includes('resetConfig'));
    assert.equal(resetGaps.length, 1);
    assert(resetGaps[0].includes('dynamic-routes.ts'));

    const resolve = value => resolveViewPaths(matchingElements(index,
      { kind: 'attribute', name: 'data-id', value })[0], context, catalog, index, 1_000, undefined, graph);

    // P6-09: application -> bootstrap component and bootstrap component -> first route component are separate edges.
    const rootView = resolve('root').paths;
    assert.equal(rootView.length, 1);
    assert.equal(rootView[0].end, 'bootstrap');
    assert.equal(rootView[0].steps.filter(item => item.relation === 'route-outlet').length, 0);
    assert.equal(rootView[0].steps.filter(item => item.relation === 'bootstrap').length, 1);
    const shellView = resolve('shell').paths[0];
    assert.equal(shellView.end, 'bootstrap');
    assert.equal(shellView.steps.filter(item => item.relation === 'route-outlet').length, 1);
    assert.equal(shellView.steps.filter(item => item.relation === 'bootstrap').length, 1);
    assert.equal(shellView.steps.find(item => item.relation === 'route-outlet').ownerId, 'src/app-root.ts#AppRoot');
    // the outlet anchor is a sibling of the routed component, so it is not a display ancestor
    assert(!shellView.steps.some(item => item.label === '<router-outlet>'));
    assert(shellView.steps.some(item => item.label === '<div>'));
    assert.equal(shellView.steps.map(item => item.number).join(','), '01,02,03,04,05');

    // P6-06: the outlet is searched in the nearest display host, not from the root.
    const detailView = resolve('detail').paths[0];
    assert.equal(detailView.end, 'bootstrap');
    const detailRoute = detailView.steps.find(item => item.relation === 'route-outlet');
    assert.equal(detailRoute.ownerId, 'src/shell.ts#Shell');
    assert.equal(detailRoute.routeRef.pattern, '/home/detail');
    assert.equal(detailRoute.expressionOwnerId, 'src/detail.ts#Detail');
    assert.equal(detailView.steps.filter(item => item.relation === 'route-outlet').length, 2);
    assert.equal(resolve('inner').paths[0].steps.find(item => item.relation === 'route-outlet').ownerId, 'src/shell.ts#Shell');
    assert.equal(resolve('users').paths[0].steps.find(item => item.relation === 'route-outlet').ownerId, 'src/app-root.ts#AppRoot');
    assert.equal(resolve('legacy').paths[0].end, 'bootstrap');
    const asidePaths = resolve('aside').paths;
    assert.equal(asidePaths.length, 2);
    assert(asidePaths.every(item => item.end === 'bootstrap'));
    const asideOutlets = asidePaths.map(item => item.steps.find(part => part.relation === 'route-outlet'));
    assert.deepEqual(asideOutlets.map(item => item.routeRef.outlet).sort(), [null, 'aside'].sort());
    assert.deepEqual(asideOutlets.map(item => item.routeRef.pattern), ['/side', '/side']);
    assert(asideOutlets.some(item => item.label.includes('name="aside"')));

    // P6-07: missing, ambiguous, projected and unrooted placements stay unresolved.
    assert.equal(resolve('noout-child').paths[0].end, 'route-unresolved');
    assert(resolve('noout-child').paths[0].reason.includes('declares no <router-outlet>'));
    assert(resolve('dual-child').paths[0].reason.includes('cannot be narrowed'));
    assert(resolve('proj-child').paths[0].reason.includes('projected into'));
    assert.equal(resolve('orphan').paths[0].end, 'route-unresolved');
    assert(resolve('orphan').paths[0].reason.includes('not reachable from a resolved root router configuration'));

    // candidate identity carries the route definition/loader columns and the bootstrap.
    const candidates = buildIndexedCandidates(context, catalog, index,
      { kind: 'attribute', raw: 'data-id=form', name: 'data-id', value: 'form' }, undefined, graph);
    assert.equal(candidates.length, 2);
    assert.notEqual(candidates[0].candidate.id, candidates[1].candidate.id);
    assert.deepEqual(candidates.map(item => item.candidate.routePattern).sort(), ['/a/form', '/b/form']);
    assert(candidates.every(item => item.candidate.class === 'bootstrap'));
    assert(candidates.every(item => item.candidate.tuple.bootstrapId === graph.bootstraps[0].id));
    assert(candidates.every(item => item.candidate.tuple.routes.length === 1 &&
      item.candidate.tuple.routes[0].loaders.length === 2));
    // P6-07: named outlets that share a path stay separate candidates, because --route cannot tell them apart.
    const asideCandidates = buildIndexedCandidates(context, catalog, index,
      { kind: 'attribute', raw: 'data-id=aside', name: 'data-id', value: 'aside' }, undefined, graph);
    assert.equal(asideCandidates.length, 2);
    assert(asideCandidates.every(item => item.candidate.routePattern === '/side'));
    assert.equal(new Set(asideCandidates.map(item => item.candidate.id)).size, 2);
    assert.equal(filterCandidates(asideCandidates.map(item => item.candidate), { route: '/side' }).length, 2);

    const orphanCandidate = buildIndexedCandidates(context, catalog, index,
      { kind: 'attribute', raw: 'data-id=orphan', name: 'data-id', value: 'orphan' }, undefined, graph)[0];
    assert.equal(orphanCandidate.candidate.class, 'declaration');
    assert(orphanCandidate.candidate.partialReasons.some(reason => reason.includes('not reachable from a resolved root router configuration')));

    // P6-05: ngmaze route rows are cross-checked only; host === null never attaches a route to the bootstrap.
    const maze = { components: [], edges: [], routeEdges: [], externalUsages: [], ambiguousUsages: [],
      diagnostics: [], detectionGaps: [], omissions: [],
      routes: [{ path: 'ghost', target: 'src/orphan.ts#Orphan', targetKind: 'component', host: null, outlet: null,
        location: { file: 'src/ghost.ts', line: 1, column: 1, precision: 'exact' }, angularProject: null }] };
    const crossChecked = buildRouteGraph(context, catalog, maze);
    assert.equal(crossChecked.occurrences.length, graph.occurrences.length);
    assert.equal(crossChecked.byComponent.get('src/orphan.ts#Orphan')[0].rooted, false);
    assert(crossChecked.diagnostics.some(item => item.includes('was not reconstructed from source')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('NgModule bootstrap resolves RouterModule.forRoot and the declared bootstrap array', async () => {
  const { root, context, catalog, index } = await workspace({
    'src/main.ts': "import {platformBrowser} from '@angular/platform-browser'; import {AppModule} from './app.module';\n" +
      'platformBrowser().bootstrapModule(AppModule);\n',
    'src/mod-root.ts': "import {Component} from '@angular/core'; @Component({selector:'mod-root',standalone:false," +
      "template:'<main><button data-id=mod-root></button><router-outlet></router-outlet></main>'}) export class ModRoot {}\n",
    'src/mod-page.ts': "import {Component} from '@angular/core'; @Component({selector:'mod-page',standalone:false," +
      "template:'<button data-id=mod-page></button>'}) export class ModPage {}\n",
    'src/app.module.ts': "import {NgModule} from '@angular/core'; import {RouterModule, Routes} from '@angular/router';\n" +
      "import {ModRoot} from './mod-root'; import {ModPage} from './mod-page';\n" +
      "const modRoutes: Routes = [{path:'page', component:ModPage}];\n" +
      '@NgModule({declarations:[ModRoot, ModPage], imports:[RouterModule.forRoot(modRoutes)], bootstrap:[ModRoot]})\n' +
      'export class AppModule {}\n',
  });
  try {
    const graph = buildRouteGraph(context, catalog);
    assert.equal(graph.bootstraps.length, 1);
    assert.equal(graph.bootstraps[0].kind, 'module');
    assert.equal(graph.bootstraps[0].moduleId, 'src/app.module.ts#AppModule');
    assert.deepEqual(graph.bootstraps[0].componentIds, ['src/mod-root.ts#ModRoot']);
    assert.equal(graph.byComponent.get('src/mod-page.ts#ModPage')[0].pattern, '/page');
    const resolve = value => resolveViewPaths(matchingElements(index,
      { kind: 'attribute', name: 'data-id', value })[0], context, catalog, index, 1_000, undefined, graph);
    const page = resolve('mod-page').paths[0];
    assert.equal(page.end, 'bootstrap');
    assert.equal(page.steps.find(item => item.relation === 'route-outlet').ownerId, 'src/mod-root.ts#ModRoot');
    assert(page.steps.some(item => item.label === '<main>'));
    assert.equal(resolve('mod-root').paths[0].end, 'bootstrap');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a local application config factory connects its lazy route to the selected bootstrap', async () => {
  const { root, context, catalog, index } = await workspace({
    'src/main.ts': "import {bootstrapApplication} from '@angular/platform-browser'; import {AppRoot} from './root'; import {getAppConfig} from './config';\n" +
      'bootstrapApplication(AppRoot, getAppConfig({baseHref: "/"}));\n',
    'src/config.ts': "import {provideRouter} from '@angular/router'; import {routes} from './top.routes';\n" +
      'export function getAppConfig(environment: {baseHref: string}) { return {providers: [provideRouter(routes), {provide: "base", useValue: environment.baseHref}]}; }\n',
    'src/root.ts': component('app-root', 'AppRoot', '<router-outlet></router-outlet>',
      " import {RouterOutlet} from '@angular/router';"),
    'src/shell.ts': component('app-shell', 'Shell', '<router-outlet></router-outlet>',
      " import {RouterOutlet} from '@angular/router';"),
    'src/form.ts': component('app-form', 'Form', '<input data-id=searchInputField>'),
    'src/top.routes.ts': "import {Routes} from '@angular/router'; import {Shell} from './shell';\n" +
      "export const routes: Routes = [{path: '', component: Shell, children: [{path: 'tasks', loadChildren: () => import('./task.routes').then(m => m.routes)}]}];\n",
    'src/task.routes.ts': "import {Routes} from '@angular/router'; import {Form} from './form';\n" +
      "export const routes: Routes = [{path: ':id', children: [{path: 'hyper-params', component: Form}]}];\n",
  });
  try {
    const graph = buildRouteGraph(context, catalog);
    const route = graph.byComponent.get('src/form.ts#Form')?.[0];
    assert(route?.rooted);
    assert.equal(route.pattern, '/tasks/:id/hyper-params');
    assert(route.loaders.some(span => span.file.endsWith('/src/top.routes.ts')));
    const target = matchingElements(index,
      { kind: 'attribute', name: 'data-id', value: 'searchInputField' })[0];
    const paths = resolveViewPaths(target, context, catalog, index, 1_000, undefined, graph).paths;
    assert(paths.some(item => item.end === 'bootstrap' &&
      item.steps.some(step => step.ownerId === 'src/shell.ts#Shell') &&
      item.steps.some(step => step.ownerId === 'src/root.ts#AppRoot')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
