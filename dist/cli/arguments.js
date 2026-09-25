import path from 'node:path';
export class UsageError extends Error {
    exitCode = 3;
}
const valueOptions = new Map([
    ['--source', 'source'], ['--project', 'project'], ['--tsconfig', 'tsconfig'],
    ['--through', 'through'], ['--route', 'route'], ['--selector', 'selector'], ['--candidate', 'candidate'],
    ['--event', 'event'], ['--out-dir', 'outDir'],
]);
export function parseAttribute(raw) {
    const index = raw.indexOf('=');
    if (index < 1)
        throw new UsageError('Attribute target must be NAME=VALUE');
    const name = raw.slice(0, index);
    let value = raw.slice(index + 1);
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))))
        value = value.slice(1, -1);
    return { kind: 'attribute', raw, name, value };
}
export function parseSource(raw) {
    const match = /^(.*):([1-9][0-9]*)$/.exec(raw);
    if (!match || !match[1] || !Number.isSafeInteger(Number(match[2]))) {
        throw new UsageError('Source target must be PATH:POSITIVE_LINE');
    }
    return { kind: 'source', raw, file: match[1], line: Number(match[2]) };
}
/** The direct-child form produced by Chrome DevTools' Copy selector. */
export function parseDomSelector(raw) {
    const segments = raw.split('>').map(part => part.trim());
    const tag = /^([A-Za-z][A-Za-z0-9-]*)/;
    const qualifiers = /^(?:(?:[.#][A-Za-z_][\w-]*)|(?::[A-Za-z-]+(?:\([^()]*\))?)|(?:\[[^\]]+\]))*$/;
    const tags = segments.map(part => {
        if (!part)
            return undefined;
        const name = tag.exec(part)?.[1] ?? null;
        return qualifiers.test(part.slice(name?.length ?? 0)) ? name?.toLowerCase() ?? null : undefined;
    });
    if (segments.length < 2 || tags.includes(undefined) || !tags.at(-1)) {
        throw new UsageError('--selector expects a DevTools Copy selector path with > between elements');
    }
    return tags.filter((name) => typeof name === 'string');
}
export function parseArguments(argv, cwd = process.cwd()) {
    if (argv.includes('--help') || argv.includes('--version')) {
        if (argv.length !== 1)
            throw new UsageError('--help and --version must be used alone');
        return { kind: argv[0] === '--help' ? 'help' : 'version' };
    }
    const seen = new Set();
    const values = {};
    let json = false;
    let detail = false;
    let belowData = false;
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--json') {
            if (json)
                throw new UsageError('Duplicate --json');
            json = true;
            continue;
        }
        if (token === '--detail') {
            if (detail)
                throw new UsageError('Duplicate --detail');
            detail = true;
            continue;
        }
        if (token === '--belowData') {
            if (belowData)
                throw new UsageError('Duplicate --belowData');
            belowData = true;
            continue;
        }
        const key = valueOptions.get(token);
        if (key) {
            if (seen.has(token))
                throw new UsageError(`Duplicate ${token}`);
            const value = argv[++i];
            if (!value || value.startsWith('--'))
                throw new UsageError(`Missing value for ${token}`);
            seen.add(token);
            values[key] = value;
        }
        else if (token.startsWith('-')) {
            throw new UsageError(`Unknown option: ${token}`);
        }
        else {
            positional.push(token);
        }
    }
    if (positional.length + Number(values.source !== undefined) !== 1) {
        throw new UsageError('Specify exactly one attribute target or --source');
    }
    if (values.project !== undefined && values.tsconfig !== undefined) {
        throw new UsageError('--project and --tsconfig are mutually exclusive');
    }
    if (detail && json)
        throw new UsageError('--detail and --json are mutually exclusive');
    if (belowData && (detail || json))
        throw new UsageError('--belowData requires the simple output');
    if (values.candidate && !/^(?:[1-9][0-9]*|cand:[a-f0-9]{64})$/.test(values.candidate)) {
        throw new UsageError('--candidate must be a positive number or full cand:SHA-256 ID');
    }
    if (values.through && !/^(?:[^#]+#)?[^/#]+$/.test(values.through)) {
        throw new UsageError('--through must be ClassName or path#ClassName');
    }
    if (values.selector)
        parseDomSelector(values.selector);
    const target = values.source === undefined ? parseAttribute(positional[0]) : parseSource(values.source);
    return { kind: 'run', options: {
            target, project: values.project, tsconfig: values.tsconfig && path.resolve(cwd, values.tsconfig),
            through: values.through, route: values.route, selector: values.selector, candidate: values.candidate,
            event: values.event, outDir: path.resolve(cwd, values.outDir ?? '.'), json,
            ...(detail ? { detail } : {}), ...(belowData ? { belowData } : {}),
        } };
}
export function resolveWorkspacePath(workspaceRoot, input) {
    // win32 paths are recognized even when the CLI is tested on POSIX.
    if (path.win32.isAbsolute(input))
        return input;
    return path.resolve(workspaceRoot, input);
}
