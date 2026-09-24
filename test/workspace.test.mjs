import { linkTargetWorkspace, writeTargetManifest } from './fixtures/target.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, discoverProjects, selectProjects, verifyContextSnapshot, iterateContexts, collectContextCandidates } from '../dist/workspace/context.js';
import { StaticEvaluator } from '../dist/workspace/evaluate.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-workspace-'));
  try {
    await linkTargetWorkspace(root);
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: {
      app: { projectType: 'application', root: '', targets: { build: { builder: '@angular/build:application',
        options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } },
      lib: { projectType: 'library', root: '', targets: { build: { options: { tsConfig: 'tsconfig.app.json' } } } },
    } }));
    await writeFile(path.join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext',
      baseUrl: '.', paths: { '@shared': ['src/shared.ts'] }, skipLibCheck: true,
    } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ extends: './tsconfig.base.json', files: ['src/main.ts'] }));
    await writeFile(path.join(root, 'src/main.ts'), "import { value } from '@shared'; export const entry = value;\n");
    await writeFile(path.join(root, 'src/shared.ts'), 'export const value = { a: [1, 2] };\n');
    await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('workspace selects application contexts and TS import closure independently', async () => fixture(async root => {
  const toolchain = await resolveToolchain(root);
  assert.equal(toolchain.ts.version, '6.0.3');
  assert.equal(toolchain.compiler.version, '22.1.5');
  assert.deepEqual(toolchain.unsupportedReactive, []);
  assert.deepEqual((await selectProjects(root, toolchain)).map(p => p.name), ['app']);
  assert.equal((await discoverProjects(root, toolchain)).length, 2);
  const contexts = [];
  for await (const item of iterateContexts({ cwd: root })) contexts.push(item.projectName);
  assert.deepEqual(contexts, ['app']);
  const project = (await selectProjects(root, toolchain))[0];
  const context = await createContext({ workspaceRoot: root, project, toolchain });
  assert.equal(context.projectName, 'app');
  assert.equal(context.entryUnknown, false);
  assert.equal(context.bootstrapRequired, true);
  assert.equal(context.bootstrapReachableFiles, null);
  const library = (await selectProjects(root, toolchain, 'lib'))[0];
  const libraryContext = await createContext({ workspaceRoot: root, project: library, toolchain });
  assert.notEqual(context.id, libraryContext.id);
  assert.equal(libraryContext.entryUnknown, true);
  assert.equal(libraryContext.bootstrapRequired, false);
  assert(context.sourceFiles.some(file => file.endsWith('/src/shared.ts')));
  assert.equal(context.compilerOptions.baseUrl, root);
  assert.equal(context.gaps.length, 0);
  await verifyContextSnapshot(context);
  await writeFile(path.join(root, 'src/shared.ts'), 'export const value = { a: [2, 3] };\n');
  await assert.rejects(verifyContextSnapshot(context), /Snapshot changed/);
}));

test('multiple applications are analyzed serially and candidates retain their context', async () => fixture(async root => {
  const angular = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'angular.json'), 'utf8'));
  angular.projects.app2 = { ...angular.projects.app, root: '' };
  await writeFile(path.join(root, 'angular.json'), JSON.stringify(angular));
  let active = 0;
  const candidates = await collectContextCandidates({ cwd: root }, async context => {
    assert.equal(active++, 0);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return [{ contextId: context.id, projectName: context.projectName }];
  });
  assert.deepEqual(candidates.map(c => c.projectName), ['app', 'app2']);
  assert.notEqual(candidates[0].contextId, candidates[1].contextId);
  await assert.rejects(collectContextCandidates({ cwd: root }, async () => [{ contextId: 'other' }]), /crossed analysis context/);
}));

test('explicit config keeps multiple entry candidates and project build settings remain unapplied', async () => fixture(async root => {
  await mkdir(path.join(root, 'src/other'));
  await writeFile(path.join(root, 'src/other/main.ts'), 'export const other = true;');
  const config = path.join(root, 'tsconfig.app.json');
  await writeFile(config, JSON.stringify({ extends: './tsconfig.base.json', files: ['src/main.ts', 'src/other/main.ts'] }));
  const toolchain = await resolveToolchain(root);
  const explicit = await createContext({ workspaceRoot: root, tsconfig: config, toolchain });
  assert.equal(explicit.projectName, null);
  assert.equal(explicit.entry.length, 2);
  const angular = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'angular.json'), 'utf8'));
  angular.projects.app.targets.build.defaultConfiguration = 'production';
  angular.projects.app.targets.build.configurations = { production: { fileReplacements: [{ replace: 'a.ts', with: 'b.ts' }] } };
  await writeFile(path.join(root, 'angular.json'), JSON.stringify(angular));
  const project = (await selectProjects(root, toolchain))[0];
  const scoped = await createContext({ workspaceRoot: root, project, toolchain });
  assert(scoped.unapplied.includes('fileReplacements'));
  assert(scoped.unapplied.includes('build configurations/defaultConfiguration'));
  assert.equal(scoped.entry.length, 1);
}));

