import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { linkTargetWorkspace } from './fixtures/target.mjs';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { buildCatalog } from '../dist/index/catalog.js';
import { indexTemplates } from '../dist/index/templates.js';
import { buildRouteGraph } from '../dist/resolve/view/routes.js';
import { buildIndexedCandidates } from '../dist/index/candidates.js';
import { assembleReport } from '../dist/assemble/report.js';
import { renderSimple } from '../dist/render/simple.js';

test('dynamic dialog uses only a unique caller route injector and retains both action branches', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-dialog-route-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'src/node_modules/@angular/material'), { recursive: true });
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
      paths: { '@angular/material/dialog': ['./src/node_modules/@angular/material/dialog.d.ts'] },
    }, files: ['src/main.ts'] }));
    const files = {
      'node_modules/@angular/material/dialog.d.ts': `import {Observable} from 'rxjs';
export declare class MatDialogRef<T> { close(result?:T):void; afterClosed():Observable<T|undefined>; }
`,
      'main.ts': `import {bootstrapApplication} from '@angular/platform-browser';
import {provideRouter} from '@angular/router';
import {provideHttpClient} from '@angular/common/http';
import {provideStore} from '@ngrx/store';
import {provideEffects} from '@ngrx/effects';
import {Root} from './root'; import {ShellA,HostB,HostC} from './hosts'; import {QueueEffects} from './effects';
const shared=[provideEffects(QueueEffects)];
bootstrapApplication(Root,{providers:[provideRouter([
  {path:'a',component:ShellA,providers:[...shared]},
  {path:'b',component:HostB},
  {path:'c',component:HostC,providers:[...shared]}
]),provideStore(),provideHttpClient()]});`,
      'root.ts': `import {Component} from '@angular/core'; import {RouterOutlet} from '@angular/router';
@Component({selector:'app-root',imports:[RouterOutlet],template:'<router-outlet />'}) export class Root {}`,
      'actions.ts': `import {createAction} from '@ngrx/store';
export const updated=createAction('[Queue] Updated'); export const created=createAction('[Queue] Created');`,
      'dialog.ts': `import {Component,inject} from '@angular/core'; import {Store} from '@ngrx/store';
import {MatDialogRef} from '@angular/material/dialog';
import {updated,created} from './actions';
@Component({selector:'queue-dialog',template:'<button data-id="queue" (click)="save()">Save</button><button data-id="confirm" (click)="closeDialog(true)">OK</button><button data-id="cancel" (click)="closeDialog(false)">Cancel</button>@if (mode === "move") {<button data-id="move-only" (click)="save()">Move</button>}'})
export class QueueDialog { store=inject(Store); ref!:MatDialogRef<{confirmed:boolean}>; id?: string; mode='move';
 save(){ if(this.id) this.store.dispatch(updated()); else this.store.dispatch(created()); }
 closeDialog(confirmed:boolean){this.ref.close({confirmed});} }`,
      'hosts.ts': `import {Component,inject,Injectable,Injector} from '@angular/core'; import {QueueDialog} from './dialog';
import {Store} from '@ngrx/store'; import {updated} from './actions'; import {MatDialogRef} from '@angular/material/dialog';
@Injectable({providedIn:'root'}) export class DialogOpener { open(component:unknown, config?:unknown):MatDialogRef<{confirmed:boolean}>{return {} as MatDialogRef<{confirmed:boolean}>;} }
@Component({selector:'host-a',template:'<button (click)="show()">A</button>'}) export class HostA {
  dialog=inject(DialogOpener); injector=inject(Injector); store=inject(Store);
  show(){ const ref=this.dialog.open(QueueDialog,{}); ref.afterClosed().subscribe(res=>{if(res?.confirmed)this.store.dispatch(updated());}); }
  showOverride(){ this.dialog.open(QueueDialog,{injector:this.injector}); }
}
@Component({selector:'shell-a',imports:[HostA],template:'<host-a></host-a>'}) export class ShellA {}
@Component({selector:'host-b',template:'<button (click)="show()">B</button>'}) export class HostB {
  dialog=inject(DialogOpener); show(){ this.dialog.open(QueueDialog,{data:{mode:'create'}}); }
}
@Component({selector:'host-c',template:'<button (click)="show()">C</button>'}) export class HostC {
  dialog=inject(DialogOpener); show(){ this.dialog.open(QueueDialog,{}); }
}`,
      'api.ts': `import {Injectable,inject} from '@angular/core'; import {HttpClient} from '@angular/common/http';
@Injectable({providedIn:'root'}) export class QueueApi { http=inject(HttpClient);
  queuesUpdate(){ return this.http.post('/queues.update',{}); }
  queuesCreate(){ return this.http.post('/queues.create',{}); }
}`,
      'effects.ts': `import {Injectable,inject} from '@angular/core'; import {QueueApi} from './api';
import {Actions,createEffect,ofType} from '@ngrx/effects'; import {mergeMap} from 'rxjs';
import {updated,created} from './actions';
@Injectable() export class QueueEffects { actions=inject(Actions); api=inject(QueueApi);
  updateQueue=createEffect(()=>this.actions.pipe(ofType(updated),mergeMap(()=>this.api.queuesUpdate())),{dispatch:false});
  createQueue=createEffect(()=>this.actions.pipe(ofType(created),mergeMap(()=>this.api.queuesCreate())),{dispatch:false});
}`,
    };
    await Promise.all(Object.entries(files).map(([file, source]) => writeFile(path.join(root, 'src', file), source)));
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const routes = buildRouteGraph(context, catalog);
    const location = (file, text) => {
      const source = files[file];
      const offset = source.indexOf(text);
      assert(offset >= 0);
      const before = source.slice(0, offset).split('\n');
      return { file: `src/${file}`, line: before.length, column: before.at(-1).length + 1, precision: 'exact' };
    };
    const edges = [
      { from: 'src/hosts.ts#HostA', to: 'src/dialog.ts#QueueDialog', kind: 'dialog',
        location: location('hosts.ts', 'this.dialog.open(QueueDialog,{});'), order: 0, origin: 'ngmaze' },
      { from: 'src/hosts.ts#HostB', to: 'src/dialog.ts#QueueDialog', kind: 'dialog',
        location: location('hosts.ts', "this.dialog.open(QueueDialog,{data:{mode:'create'}});"), order: 1, origin: 'ngmaze' },
      { from: 'src/hosts.ts#HostA', to: 'src/dialog.ts#QueueDialog', kind: 'dialog',
        location: location('hosts.ts', 'this.dialog.open(QueueDialog,{injector:this.injector});'),
        order: 2, origin: 'ngmaze' },
      { from: 'src/hosts.ts#HostC', to: 'src/dialog.ts#QueueDialog', kind: 'dialog',
        location: location('hosts.ts', 'export class HostC {\n  dialog=inject(DialogOpener); show(){ this.dialog.open(QueueDialog,{}); }'),
        order: 3, origin: 'ngmaze' },
    ];
    // Both source snippets are identical apart from their position; find the second call explicitly.
    const second = files['hosts.ts'].indexOf("this.dialog.open(QueueDialog,{data:{mode:'create'}});");
    const prefix = files['hosts.ts'].slice(0, second).split('\n');
    edges[1].location = { file: 'src/hosts.ts', line: prefix.length, column: prefix.at(-1).length + 1,
      precision: 'exact' };
    const third = files['hosts.ts'].indexOf('this.dialog.open(QueueDialog,{});', second + 1);
    const thirdPrefix = files['hosts.ts'].slice(0, third).split('\n');
    edges[3].location = { file: 'src/hosts.ts', line: thirdPrefix.length, column: thirdPrefix.at(-1).length + 1,
      precision: 'exact' };
    const target = { kind: 'attribute', raw: 'data-id=queue', name: 'data-id', value: 'queue' };
    const analyze = async (chosen, value = 'queue') => {
      const maze = { components: [], edges: chosen, routeEdges: [], routes: [], externalUsages: [],
        ambiguousUsages: [], diagnostics: [], detectionGaps: [], omissions: [] };
      const index = await indexTemplates(context, catalog, maze);
      const requested = { ...target, raw: `data-id=${value}`, value };
      const candidates = buildIndexedCandidates(context, catalog, index, requested, maze, routes);
      const selected = candidates.find(item => item.path.end === 'dynamic-boundary');
      assert(selected);
      const analysis = { context, catalog, index, routes, maze, mazeProblems: [], candidates };
      const report = assembleReport({ analysis, selected, candidates, options: {
        target: requested, outDir: root, json: true,
      }, toolVersion: 'test', startedAt: new Date(), enumerationComplete: true });
      return { report, selected };
    };
    const onlyA = await analyze(edges.slice(0, 1));
    const requests = onlyA.report.edges.filter(edge => edge.kind === 'http-create');
    assert.deepEqual(requests.map(edge => edge.details.urlExpression?.value).sort(),
      ['/queues.create', '/queues.update']);
    const simple = renderSimple({ report: onlyA.report, outputDir: root, fileNameSource: '', heading: '' }).text;
    assert.match(simple, /POST \/queues\.create/);
    assert.match(simple, /POST \/queues\.update/);
    assert.match(simple, /else of this\.id/);
    const onlyB = await analyze(edges.slice(1, 2));
    assert.equal(onlyB.report.edges.filter(edge => edge.kind === 'http-create').length, 0);
    const stopped = renderSimple({ report: onlyB.report, outputDir: root, fileNameSource: '', heading: '' }).text;
    assert.match(stopped, /停止: .*provideEffects/);
    const both = await analyze(edges.slice(0, 2));
    assert.equal(both.selected.dynamicCallers.length, 2);
    assert.equal(both.report.edges.filter(edge => edge.kind === 'http-create').length, 0);
    assert(both.report.diagnostics.some(item => item.code === 'dynamic-route-context'));
    const shared = await analyze([edges[0], edges[3]]);
    assert.deepEqual(shared.report.edges.filter(edge => edge.kind === 'http-create')
      .map(edge => edge.details.urlExpression?.value).sort(), ['/queues.create', '/queues.update']);
    const overridden = await analyze(edges.slice(2));
    assert.equal(overridden.report.edges.filter(edge => edge.kind === 'http-create').length, 0);
    const confirmed = await analyze(edges.slice(0, 1), 'confirm');
    assert(confirmed.report.diagnostics.some(item => item.code === 'dialog-result-delivery'));
    assert(confirmed.report.edges.some(edge => edge.kind === 'http-create' &&
      edge.details.urlExpression?.value === '/queues.update'));
    const cancelled = await analyze(edges.slice(0, 1), 'cancel');
    assert(!cancelled.report.diagnostics.some(item => item.code === 'dialog-result-delivery'));
    const moveOnly = await analyze(edges.slice(0, 2), 'move-only');
    assert(moveOnly.report.diagnostics.some(item => item.code === 'dynamic-call-site-excluded'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
