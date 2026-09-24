import type { Capability, ReactiveFramework } from './capabilities.js';
/** Graph kinds. A Store method stays a `call`, patchState a `state-write`, a derived value a `reactive-link`. */
export type ReactiveStepKind = 'call' | 'state-read' | 'state-write' | 'reactive-link' | 'effect' | 'action-dispatch' | 'action-consume' | 'event-dispatch' | 'event-consume' | 'boundary';
/** How the read was taken. Only a tracked read creates a re-execution dependency. */
export type ReadTracking = 'tracked' | 'snapshot' | 'untracked';
/** When the effect body runs. A generated effect is not a consequence of every UI operation. */
export type EffectPhase = 'immediate' | 'change-detection' | 'after-render' | 'state-watcher' | 'subscription';
/** The two delivery systems stay separate: the same `{type, payload}` does not reach both. */
export type DeliveryBus = 'ngrx-action' | 'signal-store-event';
export type DeliveryScope = 'self' | 'parent' | 'global' | 'root';
export type DispatchForm = 'action-instance' | 'reactive-registration' | 'observer-next' | 'effect-return' | 'named-event' | 'direct-event' | 'handler-redelivery';
/** Identity of a state source: what declares it, which instance holds it, and which key was touched. */
export interface StateDetails {
    framework: ReactiveFramework;
    declaration: string;
    instance: string | null;
    key: string | null;
}
export interface EffectDetails {
    framework: ReactiveFramework;
    phase: EffectPhase;
    /** Start and end conditions, e.g. an onInit start or an onDestroy end. */
    lifetime: string[];
}
export interface DeliveryDetails {
    bus: DeliveryBus;
    /** Identifies the concrete bus instance, so a local scope is not confused with the global one. */
    busId: string;
    form: DispatchForm;
    scope: DeliveryScope;
    /** What must have been registered and still be alive for the delivery to occur. */
    registration: string[];
}
export interface ReactiveStep {
    kind: ReactiveStepKind;
    source: string;
    target: string;
    location: string;
    conditions: string[];
    detail: string | null;
    /** The registry matcher that produced this step, or null where no API was identified. */
    capability: string | null;
    state?: StateDetails;
    tracking?: ReadTracking;
    effect?: EffectDetails;
    delivery?: DeliveryDetails;
}
export declare function semanticGroup(semanticId: string): string;
/** Derives the graph kind from the registered semantic model instead of a per-call-site decision. */
export declare function stepKindFor(semanticId: string): ReactiveStepKind | null;
export declare function stepKindForCapability(capability: Capability): ReactiveStepKind | null;
/** A generated Store member keeps its own kind; none of them becomes an effect node. */
export type StoreMemberKind = 'state' | 'linked-state' | 'computed' | 'prop' | 'method' | 'hook' | 'handler';
export declare function storeMemberStepKind(kind: StoreMemberKind): ReactiveStepKind | null;
/** Every supported semantic model must be either a known step kind or an explicit declaration group. */
export declare function modelAudit(): string[];
