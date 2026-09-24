import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { builtinModules } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
