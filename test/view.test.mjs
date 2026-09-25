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
import { resolveViewPaths } from '../dist/resolve/view/index.js';
import { buildIndexedCandidates } from '../dist/index/candidates.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('projection slots and TemplateRef insertions give separate display paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-view-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'src/node_modules/primeng'), { recursive: true });
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
      paths: { 'primeng/table': ['./src/node_modules/primeng/table.d.ts'] },
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), "import {Host} from './host'; import {Dynamic} from './dynamic'; import {VcrHost} from './vcr'; import {AssignHost} from './assign'; import {StructuralHost} from './structural'; import {PortalHost} from './portal'; import {PrimeHost} from './prime'; export const entry=[Host,Dynamic,VcrHost,AssignHost,StructuralHost,PortalHost,PrimeHost];\n");
    await writeFile(path.join(root, 'src/node_modules/primeng/table.d.ts'), `import * as i0 from '@angular/core';
export declare class Table {
  headerTemplate: i0.Signal<i0.TemplateRef<any> | undefined>;
  bodyTemplate: i0.Signal<i0.TemplateRef<any> | undefined>;
  static ɵcmp: i0.ɵɵComponentDeclaration<Table, 'p-table', never, {}, {}, ['headerTemplate','bodyTemplate'], never, true, never>;
}
`);
    await writeFile(path.join(root, 'src/prime.ts'), `import {Component} from '@angular/core'; import {Table} from 'primeng/table';
@Component({selector:'prime-host',imports:[Table],template:
  '<p-table><ng-template #header><button data-id=prime-header></button></ng-template><ng-template #body let-row><button data-id=prime-body></button></ng-template></p-table><ng-template #orphan><button data-id=prime-orphan></button></ng-template>'})
export class PrimeHost {}
`);
    await writeFile(path.join(root, 'src/structural.ts'), `import {Component,Directive,Input,TemplateRef,ViewContainerRef} from '@angular/core';
@Directive({selector:'[permit]'}) export class Permit {
  constructor(private template:TemplateRef<unknown>,private view:ViewContainerRef){}
  @Input() set permit(value:boolean){if(value)this.view.createEmbeddedView(this.template);else this.view.clear();}
}
@Directive({selector:'[neverInsert]'}) export class NeverInsert {
  constructor(private template:TemplateRef<unknown>,private view:ViewContainerRef){}
  @Input() set neverInsert(value:boolean){this.view.clear();}
}
@Directive({selector:'[permitWithElse]'}) export class PermitWithElse {
  constructor(private template:TemplateRef<unknown>,private view:ViewContainerRef){}
  elseTemplate?:TemplateRef<unknown>;
  @Input() set permitWithElseElse(tpl:TemplateRef<unknown>){this.elseTemplate=tpl;}
  @Input() set permitWithElse(value:boolean){
    this.view.clear();
    if(value) this.view.createEmbeddedView(this.template);
    else if(this.elseTemplate) this.view.createEmbeddedView(this.elseTemplate);
  }
}
@Directive({selector:'[neverElse]'}) export class NeverElse {
  constructor(private template:TemplateRef<unknown>,private view:ViewContainerRef){}
  elseTemplate?:TemplateRef<unknown>;
  @Input() set neverElseElse(tpl:TemplateRef<unknown>){this.elseTemplate=tpl;}
  @Input() set neverElse(value:boolean){
    this.view.clear();
    if(value) this.view.createEmbeddedView(this.template);
  }
}
@Component({selector:'structural-host',imports:[Permit,NeverInsert,PermitWithElse,NeverElse],template:
  '<div *permit="allowed"><button data-id=permitted></button></div><div *neverInsert="allowed"><button data-id=never></button></div><div *permitWithElse="denied; else elseTpl"><button data-id=else-primary></button></div><ng-template #elseTpl><button data-id=else-branch></button></ng-template><div *neverElse="denied; else neverElseTpl"><button data-id=never-else-primary></button></div><ng-template #neverElseTpl><button data-id=never-else-branch></button></ng-template>'})
export class StructuralHost {allowed=true;denied=false;}
`);
    await writeFile(path.join(root, 'src/portal.ts'), `import {Component} from '@angular/core';
import {DomPortalOutlet} from '@angular/cdk/portal';
@Component({selector:'moving-portal',template:'<ng-content></ng-content>'})
export class MovingPortal { outlet:any; move(target:any){this.outlet=new DomPortalOutlet(target);this.outlet.attach({});} }
@Component({selector:'portal-host',imports:[MovingPortal],template:'<moving-portal outletId="destination"><button data-id=moved></button></moving-portal><div id="destination"></div>'})
export class PortalHost {}
`);
    await writeFile(path.join(root, 'src/dynamic.ts'), "import {Component} from '@angular/core'; @Component({selector:'dynamic-box',template:'<button data-id=dyn></button>'}) export class Dynamic {}\n");
    await writeFile(path.join(root, 'src/child-outlet.ts'), "import {Component,Input,TemplateRef} from '@angular/core'; @Component({selector:'child-outlet',template:'<ng-container [ngTemplateOutlet]=\"template\" [ngTemplateOutletInjector]=\"injector\"></ng-container>'}) export class ChildOutlet { @Input() template!: TemplateRef<unknown>; injector: unknown; }\n");
    await writeFile(path.join(root, 'src/vcr.ts'), "import {Component,ViewChild,TemplateRef,ViewContainerRef} from '@angular/core'; @Component({selector:'vcr-host',template:'<ng-template #frag><button data-id=vcr></button></ng-template><ng-container #anchor></ng-container>'}) export class VcrHost { @ViewChild('frag') tpl!: TemplateRef<unknown>; @ViewChild('anchor',{read:ViewContainerRef}) vcr!: ViewContainerRef; ngAfterViewInit(){this.vcr.createEmbeddedView(this.tpl);} }\n");
    await writeFile(path.join(root, 'src/assign.ts'), "import {Component,ViewChild,TemplateRef} from '@angular/core'; @Component({selector:'assign-host',template:'<ng-template #assigned><button data-id=assigned></button></ng-template><ng-container [ngTemplateOutlet]=\"current\"></ng-container>'}) export class AssignHost { @ViewChild('assigned') source!: TemplateRef<unknown>; current?: TemplateRef<unknown>; ngAfterViewInit(){this.current=this.source;} }\n");
    await writeFile(path.join(root, 'src/card.ts'), "import {Component} from '@angular/core'; @Component({selector:'card-box',template:'<div><ng-content select=\"[action]\"><button data-id=slot-fallback></button></ng-content><ng-content select=\"[action]\"></ng-content><ng-content></ng-content></div>'}) export class Card {} @Component({selector:'only-box',template:'<ng-content select=\"[action]\"></ng-content>'}) export class Only {}\n");
    await writeFile(path.join(root, 'src/wrapper.ts'), "import {Component} from '@angular/core'; import {Card} from './card'; @Component({selector:'wrapper-box',imports:[Card],template:'<card-box><ng-content></ng-content></card-box>'}) export class Wrapper {}\n");
    await writeFile(path.join(root, 'src/host.ts'), "import {Component} from '@angular/core'; import {Card,Only} from './card'; import {Wrapper} from './wrapper'; import {ChildOutlet} from './child-outlet'; @Component({selector:'app-host',imports:[Card,Only,Wrapper,ChildOutlet],templateUrl:'./host.html'}) export class Host {}\n");
    await writeFile(path.join(root, 'src/host.html'), '<card-box><button action data-id=go></button><button ngProjectAs="[action]" data-id=go-as></button><span data-id=default></span></card-box><card-box><span></span></card-box>\n<only-box><span data-id=hidden></span></only-box>\n<wrapper-box><button action data-id=multi></button></wrapper-box>\n<ng-template #fragment let-value><button data-id=frag></button></ng-template>\n<ng-container [ngTemplateOutlet]="fragment"></ng-container><ng-container [ngTemplateOutlet]="fragment"></ng-container>\n<ng-template #unused><button data-id=unused></button></ng-template>\n<ng-template #passed><button data-id=passed></button></ng-template><child-outlet [template]="passed"></child-outlet>\n<div *ngIf="show"><button data-id=star></button></div><div *custom="show"><button data-id=custom></button></div>\n');
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const catalog = await buildCatalog(context);
    const index = await indexTemplates(context, catalog);
    const resolve = value => resolveViewPaths(matchingElements(index, { kind: 'attribute', name: 'data-id', value })[0], context, catalog, index);
    const projected = resolve('go');
    assert(projected.paths[0].steps.some(item => item.relation === 'projection-slot' && item.label.includes('[action]')));
    assert.equal(projected.paths[0].steps.find(item => item.relation === 'projection-slot').span.start,
      index.slots.find(item => item.owner.id.endsWith('#Card') && item.selector === '[action]').span.start);
    assert(resolve('go-as').paths[0].steps.some(item => item.relation === 'projection-slot' && item.label.includes('[action]')));
    assert.equal(projected.paths[0].steps[0].expressionOwnerId, 'src/host.ts#Host');
    assert.equal(resolve('multi').paths[0].steps.filter(item => item.relation === 'projection-slot').length, 2,
      JSON.stringify({ path: resolve('multi').paths[0], slots: index.slots.map(item => ({ owner: item.owner.id, selector: item.selector })) }));
    assert(resolve('multi').paths[0].declarationRefs.some(item => item.ownerId.endsWith('#Wrapper')));
    assert.equal(resolve('slot-fallback').paths.length, 1);
    assert(resolve('slot-fallback').paths[0].steps.some(item => item.displayCondition?.includes('fallback')));
    assert.equal(resolve('hidden').paths[0].end, 'unrendered');
    const fragment = resolve('frag');
    assert.equal(fragment.paths.length, 2);
    assert(fragment.paths.every(item => item.steps.some(part => part.relation === 'template-insertion')));
    assert(fragment.paths.every(item => item.steps.map(part => part.number).join(',').startsWith('01,02')));
    assert(fragment.paths.every(item => item.steps.some(part => part.insertionContext?.includes('value<-$implicit'))));
    assert.equal(resolve('unused').paths[0].end, 'fragment-uninstantiated');
    assert(resolve('prime-header').paths[0].steps.some(item => item.label.includes('PrimeNG Table headerTemplate')),
      JSON.stringify({ external: [...catalog.external.values()].filter(item => item.selector === 'p-table'),
        path: resolve('prime-header').paths[0] }));
    assert(resolve('prime-body').paths[0].steps.some(item => item.insertionContext?.includes('row<-$implicit')));
    assert.equal(resolve('prime-orphan').paths[0].end, 'fragment-uninstantiated');
    assert(resolve('permitted').paths[0].steps.some(item => item.relation === 'structural-view' &&
      item.displayCondition?.includes('value')));
    assert.equal(resolve('never').paths[0].end, 'fragment-uninstantiated');
    assert(resolve('else-branch').paths[0].steps.some(item => item.relation === 'structural-view' &&
      item.label.includes('createEmbeddedView(else)') && item.displayCondition?.includes('permitWithElse')));
    assert.equal(resolve('never-else-branch').paths[0].end, 'fragment-uninstantiated');
    assert.equal(resolve('moved').paths[0].end, 'dynamic-boundary');
    assert(resolve('moved').paths[0].steps.some(item => item.label.includes('DomPortalOutlet.attach')));
    assert(resolve('star').paths[0].steps.some(item => item.relation === 'structural-view'));
    assert.equal(resolve('custom').paths[0].end, 'fragment-uninstantiated');
    assert(resolve('passed').paths[0].steps.some(item => item.relation === 'template-insertion' &&
      item.ownerId.endsWith('#ChildOutlet') && item.expressionOwnerId.endsWith('#Host') &&
      item.diOwnerId.endsWith('#Host') && item.diContextOverride === 'injector'));
    assert(resolve('vcr').paths[0].steps.some(item => item.label.includes('ViewContainerRef.createEmbeddedView') && item.displayParent));
    assert(resolve('assigned').paths[0].steps.some(item => item.relation === 'template-insertion'));
    const dyn = matchingElements(index, { kind: 'attribute', name: 'data-id', value: 'dyn' })[0];
    const dynamicPath = resolveViewPaths(dyn, context, catalog, index, 1000, { edges: [{
      from: 'src/host.ts#Host', to: 'src/dynamic.ts#Dynamic', kind: 'dialog',
      location: { file: 'src/host.ts', line: 1, column: 1, precision: 'exact' }, order: 0, origin: 'ngmaze',
    }], externalUsages: [{ callerKind: 'class', callerName: 'ExternalDialog', target: 'src/dynamic.ts#Dynamic',
      kind: 'dialog', location: { file: 'src/host.ts', line: 1, column: 1, precision: 'approximate' } }] });
    assert.equal(dynamicPath.paths[0].end, 'dynamic-boundary');
    assert.equal(dynamicPath.paths[0].steps.at(-1).displayParent, false);
    assert.equal(dynamicPath.paths.length, 2);
    const candidates = buildIndexedCandidates(context, catalog, index,
      { kind: 'attribute', raw: 'data-id=frag', name: 'data-id', value: 'frag' });
    assert.equal(candidates.length, 2);
    assert.notEqual(candidates[0].candidate.id, candidates[1].candidate.id);
    assert(candidates.every(item => item.candidate.snapshotId === context.snapshot.id));
  } finally { await rm(root, { recursive: true, force: true }); }
});
