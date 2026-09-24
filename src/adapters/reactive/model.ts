import type { Capability, ReactiveFramework } from './capabilities.js';
import { capabilities } from './capabilities.js';

/** Graph kinds. A Store method stays a `call`, patchState a `state-write`, a derived value a `reactive-link`. */
export type ReactiveStepKind = 'call' | 'state-read' | 'state-write' | 'reactive-link' | 'effect' |
  'action-dispatch' | 'action-consume' | 'event-dispatch' | 'event-consume' | 'boundary';
/** How the read was taken. Only a tracked read creates a re-execution dependency. */
export type ReadTracking = 'tracked' | 'snapshot' | 'untracked';
/** When the effect body runs. A generated effect is not a consequence of every UI operation. */
export type EffectPhase = 'immediate' | 'change-detection' | 'after-render' | 'state-watcher' | 'subscription';
/** The two delivery systems stay separate: the same `{type, payload}` does not reach both. */
export type DeliveryBus = 'ngrx-action' | 'signal-store-event';
export type DeliveryScope = 'self' | 'parent' | 'global' | 'root';
export type DispatchForm = 'action-instance' | 'reactive-registration' | 'observer-next' | 'effect-return' |
  'named-event' | 'direct-event' | 'handler-redelivery';

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

const stepKinds = new Set<ReactiveStepKind>(['call', 'state-read', 'state-write', 'reactive-link', 'effect',
  'action-dispatch', 'action-consume', 'event-dispatch', 'event-consume', 'boundary']);
/** Semantics that name a declaration rather than a step; they never become an effect node on their own. */
const declarationSemantics = new Set(['state-source', 'store-declaration', 'store-feature', 'action-creator',
  'event-creator', 'registration']);

export function semanticGroup(semanticId: string): string { return semanticId.split(':')[0] ?? semanticId; }
/** Derives the graph kind from the registered semantic model instead of a per-call-site decision. */
export function stepKindFor(semanticId: string): ReactiveStepKind | null {
  const group = semanticGroup(semanticId);
  if (declarationSemantics.has(group)) return null;
  return stepKinds.has(group as ReactiveStepKind) ? group as ReactiveStepKind : null;
}
export function stepKindForCapability(capability: Capability): ReactiveStepKind | null {
  return capability.semanticId ? stepKindFor(capability.semanticId) : null;
}
/** A generated Store member keeps its own kind; none of them becomes an effect node. */
export type StoreMemberKind = 'state' | 'linked-state' | 'computed' | 'prop' | 'method' | 'hook' | 'handler';
export function storeMemberStepKind(kind: StoreMemberKind): ReactiveStepKind | null {
  switch (kind) {
    case 'method': return 'call';
    case 'computed': case 'linked-state': return 'reactive-link';
    case 'state': return 'state-read';
    case 'handler': return 'event-consume';
    // A `withProps` member is a plain value and a hook is a lifetime condition, not a step of its own.
    case 'prop': case 'hook': return null;
  }
}
/** Every supported semantic model must be either a known step kind or an explicit declaration group. */
export function modelAudit(): string[] {
  const problems: string[] = [];
  for (const capability of capabilities()) {
    if (capability.support !== 'supported') {
      if (capability.semanticId) problems.push(`${capability.matcherId} is unsupported but carries a semantic model`);
      continue;
    }
    if (!capability.semanticId) { problems.push(`${capability.matcherId} has no semantic model`); continue; }
    const group = semanticGroup(capability.semanticId);
    if (!declarationSemantics.has(group) && !stepKinds.has(group as ReactiveStepKind))
      problems.push(`${capability.matcherId} uses unknown semantic group ${group}`);
  }
  return problems;
}
