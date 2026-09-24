import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
import { type OperatorRecord } from './reactive.js';
export interface OperationStep {
    kind: 'call' | 'state-write' | 'output-emit' | 'reactive-link' | 'subscription' | 'boundary';
    source: string;
    target: string;
    location: string;
    path: string[];
    timing: 'sync' | 'output' | 'async-output' | 'timer' | 'microtask' | 'subscription' | 'change-detection' | 'unknown';
    conditions: string[];
    detail: string | null;
}
export interface SubscriptionRegistration {
    source: string;
    location: string;
    context: string;
    conditions: string[];
    operators: OperatorRecord[];
    active: boolean;
}
export interface OperationTrace {
    steps: OperationStep[];
    evidence: string[];
    registrations: SubscriptionRegistration[];
    diagnostics: string[];
}
/** Bounded, forward-only trace from one confirmed component method call. */
export declare function traceOperation(context: AnalysisContext, owner: Declaration, methodName: string): OperationTrace;
