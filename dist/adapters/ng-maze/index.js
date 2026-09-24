import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { UsageError } from '../../cli/arguments.js';
import { discoverProjects } from '../../workspace/context.js';
const REVISION = '6da35347018531df30659d34e66a11d1bfcc3f22';
const SCHEMA_HASH = 'b6b9484cf3ba22d35e43c37660f181f15a31e022789c97d6e66233d56a227075';
const MAX_OUTPUT = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const requireHere = createRequire(import.meta.url);
const slash = (value) => value.replaceAll('\\', '/');
const inside = (root, file) => {
    const relative = path.relative(root, file);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
export async function locateNgmaze() {
    const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    if (manifest.dependencies?.ngmaze !== `github:mergelog/ng-maze#${REVISION}`) {
        throw new UsageError('ngmaze dependency revision mismatch');
    }
    const dirs = requireHere.resolve.paths('ngmaze') ?? [];
    for (const dir of dirs) {
        const packageFile = path.join(dir, 'ngmaze', 'package.json');
        if (!await stat(packageFile).then(s => s.isFile(), () => false))
            continue;
        const root = await realpath(path.dirname(packageFile));
        const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
        if (metadata.name !== 'ngmaze' || metadata.version !== '0.1.0')
            throw new UsageError('ngmaze package identity/version mismatch');
        const binRelative = metadata.bin?.ngmaze;
        if (!binRelative || path.isAbsolute(binRelative))
            throw new UsageError('ngmaze bin is missing or invalid');
        const candidate = path.resolve(root, binRelative);
        const binPath = await realpath(candidate).catch(() => { throw new UsageError('ngmaze bin does not exist'); });
        if (!inside(root, binPath) || !await stat(binPath).then(s => s.isFile(), () => false))
            throw new UsageError('ngmaze bin escapes package root');
        const schemaPath = await realpath(path.join(root, 'docs/ngmaze.schema.json')).catch(() => { throw new UsageError('ngmaze schema is missing'); });
        if (!inside(root, schemaPath))
            throw new UsageError('ngmaze schema escapes package root');
        const schemaHash = createHash('sha256').update(await readFile(schemaPath)).digest('hex');
        if (schemaHash !== SCHEMA_HASH)
            throw new UsageError('ngmaze schema hash differs from pinned revision');
        const localSchema = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/ngmaze.schema.json');
        if (createHash('sha256').update(await readFile(localSchema)).digest('hex') !== SCHEMA_HASH) {
            throw new UsageError('ng-wiring ngmaze schema copy differs from pinned revision');
        }
        return { root, binPath, schemaPath };
    }
    throw new UsageError('ngmaze package is not installed beside ng-wiring');
}
export function mazeArguments(context) {
    return context.projectName
        ? ['--project', context.workspaceRoot, '--angular-project', context.projectName, '--json']
        : ['--project', context.workspaceRoot, '--tsconfig', context.tsconfig, '--json'];
}
export async function invokeNgmaze(context, binPath, signal) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [binPath, ...mazeArguments(context)], { shell: false, cwd: context.workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'], signal });
        const chunks = [];
        const errors = [];
        let size = 0, errorSize = 0, settled = false;
        const fail = (error) => { if (!settled) {
            settled = true;
            child.kill();
            reject(error);
        } };
        const timer = setTimeout(() => fail(new Error('ngmaze timed out after 120 seconds')), TIMEOUT_MS);
        child.stdout.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_OUTPUT)
                fail(new Error('ngmaze stdout exceeded 64 MiB'));
            else
                chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            errorSize += chunk.length;
            if (errorSize > MAX_OUTPUT)
                fail(new Error('ngmaze stderr exceeded 64 MiB'));
            else
                errors.push(chunk);
        });
        child.on('error', error => fail(new Error(`ngmaze spawn failed: ${error.message}`)));
        child.on('close', (code, childSignal) => {
            clearTimeout(timer);
            if (settled)
                return;
            settled = true;
            const stderr = Buffer.concat(errors).toString('utf8');
            if (code !== 0)
                reject(new Error(`ngmaze exited ${code ?? childSignal}: ${stderr.trim()}`));
            else
                resolve({ stdout: Buffer.concat(chunks).toString('utf8'), stderr });
        });
    });
}
async function sameRealPath(left, right) {
    return await realpath(left).catch(() => '') === await realpath(right).catch(() => undefined);
}
export async function readNgmaze(context, signal) {
    const located = await locateNgmaze();
    const { stdout, stderr } = await invokeNgmaze(context, located.binPath, signal);
    let document;
    try {
        document = JSON.parse(stdout);
    }
    catch {
        throw new Error('ngmaze emitted invalid JSON');
    }
    const schema = JSON.parse(await readFile(located.schemaPath, 'utf8'));
    const validate = new Ajv({ strict: false }).compile(schema);
    if (!validate(document))
        throw new UsageError(`ngmaze JSON contract mismatch: ${new Ajv().errorsText(validate.errors)}`);
    const data = document;
    if (data.ngmazeVersion !== '0.1.0' || data.error)
        throw new UsageError('ngmaze version or result mismatch');
    const meta = data.meta;
    if (!await sameRealPath(meta.workspaceRoot, context.workspaceRoot) || !await sameRealPath(meta.analysisRoot, context.workspaceRoot)) {
        throw new UsageError('ngmaze workspace/analysis root mismatch');
    }
    if (meta.typescriptSource !== 'project' || meta.angularCompilerSource !== 'project' ||
        meta.typescriptVersion !== context.toolchain.ts.version || meta.angularCompilerVersion !== context.toolchain.compiler.version) {
        throw new UsageError('ngmaze used a different or bundled toolchain');
    }
    const discovered = await discoverProjects(context.workspaceRoot, context.toolchain);
    const projects = context.projectName ? [context.projectName] : discovered.map(project => project.name);
    if (meta.angularProjects.length !== projects.length ||
        [...meta.angularProjects].sort().some((name, index) => name !== [...projects].sort()[index])) {
        throw new UsageError('ngmaze project set mismatch');
    }
    const primary = meta.tsconfigFiles[0];
    if (!primary || !await sameRealPath(path.resolve(context.workspaceRoot, primary), context.tsconfig)) {
        throw new UsageError('ngmaze primary tsconfig mismatch');
    }
    for (const config of meta.tsconfigFiles) {
        const absolute = path.resolve(context.workspaceRoot, config);
        if (!await stat(absolute).then(s => s.isFile(), () => false))
            throw new UsageError(`ngmaze tsconfig does not exist: ${config}`);
        if (!context.projectName && !await sameRealPath(absolute, context.tsconfig)) {
            throw new UsageError('ngmaze merged another tsconfig into explicit analysis');
        }
        if (context.projectName && !await Promise.all(discovered.map(project => sameRealPath(project.tsconfig, absolute))).then(matches => matches.some(Boolean))) {
            throw new UsageError(`ngmaze merged an unknown tsconfig: ${config}`);
        }
        await context.snapshot.recordIfExists(absolute);
    }
    const allowed = new Set(context.sourceFiles.map(file => slash(path.relative(context.workspaceRoot, file))));
    const validId = (id) => {
        const match = /^(.+\.[cm]?tsx?)#([^/#]+)$/.exec(id);
        return !!match && allowed.has(slash(match[1]));
    };
    const components = data.result.components.filter(component => validId(component.id) &&
        inside(context.workspaceRoot, component.file) &&
        slash(path.relative(context.workspaceRoot, component.file)) === component.id.slice(0, component.id.lastIndexOf('#')));
    const known = new Set(components.map(component => component.id));
    const omissions = data.result.components.filter(component => !known.has(component.id)).map(component => component.id);
    const checkLocation = (location) => {
        const relative = slash(location.file);
        return allowed.has(relative) || context.snapshot.files.has(path.resolve(context.workspaceRoot, relative));
    };
    const validEdges = (edges) => edges
        .filter(edge => known.has(edge.from) && known.has(edge.to) && checkLocation(edge.location))
        .map(edge => ({ ...edge, origin: 'ngmaze' }));
    const edges = validEdges(data.result.edges);
    const routeEdges = validEdges(data.result.routeEdges);
    omissions.push(...data.result.edges.filter(edge => !edges.some(e => e.from === edge.from && e.to === edge.to && e.location.file === edge.location.file && e.location.line === edge.location.line)).map(edge => `${edge.from}->${edge.to}`));
    return { components, edges, routeEdges, routes: data.result.routes.filter(route => known.has(route.target) && checkLocation(route.location)),
        externalUsages: data.result.externalUsages, ambiguousUsages: data.result.ambiguousUsages,
        diagnostics: [...data.global.diagnostics, ...(stderr.trim() ? [{ code: 'ngmaze-stderr', message: stderr.trim(), file: '', location: { file: '', line: 1, column: 1, precision: 'approximate' }, owner: null }] : [])],
        detectionGaps: data.global.detectionGaps, omissions };
}
