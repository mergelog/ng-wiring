import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { UsageError } from '../cli/arguments.js';
import { Snapshot } from './snapshot.js';
import { resolveToolchain } from './toolchain.js';
async function exists(file) {
    try {
        return (await stat(file)).isFile();
    }
    catch {
        return false;
    }
}
function slash(file) { return file.replaceAll('\\', '/'); }
function stablePath(root, file) {
    return within(root, file) ? slash(path.relative(root, file)) : `external:${path.basename(file)}`;
}
function within(root, file) {
    const part = path.relative(root, file);
    return part === '' || (part !== '..' && !part.startsWith(`..${path.sep}`) && !path.isAbsolute(part));
}
async function readAngularJson(root, toolchain) {
    const file = path.join(root, 'angular.json');
    if (!await exists(file))
        return undefined;
    const parsed = toolchain.typescript.parseConfigFileTextToJson(file, await readFile(file, 'utf8'));
    if (parsed.error || !parsed.config || typeof parsed.config !== 'object')
        throw new UsageError('Invalid angular.json');
    return parsed.config;
}
export async function discoverProjects(root, toolchain) {
    const angular = await readAngularJson(root, toolchain);
    const projects = angular?.projects;
    if (!projects || typeof projects !== 'object')
        return [];
    const output = [];
    for (const [name, value] of Object.entries(projects)) {
        if (!value || typeof value !== 'object')
            continue;
        const data = value;
        if (data.projectType !== 'application' && data.projectType !== 'library')
            continue;
        const relativeRoot = typeof data.root === 'string' ? data.root : '';
        const projectRoot = path.resolve(root, relativeRoot);
        const architect = data.architect;
        const targets = data.targets;
        const build = (architect?.build ?? targets?.build);
        const options = build?.options;
        let tsconfig;
        if (typeof options?.tsConfig === 'string')
            tsconfig = path.resolve(root, options.tsConfig);
        else
            for (const fallback of ['tsconfig.app.json', 'tsconfig.json']) {
                const file = path.join(projectRoot, fallback);
                if (await exists(file)) {
                    tsconfig = file;
                    break;
                }
            }
        if (!tsconfig || !await exists(tsconfig))
            throw new UsageError(`No tsconfig for project ${name}`);
        const entry = [options?.browser, options?.main].filter((x) => typeof x === 'string').map(x => path.resolve(root, x));
        const unapplied = [];
        if (build?.configurations || build?.defaultConfiguration || data.defaultConfiguration)
            unapplied.push('build configurations/defaultConfiguration');
        if (options?.fileReplacements || JSON.stringify(build?.configurations ?? {}).includes('fileReplacements'))
            unapplied.push('fileReplacements');
        if (typeof build?.builder === 'string' && !['@angular/build:application', '@angular-devkit/build-angular:application', '@angular-devkit/build-angular:browser'].includes(build.builder))
            unapplied.push(`custom builder ${build.builder}`);
        if (options?.server || options?.ssr || options?.prerender)
            unapplied.push('SSR/hydration build settings');
        output.push({ name, type: data.projectType, root: projectRoot, tsconfig, entry, unapplied });
    }
    return output;
}
export async function selectProjects(root, toolchain, name) {
    const projects = await discoverProjects(root, toolchain);
    if (name) {
        const project = projects.find(p => p.name === name);
        if (!project)
            throw new UsageError(`Unknown Angular project: ${name}`);
        return [project];
    }
    const apps = projects.filter(p => p.type === 'application');
    if (!apps.length)
        throw new UsageError('No application projects; specify --project or --tsconfig');
    return apps;
}
export async function workspaceRootForTsconfig(cwd, tsconfig) {
    return await exists(path.join(cwd, 'angular.json')) ? await realpath(cwd) : await realpath(path.dirname(tsconfig));
}
function readConfig(configPath, toolchain) {
    const tsApi = toolchain.typescript;
    const configFiles = new Set();
    const host = {
        ...tsApi.sys,
        onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new UsageError(tsApi.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); },
        readFile: file => { configFiles.add(path.resolve(file)); return tsApi.sys.readFile(file); },
    };
    const parsed = tsApi.getParsedCommandLineOfConfigFile(configPath, { noEmit: true }, host);
    if (!parsed)
        throw new UsageError(`Cannot parse tsconfig: ${configPath}`);
    if (parsed.errors.length)
        throw new UsageError(parsed.errors.map(d => tsApi.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    return { parsed, configFiles: [...configFiles] };
}
function relevantSource(file) {
    const normalized = slash(file);
    return !/\.(?:d\.)?tsx?$/.test(normalized) ? /\.(?:ts|tsx|mts|cts)$/.test(normalized) :
        !normalized.endsWith('.d.ts');
}
function excluded(file) {
    const p = slash(file);
    return /(?:^|\/)(?:node_modules|dist|out-tsc|generated|_old)(?:\/|$)/.test(p) ||
        /(?:\.spec|\.test|\.generated|\.g)\.[cm]?tsx?$/.test(p);
}
export async function createContext(input) {
    const workspaceRoot = await realpath(input.workspaceRoot);
    const toolchain = input.toolchain ?? await resolveToolchain(workspaceRoot);
    const config = input.project?.tsconfig ?? input.tsconfig;
    if (!config)
        throw new UsageError('No tsconfig selected');
    const tsconfig = await realpath(config);
    const { parsed, configFiles } = readConfig(tsconfig, toolchain);
    if (!input.project && parsed.projectReferences && parsed.projectReferences.length > 1 && parsed.fileNames.length === 0) {
        throw new UsageError('Solution tsconfig has multiple references; select a concrete tsconfig');
    }
    const tsApi = toolchain.typescript;
    const program = tsApi.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true }, projectReferences: parsed.projectReferences });
    const checker = program.getTypeChecker();
    const gaps = [];
    const sourceFiles = [];
    const configRoots = new Set(parsed.fileNames.filter(file => !file.endsWith('.d.ts')).map(p => path.resolve(p)));
    for (const source of program.getSourceFiles()) {
        const file = path.resolve(source.fileName);
        if (source.isDeclarationFile) {
            if (within(workspaceRoot, file) && !slash(file).includes('/node_modules/') &&
                !parsed.fileNames.includes(file) && !file.endsWith('/typings.d.ts'))
                gaps.push(`Declaration boundary (possibly project reference): ${file}`);
            continue;
        }
        if (!relevantSource(file))
            continue;
        if (!within(workspaceRoot, file)) {
            gaps.push(`Linked source outside workspace: ${file}`);
            continue;
        }
        if (excluded(file)) {
            gaps.push(`Excluded source needed by program: ${file}`);
            continue;
        }
        sourceFiles.push(file);
    }
    for (const rootName of configRoots)
        if (!sourceFiles.includes(rootName) && !excluded(rootName))
            gaps.push(`Configured source absent from Program: ${rootName}`);
    for (const source of program.getSourceFiles()) {
        if (source.isDeclarationFile || !within(workspaceRoot, source.fileName))
            continue;
        for (const statement of source.statements) {
            if (!tsApi.isImportDeclaration(statement) || !tsApi.isStringLiteral(statement.moduleSpecifier))
                continue;
            const specifier = statement.moduleSpecifier.text;
            if (!specifier.startsWith('.') && !specifier.startsWith('/'))
                continue;
            const resolved = tsApi.resolveModuleName(specifier, source.fileName, parsed.options, tsApi.sys).resolvedModule;
            if (!resolved)
                gaps.push(`Unresolved import ${specifier} at ${source.fileName}:${source.getLineAndCharacterOfPosition(statement.getStart()).line + 1}`);
        }
    }
    const entry = input.project?.entry ?? parsed.fileNames.filter(file => /(?:^|[\\/])main\.[cm]?tsx?$/.test(file));
    const validEntry = entry.filter(file => sourceFiles.includes(path.resolve(file)));
    if (entry.length && validEntry.length !== entry.length)
        gaps.push('One or more configured entries are absent from Program');
    const snapshot = new Snapshot(workspaceRoot);
    const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];
    const templates = new Set();
    for (const source of program.getSourceFiles()) {
        if (source.isDeclarationFile || !within(workspaceRoot, source.fileName))
            continue;
        const visit = (node) => {
            if (tsApi.isPropertyAssignment(node) && tsApi.isIdentifier(node.name) && node.name.text === 'templateUrl' &&
                tsApi.isStringLiteralLike(node.initializer))
                templates.add(path.resolve(path.dirname(source.fileName), node.initializer.text));
            tsApi.forEachChild(node, visit);
        };
        visit(source);
    }
    for (const template of templates)
        if (!await exists(template))
            gaps.push(`Missing template: ${template}`);
    for (const file of [...configFiles, ...sourceFiles, ...templates, ...entry, ...[
            toolchain.ts, toolchain.compiler, toolchain.core, ...toolchain.reactive,
        ].map(p => p.packageFile)])
        await snapshot.recordIfExists(file);
    for (const lock of lockfiles)
        await snapshot.recordIfExists(path.join(workspaceRoot, lock));
    await snapshot.recordIfExists(path.join(workspaceRoot, 'angular.json'));
    const configHash = createHash('sha256').update(configFiles.sort().map(file => `${stablePath(workspaceRoot, file)}:${snapshot.files.get(file)}`).join('\n')).digest('hex');
    const id = createHash('sha256').update(JSON.stringify({ project: input.project?.name ?? null,
        tsconfig: stablePath(workspaceRoot, tsconfig), configHash,
        ts: toolchain.ts.version, compiler: toolchain.compiler.version })).digest('hex');
    return { id, workspaceRoot, projectName: input.project?.name ?? null,
        projectType: input.project?.type ?? 'explicit', bootstrapRequired: input.project?.type === 'application',
        bootstrapReachableFiles: null, tsconfig, configHash,
        compilerOptions: parsed.options, toolchain, entry: validEntry, entryUnknown: validEntry.length === 0,
        program, checker, sourceFiles, gaps, unapplied: input.project?.unapplied ?? [], snapshot, parsedConfig: parsed };
}
export async function* iterateContexts(input) {
    if (input.project && input.tsconfig)
        throw new UsageError('--project and --tsconfig are mutually exclusive');
    const root = input.tsconfig ? await workspaceRootForTsconfig(input.cwd, input.tsconfig) : await realpath(input.cwd);
    const toolchain = await resolveToolchain(root);
    if (input.tsconfig) {
        yield await createContext({ workspaceRoot: root, tsconfig: input.tsconfig, toolchain });
        return;
    }
    const selected = await selectProjects(root, toolchain, input.project);
    for (const project of selected)
        yield await createContext({ workspaceRoot: root, project, toolchain });
}
export async function collectContextCandidates(input, analyze) {
    const candidates = [];
    for await (const context of iterateContexts(input)) {
        const scoped = await analyze(context);
        if (scoped.some(item => item.contextId !== context.id)) {
            throw new Error(`Candidate crossed analysis context ${context.projectName ?? context.tsconfig}`);
        }
        candidates.push(...scoped);
    }
    return candidates;
}
export async function verifyContextSnapshot(context) {
    const { parsed } = readConfig(context.tsconfig, context.toolchain);
    const before = [...context.parsedConfig.fileNames].sort();
    const after = [...parsed.fileNames].sort();
    if (before.length !== after.length || before.some((file, index) => file !== after[index])) {
        throw new Error('Source file set changed during analysis; rerun');
    }
    await context.snapshot.verify();
}
