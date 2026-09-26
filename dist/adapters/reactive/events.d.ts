import type { AnalysisContext } from '../../workspace/context.js';
import type { DeliveryBus, DeliveryScope, DispatchForm } from './model.js';
import type { SignalStoreCatalog } from './signal-store.js';
export interface EventCreator {
    id: string;
    /** The static event type, or null when it could not be read. */
    type: string | null;
    name: string;
    groupId: string | null;
    source: string;
}
export interface EventDispatch {
    id: string;
    creatorId: string | null;
    creatorType: string | null;
    bus: DeliveryBus;
    form: DispatchForm;
    /** The scope written at the dispatch site; the bus instance is resolved separately. */
    scope: DeliveryScope;
    owner: string | null;
    source: string;
    conditions: string[];
    status: 'resolved' | 'boundary';
    reason: string | null;
}
export type EventConsumerKind = 'reducer' | 'handler' | 'subscription';
export interface EventConsumer {
    id: string;
    kind: EventConsumerKind;
    creatorIds: string[];
    creatorTypes: string[];
    bus: DeliveryBus;
    owner: string | null;
    storeId: string | null;
    /** State keys a reducer consumer writes, empty for the other kinds. */
    writes: string[];
    source: string;
    conditions: string[];
    /** Events this consumer emits again through the dispatcher. */
    redelivers: {
        creatorId: string | null;
        creatorType: string | null;
        scope: DeliveryScope;
        source: string;
    }[];
    gaps: string[];
}
export interface EventBridge {
    id: string;
    fromConsumer: string;
    toBus: DeliveryBus;
    target: string;
    source: string;
    conditions: string[];
}
export interface CrossBusSend {
    creatorId: string;
    creatorType: string | null;
    owner: string | null;
    source: string;
    reason: string;
}
export interface EventGraph {
    creators: EventCreator[];
    dispatches: EventDispatch[];
    consumers: EventConsumer[];
    /** SignalStore events sent through the NgRx Store bus with no bridge to an event consumer. */
    crossBus: CrossBusSend[];
    /** Owners whose injector calls provideDispatcher, i.e. the owners that start a new bus instance. */
    dispatcherOwners: string[];
    bridges: EventBridge[];
    diagnostics: string[];
}
/** Catalogues the SignalStore event bus: creators, send sites, consumers, and explicit bridges. */
export declare function analyzeEvents(context: AnalysisContext, stores: SignalStoreCatalog): EventGraph;
export interface DeliveryResolution {
    busId: string;
    parentBusId: string;
    status: 'resolved' | 'boundary';
    consumers: EventConsumer[];
    conditions: string[];
    reasons: string[];
}
/** Picks the bus instance the scope names, then matches only consumers listening on that same instance. */
export declare function resolveEventDelivery(graph: EventGraph, dispatch: EventDispatch, ancestry: string[], consumerAncestry?: (consumer: EventConsumer) => string[] | null): DeliveryResolution;
export declare function busOfCapability(matcherId: string): DeliveryBus | null;
