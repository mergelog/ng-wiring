import type { AnalysisContext } from '../../workspace/context.js';
import type { SignalStoreCatalog } from './signal-store.js';
export type ReactiveMethodApi = 'signals/rxMethod' | 'signals/signalMethod';
export type MethodArgument = 'none' | 'value' | 'signal' | 'observable' | 'unknown';
export interface ReactiveMethod {
    id: string;
    capability: ReactiveMethodApi;
    /** The member name the factory result was assigned to, when there is one. */
    name: string | null;
    storeId: string | null;
    owner: string | null;
    source: string;
    conditions: string[];
    /** Set when nothing in the analysed sources calls it; the pipeline is defined but never started. */
    called: boolean;
}
export interface ReactiveMethodCall {
    id: string;
    methodId: string | null;
    capability: ReactiveMethodApi | null;
    argument: MethodArgument;
    source: string;
    conditions: string[];
    gaps: string[];
}
export interface ReactiveMethodGraph {
    methods: ReactiveMethod[];
    calls: ReactiveMethodCall[];
    diagnostics: string[];
}
/** Separates the definition of a reactive method from the calls that start it. */
export declare function analyzeReactiveMethods(context: AnalysisContext, stores?: SignalStoreCatalog): ReactiveMethodGraph;
