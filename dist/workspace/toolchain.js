import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UsageError } from '../cli/arguments.js';
function inside(root, file) {
    const part = relative(root, file);
    return part === '' || (!part.startsWith('..' + sep) && part !== '..' && !part.startsWith(sep));
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
    return { name, version: metadata.version, packageFile: await realpath(entry) };
}
export async function resolveToolchain(root) {
    const tsPackage = (await packageFromWorkspace(root, 'typescript', true));
    const compilerPackage = (await packageFromWorkspace(root, '@angular/compiler', true));
    const corePackage = (await packageFromWorkspace(root, '@angular/core', true));
    if (!/^6\.0\./.test(tsPackage.version))
        throw new UsageError(`Unsupported TypeScript ${tsPackage.version}; expected 6.0.x`);
    if (!/^22\./.test(compilerPackage.version) || compilerPackage.version !== corePackage.version) {
        throw new UsageError(`Unsupported Angular core/compiler versions: ${corePackage.version}/${compilerPackage.version}`);
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
    for (const [name, expected] of [['@ngrx/store', '22.0.0'], ['@ngrx/effects', '22.0.0'],
        ['@ngrx/signals', '22.0.0'], ['rxjs', '7.8.2']]) {
        const pkg = await packageFromWorkspace(root, name, false);
        if (pkg) {
            reactive.push(pkg);
            if (pkg.version !== expected)
                unsupportedReactive.push(`${name}@${pkg.version} (tested ${expected})`);
        }
    }
    return { typescript, angularCompiler, ts: tsPackage, compiler: compilerPackage,
        core: corePackage, reactive, unsupportedReactive };
}
