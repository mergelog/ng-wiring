import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type ts from 'typescript';
import { UsageError } from '../cli/arguments.js';

export interface PackageVersion { name: string; version: string; packageFile: string }
export interface Toolchain {
  typescript: typeof ts;
  angularCompiler: typeof import('@angular/compiler');
  ts: PackageVersion;
  compiler: PackageVersion;
  core: PackageVersion;
  reactive: PackageVersion[];
  unsupportedReactive: string[];
}

function inside(root: string, file: string): boolean {
  const part = relative(root, file);
  return part === '' || (!part.startsWith('..' + sep) && part !== '..' && !part.startsWith(sep));
}

/**
 * §4.2 the analysed workspace must own its toolchain. Installing ng-wiring puts its own and ngmaze's
 * `typescript` and `@angular/compiler` into the target `node_modules` by hoisting, where they are
 * indistinguishable by path from the target's own copies. The workspace manifest is what tells them
 * apart: a package nothing declares is there because ng-wiring was installed, not because the workspace
 * uses it, and analysing with it would be the silent fallback §4.2 forbids (P17-04).
 */
async function declaredByWorkspace(root: string, name: string): Promise<boolean> {
  let directory = root;
  for (;;) {
    let manifest: Record<string, Record<string, string> | undefined> | undefined;
    try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as typeof manifest; }
    catch { manifest = undefined; }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (manifest?.[field] && Object.hasOwn(manifest[field], name)) return true;
    }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

async function packageFromWorkspace(root: string, name: string, required: boolean): Promise<PackageVersion | undefined> {
  const requireFromTarget = createRequire(join(root, 'package.json'));
  let entry: string;
  try { entry = requireFromTarget.resolve(`${name}/package.json`); }
  catch {
    if (!required) return undefined;
    throw new UsageError(`Missing ${name} in target workspace node_modules`);
  }
  let installedRoot: string, linkedPackage: string;
  try {
    installedRoot = await realpath(join(root, 'node_modules'));
    linkedPackage = await realpath(join(root, 'node_modules', name));
  } catch {
    if (!required) return undefined;
    throw new UsageError(`Missing ${name} in target workspace node_modules`);
  }
  const resolved = await realpath(entry);
  if (!inside(installedRoot, resolved) && !inside(linkedPackage, resolved)) {
    throw new UsageError(`${name} resolved outside target node_modules`);
  }
  const metadata = JSON.parse(await readFile(entry, 'utf8')) as { name?: string; version?: string };
  if (metadata.name !== name || !metadata.version) throw new UsageError(`Invalid ${name} package metadata`);
  if (!await declaredByWorkspace(root, name)) {
    if (!required) return undefined;
    throw new UsageError(`${name} is in the target node_modules but no manifest of the workspace declares it; ` +
      `it came with an installation of ng-wiring, and analysing the sources with it is not the target's own toolchain`);
  }
  return { name, version: metadata.version, packageFile: await realpath(entry) };
}

export async function resolveToolchain(root: string): Promise<Toolchain> {
  const tsPackage = (await packageFromWorkspace(root, 'typescript', true))!;
  const compilerPackage = (await packageFromWorkspace(root, '@angular/compiler', true))!;
  const corePackage = (await packageFromWorkspace(root, '@angular/core', true))!;
  if (!/^6\.0\./.test(tsPackage.version)) throw new UsageError(`Unsupported TypeScript ${tsPackage.version}; expected 6.0.x`);
  if (!/^22\./.test(compilerPackage.version) || compilerPackage.version !== corePackage.version) {
    throw new UsageError(`Unsupported Angular core/compiler versions: ${corePackage.version}/${compilerPackage.version}`);
  }
  const requireFromTarget = createRequire(join(root, 'package.json'));
  let typescript: typeof ts, angularCompiler: typeof import('@angular/compiler');
  try {
    typescript = requireFromTarget('typescript') as typeof ts;
    angularCompiler = await import(pathToFileURL(join(dirname(compilerPackage.packageFile), 'fesm2022', 'compiler.mjs')).href) as typeof import('@angular/compiler');
  } catch (cause) { throw new UsageError(`Cannot load target TypeScript/Angular compiler: ${String(cause)}`); }
  if (typescript.version !== tsPackage.version || typeof angularCompiler.parseTemplate !== 'function') {
    throw new UsageError('Target compiler module and package metadata disagree');
  }
  const reactive: PackageVersion[] = [];
  const unsupportedReactive: string[] = [];
  for (const [name, expected] of [['@ngrx/store', '22.0.0'], ['@ngrx/effects', '22.0.0'],
    ['@ngrx/signals', '22.0.0'], ['rxjs', '7.8.2']] as const) {
    const pkg = await packageFromWorkspace(root, name, false);
    if (pkg) {
      reactive.push(pkg);
      if (pkg.version !== expected) unsupportedReactive.push(`${name}@${pkg.version} (tested ${expected})`);
    }
  }
  return { typescript, angularCompiler, ts: tsPackage, compiler: compilerPackage,
    core: corePackage, reactive, unsupportedReactive };
}
