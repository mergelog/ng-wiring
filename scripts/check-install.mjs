#!/usr/bin/env node
/**
 * §9 the distribution test: install from an empty npm cache into an empty working directory and run.
 *
 * The pinned ngmaze is a GitHub dependency with a `prepare` script, so an install builds it from source
 * on the installing machine; an empty cache is what makes that path run instead of being served from a
 * previous install. The target workspace is a copy of the minimal fixture that declares its own
 * toolchain, so the run also proves the §4.2 separation on an installed package: the same workspace
 * with the toolchain undeclared is refused even though the packages sit in its `node_modules` (P17-03).
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';
const exists = (file) => stat(file).then(() => true, () => false);

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const step = (title, command, args, options) => {
  console.log(`\n> ${title}`);
  const result = spawnSync(command, args, { encoding: 'utf8', shell: windows, ...options });
  if (result.error) throw result.error;
  return result;
};

const root = await mkdtemp(path.join(tmpdir(), 'ngwi-install-'));
const cache = path.join(root, 'npm-cache');
const target = path.join(root, 'workspace');
const manifest = (dependencies) => writeFile(path.join(target, 'package.json'),
  JSON.stringify({ name: 'install-target', private: true, version: '0.0.0', dependencies }, null, 2));

try {
  await cp(path.join(repo, 'test/fixtures/minimal-app'), target, { recursive: true });

  const packed = step('npm pack', npm, ['pack', '--pack-destination', root], { cwd: repo });
  check(packed.status === 0, `npm pack failed: ${packed.stderr}`);
  const tarball = (await readdir(root)).find(name => name.endsWith('.tgz'));
  check(tarball !== undefined, 'npm pack produced no tarball');
  if (!tarball) throw new Error(failures.join('\n'));

  // The target declares the toolchain it is analysed with (§4.2) and ng-wiring as the packed file.
  const packedNgWiring = `file:${path.join(root, tarball)}`.replaceAll('\\', '/');
  await manifest({ '@angular/common': '22.1.5', '@angular/compiler': '22.1.5', '@angular/core': '22.1.5',
    '@angular/platform-browser': '22.1.5', '@angular/router': '22.1.5', rxjs: '7.8.2', typescript: '6.0.3',
    'ng-wiring': packedNgWiring });
  const install = step('npm install (empty cache, empty directory)', npm,
    ['install', '--cache', cache, '--no-audit', '--no-fund'], { cwd: target, stdio: 'inherit' });
  check(install.status === 0, 'npm install failed');

  check(await exists(path.join(target, 'node_modules/ngmaze/dist/cli/index.js')),
    'the pinned ngmaze was installed without its prepare build');
  const bin = path.join(target, 'node_modules/.bin', windows ? 'ng-wiring.cmd' : 'ng-wiring');
  check(await exists(bin), 'the installed package linked no ng-wiring bin');

  const version = step('ng-wiring --version', bin, ['--version'], { cwd: target });
  check(version.stdout.trim() === '0.1.0', `unexpected --version output: ${version.stdout.trim()}`);

  const report = step('ng-wiring on the installed workspace', bin,
    ['data-id="searchInputField"', '--project', 'app', '--candidate', '2', '--out-dir', 'out'], { cwd: target });
  check(report.status === 0, `the analysis exited ${report.status}: ${report.stderr}`);
  const written = await readdir(path.join(target, 'out')).catch(() => []);
  check(written.length === 1 && written[0].endsWith('.md'), `no report was written: ${written.join(', ')}`);

  // §4.2 the same installed tree, with the toolchain no longer declared, is the hoisting case.
  await manifest({ '@angular/core': '22.1.5', 'ng-wiring': packedNgWiring });
  const refused = step('ng-wiring with an undeclared toolchain', bin,
    ['data-id="searchInputField"', '--project', 'app', '--candidate', '2', '--out-dir', 'out'], { cwd: target });
  check(refused.status === 3, `an undeclared toolchain exited ${refused.status}, expected 3`);
  check(/no manifest of the workspace declares it/.test(refused.stderr),
    `unexpected refusal: ${refused.stderr.trim()}`);
  check((await readdir(path.join(target, 'out'))).length === 1, 'the refused run still wrote a report');
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  console.error('\nThe clean installation test failed:');
  for (const message of failures) console.error(`  ${message}`);
  process.exit(1);
}
console.log('\nInstalled from an empty cache into an empty directory, ran, and refused an undeclared toolchain');
