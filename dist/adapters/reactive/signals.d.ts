import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import { type ReactiveFramework } from './capabilities.js';
import type { EffectPhase, ReadTracking, StateDetails } from './model.js';
export interface SignalSource {
    id: string;
    capability: string;
    state: StateDetails;
    source: string;
    /** Keys carried by a state object source; empty for a single signal. */
    keys: string[];
    conditions: string[];
}
export interface SignalRead {
    id: string;
    sourceId: string | null;
    expression: string;
    tracking: ReadTracking;
    /** Why the read is not tracked, when it sits inside a tracked region. */
    reason: string | null;
    location: string;
}
export interface SignalWrite {
    id: string;
    sourceId: string | null;
    capability: string;
    keys: string[];
    location: string;
    conditions: string[];
}
export interface SignalLink {
    id: string;
    capability: string;
    /** Declaration identity and readable expression of the value entering the reactive adapter. */
    from: string | null;
    sourceExpression: string | null;
    to: string | null;
    location: string;
    /** The custom equality function, when one was supplied. */
    equal: string | null;
    conditions: string[];
}
export interface SignalEffectNode {
    id: string;
    framework: ReactiveFramework;
    phase: EffectPhase;
    capability: string;
    /** SignalState observed directly by watchState (which receives snapshots, not Signal reads). */
    sourceId: string | null;
    location: string;
    lifetime: string[];
    reads: string[];
    /** Registered teardown callbacks, and explicit destroy calls on the returned reference. */
    cleanups: string[];
    destroys: string[];
}
export interface SignalGraph {
    sources: SignalSource[];
    reads: SignalRead[];
    writes: SignalWrite[];
    links: SignalLink[];
    effects: SignalEffectNode[];
    diagnostics: string[];
}
/** Catalogues Angular Signal and SignalState sources, their reads, writes, derived links, and effects. */
export declare function analyzeSignals(context: AnalysisContext, files?: readonly ts.SourceFile[]): SignalGraph;
