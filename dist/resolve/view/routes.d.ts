import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { MazeGraph } from '../../adapters/ng-maze/index.js';
export type RouteConditionKind = 'path' | 'path-match' | 'guard' | 'matcher' | 'order' | 'outlet' | 'redirect' | 'providers';
export interface RouteCondition {
    kind: RouteConditionKind;
    text: string;
    span: Span;
}
export interface RouteOccurrence {
    id: string;
    configId: string;
    rooted: boolean;
    definition: Span;
    /** Import/loader call sites that pull this route in, outermost first (P6-02). */
    loaders: Span[];
    path: string | null;
    pathUnresolved: boolean;
    pattern: string;
    outlet: string | null;
    outletUnresolved: boolean;
    componentId: string | null;
    componentUnresolved: boolean;
    componentless: boolean;
    redirectTo: string | null;
    order: number;
    /** Own conditions plus every ancestor condition, outermost first (P6-04). */
    conditions: RouteCondition[];
    parentId: string | null;
    /** Nearest ancestor occurrence that has a component; componentless routes are skipped (P6-03). */
    hostRouteId: string | null;
    gaps: string[];
}
export interface RouteConfig {
    id: string;
    kind: 'provideRouter' | 'forRoot' | 'forChild' | 'routes-array';
    span: Span;
    bootstrapId: string | null;
    rooted: boolean;
}
export interface BootstrapOccurrence {
    id: string;
    kind: 'application' | 'module';
    entry: string;
    span: Span;
    componentIds: string[];
    moduleId: string | null;
    configIds: string[];
    gaps: string[];
}
export interface RouteGraph {
    occurrences: RouteOccurrence[];
    byId: Map<string, RouteOccurrence>;
    byComponent: Map<string, RouteOccurrence[]>;
    configs: Map<string, RouteConfig>;
    bootstraps: BootstrapOccurrence[];
    bootstrapByComponent: Map<string, BootstrapOccurrence[]>;
    redirects: RouteOccurrence[];
    diagnostics: string[];
    gaps: string[];
}
/** `() => import('…').then(m => m.X)`, `async () => (await import('…')).X`, `() => X`, `() => import('…')`. */
export declare function lazyTarget(context: AnalysisContext, expression: ts.Expression, depth?: number): ts.Declaration | undefined;
export declare function buildRouteGraph(context: AnalysisContext, catalog: Catalog, maze?: MazeGraph): RouteGraph;
export type OutletPlacement = {
    kind: 'outlet';
    element: IndexedElement;
    hostId: string;
    conditions: string[];
} | {
    kind: 'unresolved';
    reason: string;
};
/** P6-06/P6-07: look for the outlet only inside the nearest display host's own template and child views. */
export declare function resolveOutletPlacement(context: AnalysisContext, graph: RouteGraph, index: TemplateIndex, occurrence: RouteOccurrence): OutletPlacement[];
