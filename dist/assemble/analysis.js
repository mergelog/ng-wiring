import { UsageError } from '../cli/arguments.js';
import { iterateContexts } from '../workspace/context.js';
import { buildCatalog } from '../index/catalog.js';
import { indexTemplates } from '../index/templates.js';
import { buildIndexedCandidates } from '../index/candidates.js';
import { buildRouteGraph } from '../resolve/view/routes.js';
import { readNgmaze } from '../adapters/ng-maze/index.js';
/**
 * §4 one pass per analysis context: catalog, ngmaze base graph, template index, route graph, candidates.
 * A version/schema/context mismatch from ngmaze stays fatal (§4.3); a process failure becomes a recorded
 * problem so the run continues with the locally built catalog and says what is missing.
 */
export async function analyzeWorkspace(input) {
    const contexts = [];
    for await (const context of iterateContexts({ cwd: input.cwd, project: input.options.project,
        tsconfig: input.options.tsconfig })) {
        input.signal?.throwIfAborted();
        const catalog = await buildCatalog(context);
        const mazeProblems = [];
        let maze;
        if (input.ngmaze === false)
            mazeProblems.push('ngmaze was not run for this analysis');
        else {
            try {
                maze = await readNgmaze(context, input.signal);
            }
            catch (error) {
                if (error instanceof UsageError)
                    throw error;
                mazeProblems.push(`ngmaze did not produce a base graph: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (maze?.omissions.length)
            mazeProblems.push(`ngmaze reported ${maze.omissions.length} components or edges outside this Program`);
        const index = await indexTemplates(context, catalog, maze);
        const routes = buildRouteGraph(context, catalog, maze);
        const candidates = buildIndexedCandidates(context, catalog, index, input.options.target, maze, routes);
        contexts.push({ context, catalog, index, routes, maze, mazeProblems, candidates });
    }
    const candidates = contexts.flatMap(item => item.candidates);
    return {
        contexts, candidates,
        targetDetectionIncomplete: contexts.some(item => detectionIncomplete(item)),
        truncated: candidates.some(item => item.path.end === 'limit'),
    };
}
/** §3.3 detection is incomplete when the catalog, the index or the base graph could not be completed. */
export function detectionIncomplete(analysis) {
    return analysis.mazeProblems.length > 0 || analysis.context.gaps.length > 0 ||
        analysis.catalog.gaps.length > 0 || analysis.index.diagnostics.length > 0 ||
        analysis.index.unsupported.length > 0 || analysis.routes.gaps.length > 0;
}
export function contextOf(analysis, candidate) {
    const found = analysis.contexts.find(item => item.candidates.includes(candidate));
    if (!found)
        throw new Error(`Candidate ${candidate.candidate.id} belongs to no analysed context`);
    return found;
}