test('unresolved extension and linked source are boundaries', async () => fixture(async root => {
  const external = path.join(path.dirname(root), `${path.basename(root)}-external.ts`);
  try {
    await writeFile(external, 'export const external = true;');
    await writeFile(path.join(root, 'src/main.ts'), `import { external } from '../../${path.basename(external)}'; import data from './data.svg'; export { external, data };`);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    assert(context.gaps.some(gap => gap.includes('Linked source outside workspace')));
    assert(context.gaps.some(gap => gap.includes('Unresolved import ./data.svg')));
  } finally { await rm(external, { force: true }); }
}));

test('new configured source files invalidate the snapshot file set', async () => fixture(async root => {
  const config = path.join(root, 'tsconfig.app.json');
  await writeFile(config, JSON.stringify({ extends: './tsconfig.base.json', include: ['src/**/*.ts'] }));
  const toolchain = await resolveToolchain(root);
  const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
  await writeFile(path.join(root, 'src/new.ts'), 'export const newlyAdded = true;');
  await assert.rejects(verifyContextSnapshot(context), /file set changed/);
}));

test('configured but unused sources stay discovered without inferred bootstrap reachability', async () => fixture(async root => {
  await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ extends: './tsconfig.base.json', include: ['src/**/*.ts'] }));
  await writeFile(path.join(root, 'src/unused.ts'), 'export const unused = true;');
  const toolchain = await resolveToolchain(root);
  const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
  assert(context.sourceFiles.includes(path.join(root, 'src/unused.ts')));
  assert.equal(context.bootstrapReachableFiles, null);
}));

test('missing target compiler dependencies do not use the CLI bundled versions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-no-toolchain-'));
  try { await assert.rejects(resolveToolchain(root), /Missing typescript/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('unsupported compiler version is rejected while reactive version is reported', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-version-'));
  try {
    await mkdir(path.join(root, 'node_modules/@angular'), { recursive: true });
    await mkdir(path.join(root, 'node_modules/@ngrx'), { recursive: true });
    await writeTargetManifest(root);
    await symlink(path.join(repo, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'), 'dir');
    await symlink(path.join(repo, 'node_modules/@angular/compiler'), path.join(root, 'node_modules/@angular/compiler'), 'dir');
    await mkdir(path.join(root, 'node_modules/@angular/core'));
    await writeFile(path.join(root, 'node_modules/@angular/core/package.json'), JSON.stringify({ name: '@angular/core', version: '22.2.0' }));
    await assert.rejects(resolveToolchain(root), /Unsupported Angular core\/compiler/);
    await rm(path.join(root, 'node_modules/@angular/core'), { recursive: true });
    await symlink(path.join(repo, 'node_modules/@angular/core'), path.join(root, 'node_modules/@angular/core'), 'dir');
    await mkdir(path.join(root, 'node_modules/@ngrx/store'));
    await writeFile(path.join(root, 'node_modules/@ngrx/store/package.json'), JSON.stringify({ name: '@ngrx/store', version: '21.0.0' }));
    const toolchain = await resolveToolchain(root);
    assert(toolchain.unsupportedReactive.some(item => item.startsWith('@ngrx/store@21.0.0')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('static evaluator resolves imports and refuses calls', async () => fixture(async root => {
  await writeFile(path.join(root, 'src/shared.ts'), 'export const value = { a: [1, 2] }; export function pure(){ return value.a; } export function sideEffect(){ throw Error(); }\n');
  await writeFile(path.join(root, 'src/main.ts'), "import { value, pure, sideEffect } from '@shared'; export const entry = value.a; export const computed = pure(); export const unsafe = sideEffect();\n");
  const toolchain = await resolveToolchain(root);
  const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
  const source = context.program.getSourceFile(path.join(root, 'src/main.ts'));
  const evaluator = new StaticEvaluator(toolchain.typescript, context.checker);
  assert.deepEqual(evaluator.evaluate(source.statements[1].declarationList.declarations[0].initializer), { known: true, value: [1, 2] });
  assert.deepEqual(evaluator.evaluate(source.statements[2].declarationList.declarations[0].initializer), { known: true, value: [1, 2] });
  assert.equal(evaluator.evaluate(source.statements[3].declarationList.declarations[0].initializer).known, false);
}));

test('excluded imports and templates are tracked without creating false source nodes', async () => fixture(async root => {
  await mkdir(path.join(root, 'src/_old'));
  await writeFile(path.join(root, 'src/_old/legacy.ts'), 'export const old = 1;');
  await writeFile(path.join(root, 'src/view.html'), '<div></div>');
  await writeFile(path.join(root, 'src/main.ts'), "import { old } from './_old/legacy.js'; export const view = { templateUrl: './view.html', old };\n");
  const toolchain = await resolveToolchain(root);
  const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
  assert(context.gaps.some(gap => gap.includes('Excluded source')));
  assert(!context.sourceFiles.some(file => file.includes('/_old/')));
  assert(context.snapshot.files.has(path.join(root, 'src/view.html')));
  await writeFile(path.join(root, 'src/view.html'), '<span></span>');
  await assert.rejects(verifyContextSnapshot(context), /Snapshot changed/);
}));

test('solution tsconfig with multiple references requires a concrete config', async () => fixture(async root => {
  const solution = path.join(root, 'tsconfig.solution.json');
  await writeFile(solution, JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.base.json' }] }));
  await assert.rejects(createContext({ workspaceRoot: root, tsconfig: solution }), /multiple references/);
}));
