import { type Candidate } from '../cli/candidates.js';
import { type Target } from '../cli/arguments.js';
import type { AnalysisContext } from '../workspace/context.js';
import type { Catalog } from './catalog.js';
import { type TemplateIndex } from './templates.js';
import { type ViewPath } from '../resolve/view/index.js';
import type { RouteGraph } from '../resolve/view/routes.js';
import type { MazeGraph } from '../adapters/ng-maze/index.js';
export interface IndexedCandidate {
    candidate: Candidate;
    path: ViewPath;
}
export declare function buildIndexedCandidates(context: AnalysisContext, catalog: Catalog, index: TemplateIndex, target: Target, maze?: MazeGraph, routes?: RouteGraph): IndexedCandidate[];
