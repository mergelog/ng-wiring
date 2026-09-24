import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { buildCatalog } from '../dist/index/catalog.js';
import { componentInjectorLayers, resolveInjection, resolveInjectionAtViewStep, injectionRequestFor } from '../dist/resolve/operation/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(source, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p10-di-'));
  try {
    await mkdir(path.join(root, 'src'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true,
    }, files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), source);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    await check(context, await buildCatalog(context));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('provider hierarchy respects view content, route, root, self and skipSelf', async () => fixture(`
import {Component, Injectable, InjectionToken} from '@angular/core';
export abstract class Service { abstract read():string }
@Injectable() export class RootService extends Service {read(){return 'root'}}
@Injectable() export class RouteService extends Service {read(){return 'route'}}
@Injectable() export class ViewService extends Service {read(){return 'view'}}
export const LOGS = new InjectionToken<string[]>('logs');
@Component({selector:'app-root',template:'<ng-content/>',providers:[{provide:LOGS,useValue:['component'],multi:true}],
 viewProviders:[{provide:Service,useClass:ViewService},{provide:LOGS,useValue:['view'],multi:true}]})
export class Root {}
export const rootProviders=[{provide:Service,useClass:RootService},{provide:LOGS,useValue:['root'],multi:true}];
export const routeProviders=[{provide:Service,useClass:RouteService}];
`, (context,catalog) => {
  const t = context.toolchain.typescript;
  const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
  const variable = name => file.statements.find(s => t.isVariableStatement(s))?.declarationList.declarations.find(d => d.name.getText() === name);
  const variables = file.statements.filter(t.isVariableStatement).flatMap(s => s.declarationList.declarations);
  const expr = name => variables.find(v => v.name.getText() === name)?.initializer;
  const klass = name => file.statements.find(s => t.isClassDeclaration(s) && s.name?.text === name);
  const token = name => klass(name)?.name ?? variables.find(v => v.name.getText() === name)?.name;
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const layers = componentInjectorLayers(owner, [], [expr('rootProviders')], [expr('routeProviders')]);
  const view = resolveInjection(context, {token:token('Service')}, layers);
  assert.equal(view.status, 'resolved');
  assert(view.bindings[0].implementation.endsWith(':ViewService'));
  const content = resolveInjection(context, {token:token('Service'),projected:true}, layers);
  assert(content.bindings[0].implementation.endsWith(':RouteService'));
  assert.equal(resolveInjection(context,{token:token('Service'),self:true},layers).bindings[0].implementation.endsWith(':ViewService'),true);
  assert.equal(resolveInjection(context,{token:token('Service'),skipSelf:true},layers).bindings[0].implementation.endsWith(':RouteService'),true);
  const multi = resolveInjection(context,{token:token('LOGS')},layers);
  assert.equal(multi.bindings.length,3);
  assert.equal(resolveInjection(context,{token:token('LOGS'),projected:true},layers).bindings.length,2);
  assert.equal(resolveInjection(context,{token:token('LOGS'),self:true},layers).bindings.length,2);
  assert.equal(resolveInjection(context,{token:token('LOGS'),skipSelf:true},layers).bindings.length,1);
  assert.equal(resolveInjection(context,{token:token('LOGS'),host:true},layers).bindings.length,2);
  const projectedStep={relation:'projection-slot',diOwnerId:owner.id,diContextOverride:null};
  assert.equal(resolveInjectionAtViewStep(context,{token:token('Service')},layers,projectedStep).bindings[0].implementation,
    view.bindings[0].implementation);
  assert.equal(resolveInjectionAtViewStep(context,{token:token('Service')},layers,
    {...projectedStep,diOwnerId:'other'}).status,'boundary');
}));

