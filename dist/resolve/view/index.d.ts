import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { ControlFlowFrame, IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { MazeGraph } from '../../adapters/ng-maze/index.js';
import { type RouteGraph } from './routes.js';
export type ViewRelation = 'element' | 'component-use' | 'projection-slot' | 'fragment-declaration' | 'template-insertion' | 'structural-view' | 'control-flow' | 'dynamic-creation' | 'route-outlet' | 'bootstrap';
export interface ViewRouteRef {
    occurrenceId: string;
    pattern: string;
    outlet: string | null;
    definition: Span;
    loaders: Span[];
    rooted: boolean;
}
export interface ViewStep {
    number: string;
    relation: ViewRelation;
    ownerId: string;
    label: string;
    span: Span | null;
    displayParent: boolean;
    declarationOwnerId: string;
    expressionOwnerId: string;
    diOwnerId: string;
    diContextOverride: string | null;
    displayCondition: string | null;
    creationCondition: string | null;
    insertionContext: string | null;
    routeRef: ViewRouteRef | null;
    controlFlow: ControlFlowFrame | null;
}
export interface ViewPath {
    steps: ViewStep[];
    declarationRefs: {
        ownerId: string;
        span: Span | null;
    }[];
    end: 'root-unresolved' | 'unrendered' | 'projection-unresolved' | 'fragment-uninstantiated' | 'dynamic-boundary' | 'route-unresolved' | 'bootstrap' | 'cycle' | 'limit';
    reason: string;
}
/** §6.3 initial finitization limits. */
export interface ViewLimits {
    depth: number;
    paths: number;
    states: number;
}
export declare const defaultViewLimits: ViewLimits;
export interface ViewLimitReport extends ViewLimits {
    depthStops: number;
    pathStops: number;
    stateStops: number;
    unexplored: number;
}
export interface ViewResolution {
    paths: ViewPath[];
    diagnostics: string[];
    limits: ViewLimitReport;
}
export declare function resolveViewPaths(target: IndexedElement, context: AnalysisContext, catalog: Catalog, index: TemplateIndex, limit?: number | Partial<ViewLimits>, maze?: MazeGraph, routes?: RouteGraph): ViewResolution;
