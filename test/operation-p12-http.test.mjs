import { linkTargetWorkspace } from './fixtures/target.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { analyzeHttp, analyzeHttpEnvironment, httpBranchEffect } from '../dist/resolve/operation/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(files, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p12-'));
  try {
    await mkdir(path.join(root, 'src'));
    await linkTargetWorkspace(root);
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2022', 'dom'],
      skipLibCheck: true, strict: true, experimentalDecorators: false,
    }, files: ['src/main.ts'] }));
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, 'src', name), text);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    await check({ context, root });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const models = `
export interface LoginRequest { user: string; password: string }
export interface LoginResponse { token: string }
export interface Profile { displayName: string }
export type UserId = string;
export interface NeverUsed { absent: true }
`;
const request = (catalog, member) => catalog.requests.find(item => item.member === member);

// P12-01 / P12-02 / P12-03
test('a staged client call keeps its method, URL, request and response types', async () => fixture({
  'models.ts': models,
  'api-client.ts': `
import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {LoginRequest, LoginResponse, Profile, UserId, NeverUsed} from './models';
@Injectable({providedIn: 'root'})
export class GeneratedClient {
  private readonly http = inject(HttpClient);
  login(body: LoginRequest): Observable<LoginResponse> { return this.http.post<LoginResponse>('/api/login', body); }
  profile(id: UserId): Observable<any> { return this.http.get<Profile>(\`/api/users/\${id}/profile\`); }
  remove(id: string): Observable<void> { return this.http.request<void>('DELETE', \`/api/users/\${id}\`); }
  unusedModel(): NeverUsed | null { return null; }
}`,
  'main.ts': `
import {inject, Injectable} from '@angular/core';
import {GeneratedClient} from './api-client';
import {LoginRequest} from './models';
@Injectable({providedIn: 'root'})
export class AccountService {
  private readonly client = inject(GeneratedClient);
  signIn(body: LoginRequest) { return this.client.login(body); }
}`,
}, ({ context }) => {
  const catalog = analyzeHttp(context);
  assert.equal(catalog.requests.length, 3);
  const login = request(catalog, 'login');
  assert.equal(login.transport, 'http-client');
  assert.equal(login.method, 'POST');
  assert.equal(login.url.status, 'static');
  assert.equal(login.url.text, '/api/login');
  assert.equal(login.owner, 'src/api-client.ts#GeneratedClient');
  // P12-03: only the types that carried the body and the response are listed.
  assert.deepEqual(login.types.map(item => `${item.name}:${item.role}:${item.origin}`).sort(),
    ['LoginRequest:request-body:declared', 'LoginResponse:response:type-argument']);
  // P12-02: the dynamic URL is the only unresolved part of the call.
  const profile = request(catalog, 'profile');
  assert.equal(profile.method, 'GET');
  assert.equal(profile.url.status, 'partial');
  assert.equal(profile.url.text, '/api/users/${id}/profile');
  assert.deepEqual(profile.url.segments,
    [{ kind: 'literal', text: '/api/users/' }, { kind: 'expression', text: 'id' }, { kind: 'literal', text: '/profile' }]);
  assert.match(profile.url.reason, /"id" is not statically known/);
  // The wrapper widens the value to Observable<any>; the response type is the one written at the call.
  assert.deepEqual(profile.types.map(item => item.name), ['Profile']);
  assert.equal(profile.types[0].origin, 'type-argument');
  assert(profile.conditions.some(item => /returns Observable<any>.*get<Profile>/.test(item)),
    profile.conditions.join(' | '));
  // `request('DELETE', url)` keeps its static method name.
  assert.equal(request(catalog, 'remove').method, 'DELETE');
  // An imported but unused model is never listed as a type of a request.
  assert(!catalog.requests.some(item => item.types.some(type => type.name === 'NeverUsed')));
}));

// P12-01 negative: only a declared HttpClient receiver is a request.
test('a same-named member on another receiver is not a request', async () => fixture({
  'main.ts': `
import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
class Cache { get(key: string) { return key; } post<T>(url: string, body: T) { return body; } }
@Injectable({providedIn: 'root'})
export class MixedService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Cache();
  real() { return this.http.get<string>('/api/value'); }
  fake() { return this.cache.get('/api/value'); }
  alsoFake() { return this.cache.post<string>('/api/value', 'x'); }
}`,
}, ({ context }) => {
  const catalog = analyzeHttp(context);
  assert.deepEqual(catalog.requests.map(item => item.member), ['real']);
}));