test('unknown factory and absent provider stop at the token; optional may be null', async () => fixture(`
import {Component, Injectable, inject} from '@angular/core';
export abstract class Service {}
export class Other {}
@Injectable({providedIn:'root'}) export class Global {}
export function makeService(){return new Service()}
@Component({selector:'app-root',template:'',providers:[{provide:Service,useFactory:makeService}]})
export class Root { optional=inject(Other,{optional:true}); }
`, (context,catalog) => {
  const t = context.toolchain.typescript;
  const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
  const token = name => file.statements.find(s => t.isClassDeclaration(s) && s.name?.text === name).name;
  const owner = [...catalog.declarations.values()].find(d => d.className === 'Root');
  const layers = componentInjectorLayers(owner);
  assert.equal(resolveInjection(context,{token:token('Service')},layers).status,'boundary');
  assert.equal(resolveInjection(context,{token:token('Global')},layers).status,'resolved');
  assert.equal(resolveInjection(context,{token:token('Other'),optional:true},layers).status,'resolved');
  const call = owner.node.members.find(m => t.isPropertyDeclaration(m)).initializer;
  assert.equal(injectionRequestFor(context,call).optional,true);
}));

test('useExisting follows a visible provider, while a template injector has its own context', async () => fixture(`
import {Component,Injectable} from '@angular/core';
export class Service {}
@Injectable({providedIn:'root'})
export class Replacement extends Service {}
@Component({selector:'app-root',template:'',providers:[{provide:Service,useExisting:Replacement}]}) export class Root {}
export const rootProviders=[Replacement];
export const templateProviders=[{provide:Service,useClass:Replacement}];
`, (context,catalog) => {
  const t=context.toolchain.typescript;
  const file=context.program.getSourceFiles().find(f=>f.fileName.endsWith('/src/main.ts'));
  const variable=name=>file.statements.filter(t.isVariableStatement).flatMap(s=>s.declarationList.declarations)
    .find(d=>d.name.getText()===name).initializer;
  const token=file.statements.find(s=>t.isClassDeclaration(s)&&s.name?.text==='Service').name;
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const layers=componentInjectorLayers(owner,[],[variable('rootProviders')]);
  assert(resolveInjection(context,{token},layers).bindings[0].implementation.endsWith(':Replacement'));
  assert.equal(resolveInjection(context,{token},componentInjectorLayers(owner)).status,'resolved');
  const templateInjector={id:'explicit-template',kind:'template',providers:[variable('templateProviders')]};
  assert.equal(resolveInjection(context,{token,templateInjector},layers).searched[0],'explicit-template');
  const insertion={relation:'template-insertion',diOwnerId:owner.id,diContextOverride:'customInjector'};
  assert.equal(resolveInjectionAtViewStep(context,{token},layers,insertion).status,'boundary');
  assert.equal(resolveInjectionAtViewStep(context,{token,templateInjector},layers,insertion).status,'resolved');
}));

test('constructor decorators and inject options retain hierarchy flags; dynamic values remain boundaries', async () => fixture(`
import {Component,Inject,Self,SkipSelf,Host,Optional,InjectionToken,inject} from '@angular/core';
export const TOKEN=new InjectionToken<string>('token');
export function dynamic(){return Math.random().toString();}
@Component({selector:'app-root',template:'',providers:[{provide:TOKEN,useValue:dynamic()}]})
export class Root {
  field=inject(TOKEN,{optional:true,self:true});
  constructor(@Inject(TOKEN) @Optional() @Host() readonly value:string) {}
}
`, (context,catalog) => {
  const t=context.toolchain.typescript;
  const owner=[...catalog.declarations.values()].find(d=>d.className==='Root');
  const field=owner.node.members.find(m=>t.isPropertyDeclaration(m));
  const ctor=owner.node.members.find(t.isConstructorDeclaration);
  const first=injectionRequestFor(context,field.initializer);
  const second=injectionRequestFor(context,ctor.parameters[0]);
  assert.equal(first.self,true);
  assert.equal(first.optional,true);
  assert.equal(second.host,true);
  assert.equal(second.optional,true);
  assert.equal(resolveInjection(context,first,componentInjectorLayers(owner)).status,'boundary');
}));
