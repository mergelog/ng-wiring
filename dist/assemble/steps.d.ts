import type { StoreTrace } from '../resolve/operation/store-flow.js';
import type { HttpTrace } from '../resolve/operation/http-flow.js';
import type { OperationTrace } from '../resolve/operation/flow.js';
import type { ReactiveStep } from '../adapters/reactive/model.js';
import { type DetailField, type EdgeKind, type NodeKind } from '../model/types.js';
/** One end of a traced relation: the symbol id the layer reported and the kind the §8 table needs. */
export interface TracedEnd {
    kind: NodeKind;
    id: string;
    label: string;
    /** Set when the caller already has the node, e.g. the listener an operation starts from. */
    nodeId?: string;
}
/** A relation an operation layer produced, already shaped for the §8 edge table. */
export interface TracedEdge {
    kind: EdgeKind;
    from: TracedEnd;
    to: TracedEnd;
    /** `relative/path.ts:line:column`, as the operation layers record positions. */
    location: string;
    conditions: string[];
    details: Record<string, DetailField>;
    /** Registry matcher that produced the step, so the ledger can check which API was exercised. */
    capability: string | null;
}
/** §8 every required detail is present; one the layer did not report stays null with its reason. */
export declare function completeDetails(kind: EdgeKind, provided: Record<string, DetailField>): Record<string, DetailField>;
/** The live RxJS pipeline reached by Subject.next, including its operator sites and emitted values. */
export declare function operationTraceEdges(trace: OperationTrace, ownerId: string, outputTypes: ReadonlyMap<string, string>): TracedEdge[];
/** §7.4 the NgRx trace. Every step keeps the direction cause to receiver that §5 stores. */
export declare function storeTraceEdges(trace: StoreTrace): TracedEdge[];
/** §7.5 the HTTP trace. Request details come from the request site the step names. */
export declare function httpTraceEdges(trace: HttpTrace): TracedEdge[];
/** §7.6 the shared reactive step model: Signal, SignalStore and the two delivery buses. */
export declare function reactiveStepEdges(steps: readonly ReactiveStep[]): TracedEdge[];
