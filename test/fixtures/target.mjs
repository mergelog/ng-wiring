import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/**
 * §4.2 the analysed workspace owns its toolchain: it declares the packages and has them installed. A
 * fixture links this repository's `node_modules` for the installation, so it also has to write the
 * manifest that declares them — a copy no manifest claims is one an ng-wiring installation hoisted
 * there, and §4.2 does not analyse with it (P17-04).
 */
export const targetDependencies = {
  '@angular/common': '22.1.5', '@angular/compiler': '22.1.5', '@angular/core': '22.1.5',
  '@angular/forms': '22.1.5', '@angular/platform-browser': '22.1.5', '@angular/router': '22.1.5',
  '@ngrx/effects': '22.0.0', '@ngrx/operators': '22.0.0', '@ngrx/signals': '22.0.0',
  '@ngrx/store': '22.0.0', rxjs: '7.8.2', typescript: '6.0.3',
};

export async function writeTargetManifest(root, dependencies = targetDependencies) {
  await writeFile(path.join(root, 'package.json'),
    JSON.stringify({ name: 'target-workspace', private: true, version: '0.0.0', dependencies }, null, 2));
}

/**
 * The manifest plus the installed tree the fixtures share. Windows only creates a directory symlink
 * with a privilege the CI runner does not have, so the link is a junction there (§4.2 lists Windows
 * among the supported systems).
 */
export async function linkTargetWorkspace(root) {
  await writeTargetManifest(root);
  await symlink(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
}
