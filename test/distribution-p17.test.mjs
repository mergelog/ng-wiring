import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { builtinModules } from 'node:module';
import { mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { locateNgmaze, NGMAZE_REVISION } from '../dist/adapters/ng-maze/index.js';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { writeTargetManifest } from './fixtures/target.mjs';

const run = promisify(execFile);
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const cli = path.join(repo, 'dist/cli/index.js');

/** Every module specifier a built file names, with comments removed so prose about imports is not one. */
function specifiers(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const found = [];
  for (const pattern of [/^\s*(?:import|export)\b[^'\n]*\bfrom\s+'([^']+)'/gm, /^\s*import\s+'([^']+)'/gm,
    /\bimport\s*\(\s*'([^']+)'/g, /\brequire\s*\(\s*'([^']+)'/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

async function builtFiles(dir = path.join(repo, 'dist')) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await builtFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

/**
 * §9 the package is one Node.js CLI: a single `bin`, no install-time hook that would fetch or build
 * anything on the machine, and no platform restriction.
 */
test('the package declares one bin and needs no install-time step (P17-01, P17-02)', () => {
  assert.deepEqual(Object.keys(manifest.bin), ['ng-wiring']);
  assert.equal(manifest.bin['ng-wiring'], './dist/cli/index.js');
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']) {
    assert.equal(manifest.scripts[hook], undefined, `${hook} would run on install`);
  }
  assert.equal(manifest.os, undefined);
  assert.equal(manifest.cpu, undefined);
  assert.equal(manifest.engines.node, '^22.22.3 || ^24.15.0 || >=26.0.0');
  for (const shipped of ['dist', 'docs', 'README.md', 'LICENSE']) assert(manifest.files.includes(shipped));
});

test('the built entry is an executable Node script (P17-01)', async () => {
  const entry = await readFile(cli, 'utf8');
  assert.match(entry, /^#!\/usr\/bin\/env node\n/);
});

/**
 * §9 nothing outside Node and the declared runtime dependencies may be reachable from the build, so the
 * command needs no global installation and no browser extension. TypeScript and the Angular compiler are
 * deliberately absent: §4.2 resolves them from the analysed workspace at run time, never from here.
 */
test('the build imports only Node builtins and declared dependencies (P17-01, P17-04)', async () => {
  const declared = new Set(Object.keys(manifest.dependencies));
  const builtins = new Set(builtinModules);
  const external = new Set();
  for (const file of await builtFiles()) {
    for (const specifier of specifiers(await readFile(file, 'utf8'))) {
      if (specifier.startsWith('.')) continue;
      const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
      const owner = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : bare.split('/')[0];
      if (builtins.has(bare)) continue;
      assert(declared.has(owner), `${path.relative(repo, file)} imports undeclared ${specifier}`);
      external.add(owner);
    }
  }
  assert.deepEqual([...external].sort(), ['ajv']);
});

/**
 * §9 running it requires nothing installed globally: an absolute path to the shipped entry, a working
 * directory unrelated to the package, an empty `NODE_PATH` and a home directory with no global modules.
 */
test('the CLI runs from an unrelated directory with no global installation (P17-01)', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ngwi-standalone-'));
  try {
    const env = { ...process.env, NODE_PATH: '', HOME: cwd, USERPROFILE: cwd, NODE_OPTIONS: '' };
    const version = await run(process.execPath, [cli, '--version'], { cwd, env });
    assert.equal(version.stdout, '0.1.0\n');
    const help = await run(process.execPath, [cli, '--help'], { cwd, env });
    assert.match(help.stdout, /^Usage: ng-wiring ATTRIBUTE=VALUE/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

/** §9 the built `dist` is part of the distribution, so every built file is a tracked file. */
test('every built file is tracked for distribution (P17-02)', async () => {
  const tracked = new Set((await run('git', ['ls-files', 'dist'], { cwd: repo })).stdout.split('\n').filter(Boolean));
  const built = (await builtFiles()).map(file => path.relative(repo, file).replaceAll('\\', '/'));
  assert(built.length > 0);
  for (const file of built) assert(tracked.has(file), `${file} is built but not tracked`);
  for (const file of tracked) {
    if (file.endsWith('.js')) assert(built.includes(file), `${file} is tracked but no longer built`);
  }
});

/**
 * §9 the dependencies that start the adapter are ng-wiring's own; the toolchain that types the target
 * sources is the target's. ng-wiring therefore declares neither TypeScript nor the Angular compiler at
 * run time: the pinned ngmaze is a process it starts, and `ajv` only validates that process's JSON.
 */
test('the runtime dependencies are the adapter, not a toolchain (P17-04)', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['ajv', 'ngmaze']);
  assert.equal(manifest.dependencies.ngmaze, `github:mergelog/ng-maze#${NGMAZE_REVISION}`);
  for (const name of ['typescript', '@angular/compiler', '@angular/core']) {
    assert.equal(manifest.dependencies[name], undefined, `${name} would be shipped as a runtime dependency`);
    assert(manifest.devDependencies[name], `${name} is still needed to build and to run the fixtures`);
  }
});

test('the ngmaze adapter is located in ng-wiring, not in the analysed workspace (P17-04)', async () => {
  const located = await locateNgmaze();
  assert.equal(located.root, await realpath(path.join(repo, 'node_modules/ngmaze')));
  assert(located.binPath.startsWith(located.root + path.sep));
  const target = await mkdtemp(path.join(tmpdir(), 'ngwi-no-maze-'));
  try {
    // A workspace without ngmaze installed still gets the pinned one: it is not the target's dependency.
    await writeTargetManifest(target);
    assert.equal((await locateNgmaze()).binPath, located.binPath);
  } finally { await rm(target, { recursive: true, force: true }); }
});

/**
 * §4.2 the run refuses a toolchain the workspace does not own. Installing ng-wiring hoists its ngmaze's
 * `typescript` and `@angular/compiler` into the target `node_modules`, where they sit at the same paths
 * a workspace's own copies would; only the manifest separates them.
 */
test('a toolchain the workspace never declared is refused (P17-04)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-hoisted-'));
  try {
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeTargetManifest(root, { 'some-app-dependency': '1.0.0' });
    await assert.rejects(resolveToolchain(root), /typescript is in the target node_modules but no manifest/);
    await writeTargetManifest(root, { typescript: '6.0.3', '@angular/compiler': '22.1.5', '@angular/core': '22.1.5' });
    const toolchain = await resolveToolchain(root);
    assert.equal(toolchain.ts.version, '6.0.3');
    assert(toolchain.ts.packageFile.startsWith(await realpath(path.join(repo, 'node_modules')) + path.sep));
    // The reactive packages are installed in that same tree, and stay out of the report until declared.
    assert.deepEqual(toolchain.reactive, []);
    await writeTargetManifest(root);
    assert.deepEqual((await resolveToolchain(root)).reactive.map(item => item.name),
      ['@ngrx/store', '@ngrx/effects', '@ngrx/signals', 'rxjs']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
