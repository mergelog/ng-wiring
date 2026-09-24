import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span } from '../../index/templates.js';
export type ApiFamily = 'angular' | 'rxjs' | 'ngrx-operators';
export interface ApiIdentity {
    family: ApiFamily;
    name: string;
}
/** Identifies a package declaration after following import/re-export aliases. */
export declare function importedApi(context: AnalysisContext, node: ts.Node): ApiIdentity | null;
export interface OperatorSemantics {
    timing: 'sync' | 'timer' | 'microtask' | 'subscription' | 'unknown';
    conditions: string[];
    mode: string;
}
export declare function operatorSemantics(name: string): OperatorSemantics | null;
export interface OperatorRecord {
    name: string;
    api: ApiIdentity | null;
    location: string;
    semantics: OperatorSemantics | null;
    boundary: string | null;
}
export declare function inspectPipe(context: AnalysisContext, call: ts.CallExpression): OperatorRecord[];
export interface AsyncPipeConsumer {
    expression: string;
    span: Span;
    status: 'resolved' | 'boundary';
    conditions: string[];
    pipeId: string | null;
}
/** AsyncPipe is a template subscription, with view destruction as its lifetime. */
export declare function inspectAsyncPipe(element: IndexedElement, context: AnalysisContext, catalog: Catalog): AsyncPipeConsumer[];
export declare function location(context: AnalysisContext, node: ts.Node): string;
