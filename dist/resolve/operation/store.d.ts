import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import { type BootstrapOccurrence, type RouteGraph, type RouteOccurrence } from '../view/routes.js';
export interface StoreRegistration {
    kind: 'root' | 'feature' | 'effects';
    scope: 'root' | 'route' | 'module';
    key: string | null;
    target: string | null;
    source: string;
    conditions: string[];
    status: 'resolved' | 'boundary';
}
export interface StoreAction {
    id: string;
    type: string | null;
    source: string;
}
export interface StoreReducer {
    id: string;
    feature: string | null;
    actions: string[];
    source: string;
    registered: boolean;
    conditions: string[];
}
export interface StoreEffect {
    id: string;
    owner: string | null;
    listens: string[];
    emits: string[];
    explicitDispatches: string[];
    emissionConditions: Record<string, string[]>;
    dispatch: boolean;
    functional: boolean;
    registered: boolean;
    source: string;
    conditions: string[];
    gaps: string[];
}
export interface StoreSelector {
    id: string;
    dependencies: string[];
    source: string;
}
export interface StoreConsumer {
    id: string;
    selector: string;
    owner: string;
    kind: 'select' | 'selectSignal' | 'template';
    source: string;
    active: boolean;
    conditions: string[];
}
export interface StoreComputed {
    id: string;
    owner: string;
    from: string;
    source: string;
    active: boolean;
    conditions: string[];
}
export interface StoreGraph {
    registrations: StoreRegistration[];
    actions: StoreAction[];
    reducers: StoreReducer[];
    effects: StoreEffect[];
    selectors: StoreSelector[];
    consumers: StoreConsumer[];
    computeds: StoreComputed[];
    diagnostics: string[];
}
export interface StoreInputs {
    rootProviders: ts.Expression[];
    routeProviders?: ts.Expression[];
    modules?: ts.ClassDeclaration[];
    routeModules?: ts.ClassDeclaration[];
}
/** Collects providers only from a selected bootstrap and its selected route ancestry. */
export declare function storeInputsForSelection(context: AnalysisContext, catalog: Catalog, routes: RouteGraph, bootstrap: BootstrapOccurrence, route?: RouteOccurrence): StoreInputs;
/** Catalogues NgRx behavior, then joins it only to the supplied active injector registrations. */
export declare function analyzeStore(context: AnalysisContext, catalog: Catalog, inputs: StoreInputs): StoreGraph;