// P12-06
test('pipeline operators become branches and unknown operators stop the reading', async () => fixture({
  'main.ts': `
import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable, retry, shareReplay, map} from 'rxjs';
function custom<T>() { return (source: Observable<T>) => source; }
@Injectable({providedIn: 'root'})
export class BranchService {
  private readonly http = inject(HttpClient);
  cached() { return this.http.get<string>('/api/cached').pipe(retry(2), shareReplay(1), map(value => value)); }
  opaque() { return this.http.get<string>('/api/opaque').pipe(custom<string>()); }
}`,
}, ({ context }) => {
  const catalog = analyzeHttp(context);
  const cached = request(catalog, 'cached');
  assert.deepEqual(cached.branches.map(item => item.operator), ['retry', 'shareReplay']);
  assert.equal(cached.branches[0].effect, httpBranchEffect('retry'));
  assert(cached.branches[1].effect.includes('without a new network call'));
  // A transparent operator adds no branch and no gap.
  assert.deepEqual(cached.gaps, []);
  // An unknown operator is a boundary, not a transparent step.
  const opaque = request(catalog, 'opaque');
  assert.deepEqual(opaque.branches, []);
  assert.equal(opaque.gaps.length, 1);
  assert.match(opaque.gaps[0], /operator custom at .* is not a resolved rxjs export/);
  // No request claims a fixed number of network calls.
  for (const item of catalog.requests)
    assert(item.conditions.some(condition => condition.includes('number of network calls is not proven')));
}));

// P12-06
test('the interceptor chain and its registration are read from provideHttpClient', async () => fixture({
  'main.ts': `
import {HttpInterceptorFn, provideHttpClient, withInterceptors, withInterceptorsFromDi, withFetch,
  HTTP_INTERCEPTORS} from '@angular/common/http';
import {Injectable} from '@angular/core';
export const authInterceptor: HttpInterceptorFn = (req, next) => next(req);
@Injectable()
export class LegacyInterceptor { intercept(req: any, next: any) { return next.handle(req); } }
export const config = {
  providers: [provideHttpClient(withFetch(), withInterceptors([authInterceptor]), withInterceptorsFromDi()),
    {provide: HTTP_INTERCEPTORS, useClass: LegacyInterceptor, multi: true}],
};`,
}, ({ context }) => {
  const environment = analyzeHttpEnvironment(context);
  assert.equal(environment.registered, true);
  assert.deepEqual(environment.features, ['withFetch', 'withInterceptors', 'withInterceptorsFromDi']);
  assert.deepEqual(environment.interceptors.map(item => `${item.kind}:${item.name}`),
    ['function:authInterceptor', 'class:LegacyInterceptor']);
  assert.deepEqual(environment.gaps, []);
  assert(environment.conditions.some(item => item.includes('2 interceptor(s) run around every request')));
}));

// P12-06: an unregistered client leaves the HTTP boundary unknown instead of assuming a direct call.
test('a missing registration and a non-multi interceptor are reported', async () => fixture({
  'main.ts': `
import {inject, Injectable} from '@angular/core';
import {HttpClient, HTTP_INTERCEPTORS} from '@angular/common/http';
@Injectable()
export class Other { intercept(req: any, next: any) { return next.handle(req); } }
export const providers = [{provide: HTTP_INTERCEPTORS, useClass: Other}];
@Injectable({providedIn: 'root'})
export class PlainService {
  private readonly http = inject(HttpClient);
  load() { return this.http.get<string>('/api/value'); }
}`,
}, ({ context }) => {
  const catalog = analyzeHttp(context);
  assert.equal(catalog.environment.registered, false);
  assert(catalog.diagnostics.some(item => item.includes('no provideHttpClient registration was found')));
  assert(catalog.diagnostics.some(item => item.includes('is not multi; it replaces the chain')));
}));

// P12-02 / P12-05 site reading: a dynamic method is unresolved without losing the call itself.
test('a dynamic request method is unresolved and fetch reads its method option', async () => fixture({
  'main.ts': `
import {inject, Injectable} from '@angular/core';
import {HttpClient, HttpRequest} from '@angular/common/http';
import {LoginRequest} from './models';
@Injectable({providedIn: 'root'})
export class DynamicService {
  private readonly http = inject(HttpClient);
  send(verb: string) { return this.http.request<string>(verb, '/api/value'); }
  carried(id: string) { return this.http.request<string>(new HttpRequest('PUT', \`/api/items/\${id}\`, 'body')); }
  plain() { return fetch('/api/plain'); }
  upload(body: LoginRequest) { return fetch('/api/upload', {method: 'POST', body: JSON.stringify(body)}); }
  weird(verb: string) { return fetch('/api/weird', {method: verb}); }
}`,
  'models.ts': models,
}, ({ context }) => {
  const catalog = analyzeHttp(context);
  const send = request(catalog, 'send');
  assert.equal(send.method, 'unknown');
  assert.match(send.methodReason, /not a static string/);
  assert.equal(send.url.status, 'static');
  assert.equal(send.url.text, '/api/value');
  const carried = request(catalog, 'carried');
  assert.equal(carried.method, 'PUT');
  assert.equal(carried.url.status, 'partial');
  assert.equal(carried.url.text, '/api/items/${id}');
  assert.equal(request(catalog, 'plain').method, 'GET');
  assert.equal(request(catalog, 'upload').method, 'POST');
  assert.equal(request(catalog, 'weird').method, 'unknown');
  for (const member of ['plain', 'upload', 'weird']) {
    const site = request(catalog, member);
    assert.equal(site.transport, 'fetch');
    assert(site.conditions.some(item => item.includes('only available through await or then')));
  }
}));
