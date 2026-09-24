import { type CliOptions } from '../cli/arguments.js';
import { type AnalysisContext } from '../workspace/context.js';
import { type Catalog } from '../index/catalog.js';
import { type TemplateIndex } from '../index/templates.js';
import { type IndexedCandidate } from '../index/candidates.js';
import { type RouteGraph } from '../resolve/view/routes.js';
import { type MazeGraph } from '../adapters/ng-maze/index.js';
/** Everything one analysis context contributes, kept together so `write` reuses what `analyze` built. */
export interface ContextAnalysis {
    context: AnalysisContext;
    catalog: Catalog;
    index: TemplateIndex;
    routes: RouteGraph;
    maze: MazeGraph | undefined;
    /** Why the base graph is missing or incomplete; never an empty success. */
    mazeProblems: string[];
    candidates: IndexedCandidate[];
}
export interface WorkspaceAnalysis {
    contexts: ContextAnalysis[];
    candidates: IndexedCandidate[];
    targetDetectionIncomplete: boolean;
    truncated: boolean;
}
export interface AnalyzeInput {
    options: CliOptions;
    cwd: string;
    signal?: AbortSignal;
    /** Set false to skip the ngmaze subprocess; the missing base graph is then reported, not hidden. */
    ngmaze?: boolean;
}
/**
 * §4 one pass per analysis context: catalog, ngmaze base graph, template index, route graph, candidates.
 * A version/schema/context mismatch from ngmaze stays fatal (§4.3); a process failure becomes a recorded
 * problem so the run continues with the locally built catalog and says what is missing.
 */
export declare function analyzeWorkspace(input: AnalyzeInput): Promise<WorkspaceAnalysis>;
/** §3.3 detection is incomplete when the catalog, the index or the base graph could not be completed. */
export declare function detectionIncomplete(analysis: ContextAnalysis): boolean;
export declare function contextOf(analysis: WorkspaceAnalysis, candidate: IndexedCandidate): ContextAnalysis;
