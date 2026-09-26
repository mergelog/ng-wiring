import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement } from '../../index/templates.js';
import { type InjectorLayer } from './di.js';
import type { StoreGraph } from './store.js';
export type StoreStepKind = 'call' | 'output-emit' | 'output-subscription' | 'action-dispatch' | 'action-consume' | 'state-write' | 'state-read' | 'reactive-link' | 'boundary';
export interface StoreStep {
    kind: StoreStepKind;
    source: string;
    target: string;
    location: string;
    path: string[];
    conditions: string[];
    detail: string | null;
    dispatchMode?: 'explicit' | 'reactive-factory' | 'observer-next';
}
export interface StoreTrace {
    steps: StoreStep[];
    diagnostics: string[];
    backgroundReads: string[];
}
export interface StoreTraceOptions {
    outputElement?: IndexedElement;
    catalog?: Catalog;
    outputUses?: ReadonlyMap<string, IndexedElement>;
    parentLayers?: InjectorLayer[];
    changedInput?: string;
    rootArguments?: readonly ts.Expression[];
    /** A verified MatDialogRef instance delivers its close value to this afterClosed call. */
    afterClosedLocation?: string;
    /** The selection reaches no route, so a route provided registration can be neither confirmed nor denied. */
    routeInjectorUnknown?: boolean;
}
/** Traverses a chosen method and its confirmed DI callees, then registered NgRx transitions. */
export declare function traceStoreDispatch(context: AnalysisContext, graph: StoreGraph, owner: Declaration, methodName: string, layers?: InjectorLayer[], options?: StoreTraceOptions): StoreTrace;
