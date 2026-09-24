import { type AnalysisContext } from '../../workspace/context.js';
export interface MazeLocation {
    file: string;
    line: number;
    column: number;
    precision: 'exact' | 'approximate';
}
export interface MazeComponent {
    id: string;
    className: string;
    selector: string | null;
    selectorUnresolved: boolean;
    templateKind: 'inline' | 'external' | 'none';
    templateFile: string | null;
    effectiveStandalone: boolean;
    file: string;
    location: MazeLocation;
}
export interface MazeEdge {
    from: string;
    to: string;
    kind: string;
    location: MazeLocation;
    order: number;
    route?: {
        path: string;
        outlet: string | null;
    };
}
export interface MazeRoute {
    path: string;
    target: string;
    targetKind: string;
    host: string | null;
    outlet: string | null;
    location: MazeLocation;
    angularProject: string | null;
}
export interface MazeDiagnostic {
    code: string;
    message: string;
    file: string;
    location: MazeLocation;
    owner: string | null;
    detail?: string;
}
export interface MazeGap extends MazeDiagnostic {
    candidates: string[];
}
export interface MazeExternalUsage {
    callerKind: 'class' | 'function' | 'file';
    callerName: string;
    target: string;
    kind: string;
    location: MazeLocation;
}
export interface MazeDocument {
    ngmazeVersion: string;
    meta: {
        workspaceRoot: string;
        analysisRoot: string;
        angularProjects: string[];
        tsconfigFiles: string[];
        typescriptVersion: string;
        typescriptSource: string;
        angularCompilerVersion: string;
        angularCompilerSource: string;
    };
    global: {
        diagnostics: MazeDiagnostic[];
        detectionGaps: MazeGap[];
    };
    result: {
        components: MazeComponent[];
        edges: MazeEdge[];
        routeEdges: MazeEdge[];
        routes: MazeRoute[];
        externalUsages: MazeExternalUsage[];
        ambiguousUsages: unknown[];
    };
    error: null | {
        code: string;
        message: string;
    };
}
export interface MazeGraph {
    components: MazeComponent[];
    edges: (MazeEdge & {
        origin: 'ngmaze';
    })[];
    routeEdges: (MazeEdge & {
        origin: 'ngmaze';
    })[];
    routes: MazeRoute[];
    externalUsages: MazeExternalUsage[];
    ambiguousUsages: unknown[];
    diagnostics: MazeDiagnostic[];
    detectionGaps: MazeGap[];
    omissions: string[];
}
export declare function locateNgmaze(): Promise<{
    root: string;
    binPath: string;
    schemaPath: string;
}>;
export declare function mazeArguments(context: AnalysisContext): string[];
export declare function invokeNgmaze(context: AnalysisContext, binPath: string, signal?: AbortSignal): Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function readNgmaze(context: AnalysisContext, signal?: AbortSignal): Promise<MazeGraph>;
