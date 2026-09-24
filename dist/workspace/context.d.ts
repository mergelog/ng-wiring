import type ts from 'typescript';
import { Snapshot } from './snapshot.js';
import { type Toolchain } from './toolchain.js';
export interface WorkspaceProject {
    name: string;
    type: 'application' | 'library';
    root: string;
    tsconfig: string;
    entry: string[];
    unapplied: string[];
}
export interface AnalysisContext {
    id: string;
    workspaceRoot: string;
    projectName: string | null;
    projectType: 'application' | 'library' | 'explicit';
    bootstrapRequired: boolean;
    tsconfig: string;
    configHash: string;
    compilerOptions: ts.CompilerOptions;
    toolchain: Toolchain;
    entry: string[];
    entryUnknown: boolean;
    program: ts.Program;
    checker: ts.TypeChecker;
    sourceFiles: string[];
    bootstrapReachableFiles: null;
    gaps: string[];
    unapplied: string[];
    snapshot: Snapshot;
    parsedConfig: ts.ParsedCommandLine;
}
export declare function discoverProjects(root: string, toolchain: Toolchain): Promise<WorkspaceProject[]>;
export declare function selectProjects(root: string, toolchain: Toolchain, name?: string): Promise<WorkspaceProject[]>;
export declare function workspaceRootForTsconfig(cwd: string, tsconfig: string): Promise<string>;
export declare function createContext(input: {
    workspaceRoot: string;
    project?: WorkspaceProject;
    tsconfig?: string;
    toolchain?: Toolchain;
}): Promise<AnalysisContext>;
export declare function iterateContexts(input: {
    cwd: string;
    project?: string;
    tsconfig?: string;
}): AsyncGenerator<AnalysisContext>;
export declare function collectContextCandidates<T extends {
    contextId: string;
}>(input: {
    cwd: string;
    project?: string;
    tsconfig?: string;
}, analyze: (context: AnalysisContext) => Promise<T[]>): Promise<T[]>;
export declare function verifyContextSnapshot(context: AnalysisContext): Promise<void>;
