import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UsageError } from '../cli/arguments.js';
/** Angular 20.0/20.1 use TS 5.8; 20.2/20.3 also allow TS 5.9. Angular 22 uses TS 6.0. */
export function supportedTypeScript(angularVersion, typescriptVersion) {
    const [major, minor] = angularVersion.split('.').map(Number);
    return major === 20
        ? /^5\.8\./.test(typescriptVersion) || (minor >= 2 && /^5\.9\./.test(typescriptVersion))
        : major === 22 && /^6\.0\./.test(typescriptVersion);
}
export const TESTED_REACTIVE_VERSIONS = {
    '@ngrx/store': ['20.0.0', '20.1.0', '22.0.0'],
    '@ngrx/effects': ['20.0.0', '20.1.0', '22.0.0'],
    '@ngrx/signals': ['20.0.0', '20.1.0', '22.0.0'],
    '@ngrx/operators': ['20.0.0', '20.1.0', '22.0.0'],
    rxjs: ['7.8.2'],
};
function inside(root, file) {
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
async function declaredByWorkspace(root, name) {
    let directory = root;
    for (;;) {
        let manifest;
        try {
            manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        }
        catch {
            manifest = undefined;
        }
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            if (manifest?.[field] && Object.hasOwn(manifest[field], name))
                return true;
        }
        const parent = dirname(directory);
        if (parent === directory)
            return false;
        directory = parent;
    }
}
async function packageFromWorkspace(root, name, required) {
    const requireFromTarget = createRequire(join(root, 'package.json'));
    let entry;
    try {
        entry = requireFromTarget.resolve(`${name}/package.json`);
    }
    catch {
        if (!required)
            return undefined;
        throw new UsageError(`Missing ${name} in target workspace node_modules`);
    }
    let installedRoot, linkedPackage;
    try {
        installedRoot = await realpath(join(root, 'node_modules'));
        linkedPackage = await realpath(join(root, 'node_modules', name));
    }
    catch {
        if (!required)
            return undefined;
        throw new UsageError(`Missing ${name} in target workspace node_modules`);
    }
    const resolved = await realpath(entry);
    if (!inside(installedRoot, resolved) && !inside(linkedPackage, resolved)) {
        throw new UsageError(`${name} resolved outside target node_modules`);
    }
    const metadata = JSON.parse(await readFile(entry, 'utf8'));
    if (metadata.name !== name || !metadata.version)
        throw new UsageError(`Invalid ${name} package metadata`);
    if (!await declaredByWorkspace(root, name)) {
        if (!required)
            return undefined;
        throw new UsageError(`${name} is in the target node_modules but no manifest of the workspace declares it; ` +
            `it came with an installation of ng-wiring, and analysing the sources with it is not the target's own toolchain`);
    }
    return { name, version: metadata.version, packageFile: await realpath(entry) };
}
export async function resolveToolchain(root) {
    const tsPackage = (await packageFromWorkspace(root, 'typescript', true));
    const compilerPackage = (await packageFromWorkspace(root, '@angular/compiler', true));
    const corePackage = (await packageFromWorkspace(root, '@angular/core', true));
    if (!/^(20|22)\./.test(compilerPackage.version) || compilerPackage.version !== corePackage.version) {
        throw new UsageError(`Unsupported Angular core/compiler versions: ${corePackage.version}/${compilerPackage.version}`);
    }
    if (!supportedTypeScript(compilerPackage.version, tsPackage.version)) {
        throw new UsageError(`Unsupported TypeScript ${tsPackage.version} for Angular ${compilerPackage.version}; ` +
            'expected 5.8.x for Angular 20.0/20.1, 5.8.x or 5.9.x for Angular 20.2/20.3, or 6.0.x for Angular 22');
    }
    const requireFromTarget = createRequire(join(root, 'package.json'));
    let typescript, angularCompiler;
    try {
        typescript = requireFromTarget('typescript');
        angularCompiler = await import(pathToFileURL(join(dirname(compilerPackage.packageFile), 'fesm2022', 'compiler.mjs')).href);
    }
    catch (cause) {
        throw new UsageError(`Cannot load target TypeScript/Angular compiler: ${String(cause)}`);
    }
    if (typescript.version !== tsPackage.version || typeof angularCompiler.parseTemplate !== 'function') {
        throw new UsageError('Target compiler module and package metadata disagree');
    }
    const reactive = [];
    const unsupportedReactive = [];
    for (const name of ['@ngrx/store', '@ngrx/effects', '@ngrx/signals', 'rxjs']) {
        const pkg = await packageFromWorkspace(root, name, false);
        if (pkg) {
            reactive.push(pkg);
            const expected = TESTED_REACTIVE_VERSIONS[name];
            if (!expected.includes(pkg.version))
                unsupportedReactive.push(`${name}@${pkg.version} (tested ${expected.join(', ')})`);
        }
    }
    return { typescript, angularCompiler, ts: tsPackage, compiler: compilerPackage,
        core: corePackage, reactive, unsupportedReactive };
}
