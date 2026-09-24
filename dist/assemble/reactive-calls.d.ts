import type { AnalysisContext } from '../workspace/context.js';
import type { IndexedElement } from '../index/templates.js';
/** One `patchState(store, …)` call: where it is, the member that holds it, and the keys it replaces. */
export interface PatchStateCall {
    location: string;
    member: string | null;
    keys: string[];
}
/**
 * §7.6 `patchState` is the SignalStore write. The NgRx trace stops at it because it is an imported
 * function, so the assembly resolves it through the capability registry instead of by its name.
 */
export declare function findPatchStateCalls(context: AnalysisContext): PatchStateCall[];
/** A member read written in a template, with the receiver member when it is read through one. */
export interface TemplateRead {
    member: string;
    receiver: string | null;
}
/**
 * §7.3 the reads an element's own template expressions perform. A SignalStore state value is read as
 * `store.key()`, so the receiver member is kept and resolved by the caller against the injected Store.
 */
export declare function templateReads(element: IndexedElement, context: AnalysisContext): TemplateRead[];
