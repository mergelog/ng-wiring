import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog, Declaration } from '../../index/catalog.js';
import type { ReactiveMethodGraph } from '../../adapters/reactive/methods.js';
import { type SignalStoreCatalog } from '../../adapters/reactive/signal-store.js';
import { type HttpBranch, type HttpCatalog, type HttpRequestSite } from './http.js';
import { type InjectorLayer } from './di.js';
import type { StoreEffect, StoreGraph } from './store.js';
import type { EventConsumer } from '../../adapters/reactive/events.js';
/** Where the created value is actually subscribed. `none` leaves the request a candidate, not a call. */
export type ConsumptionKind = 'subscribe' | 'promise-consume' | 'promise-result' | 'to-signal' | 'async-pipe' | 'rx-method' | 'effect-flattening' | 'event-handler' | 'none';
export interface HttpConsumption {
    kind: ConsumptionKind;
    location: string;
    /** What must be registered, created or called before this consumption can run. */
    registration: string[];
    registered: boolean;
    conditions: string[];
    branches: HttpBranch[];
    gaps: string[];
}
export interface HttpRequestFlow {
    request: HttpRequestSite;
    /** `confirmed` needs a subscription and a confirmed registration; everything else stays a candidate. */
    start: 'confirmed' | 'candidate';
    consumption: HttpConsumption;
    /** The call sites passed while following the value out of the wrappers that return it. */
    stages: string[];
    reason: string | null;
}
export interface HttpFlowInputs {
    catalog?: Catalog;
    store?: StoreGraph;
    methods?: ReactiveMethodGraph;
    stores?: SignalStoreCatalog;
}
export type HttpStepKind = 'call' | 'http-create' | 'http-consume' | 'type-use' | 'boundary';
export interface HttpStep {
    kind: HttpStepKind;
    source: string;
    target: string;
    location: string;
    path: string[];
    conditions: string[];
    detail: string | null;
    flowIndex?: number;
}
export interface HttpTrace {
    steps: HttpStep[];
    flows: HttpRequestFlow[];
    diagnostics: string[];
}
export declare function callIndex(context: AnalysisContext): Map<string, ts.CallExpression>;
/** Follows one request site to the consumer that starts it, through the wrappers that return it. */
export declare function resolveHttpStart(context: AnalysisContext, site: HttpRequestSite, inputs?: HttpFlowInputs, index?: Map<string, ts.CallExpression>, callPath?: ReadonlySet<string>): HttpRequestFlow;
/** Classifies every catalogued request site; a listing is never by itself the start of a network call. */
export declare function analyzeHttpFlows(context: AnalysisContext, catalog: HttpCatalog, inputs?: HttpFlowInputs): HttpRequestFlow[];
export interface HttpTraceOptions extends HttpFlowInputs {
    layers?: InjectorLayer[];
}
export declare function traceHttpFromMethod(context: AnalysisContext, catalog: HttpCatalog, owner: Declaration, methodName: string, options?: HttpTraceOptions): HttpTrace;
/** Traces a method contributed by a composed SignalStore feature. */
export declare function traceHttpFromStoreMethod(context: AnalysisContext, catalog: HttpCatalog, method: ts.MethodDeclaration | ts.PropertyAssignment, storeName: string, options?: HttpTraceOptions): HttpTrace;
/** Only an effect reached by the selected Action is entered; other registered effects stay outside this trace. */
export declare function traceHttpFromEffect(context: AnalysisContext, catalog: HttpCatalog, effect: StoreEffect, options?: HttpTraceOptions, conditions?: string[]): HttpTrace;
/** Follows only the handler pipeline that received the selected SignalStore event. */
export declare function traceHttpFromEventConsumer(context: AnalysisContext, catalog: HttpCatalog, consumer: EventConsumer, options?: HttpTraceOptions, conditions?: string[]): HttpTrace;
