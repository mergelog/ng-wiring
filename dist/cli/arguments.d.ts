export declare class UsageError extends Error {
    readonly exitCode = 3;
}
export type Target = {
    kind: 'attribute';
    raw: string;
    name: string;
    value: string;
} | {
    kind: 'source';
    raw: string;
    file: string;
    line: number;
};
export interface CliOptions {
    target: Target;
    project?: string;
    tsconfig?: string;
    through?: string;
    route?: string;
    selector?: string;
    candidate?: string;
    event?: string;
    outDir: string;
    json: boolean;
}
export type ParsedArguments = {
    kind: 'help';
} | {
    kind: 'version';
} | {
    kind: 'run';
    options: CliOptions;
};
export declare function parseAttribute(raw: string): Extract<Target, {
    kind: 'attribute';
}>;
export declare function parseSource(raw: string): Extract<Target, {
    kind: 'source';
}>;
/** The direct-child form produced by Chrome DevTools' Copy selector. */
export declare function parseDomSelector(raw: string): string[];
export declare function parseArguments(argv: readonly string[], cwd?: string): ParsedArguments;
export declare function resolveWorkspacePath(workspaceRoot: string, input: string): string;
