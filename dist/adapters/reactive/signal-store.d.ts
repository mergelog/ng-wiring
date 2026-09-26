import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { StoreMemberKind } from './model.js';
export type { StoreMemberKind };
export interface StoreMember {
    name: string;
    kind: StoreMemberKind;
    featureIndex: number;
    capability: string;
    source: string;
    /** Tracked state keys read while a computed or linked-state member is evaluated. */
    dependencies: string[];
    /** Set when a later feature declares the same name; the earlier member is no longer reachable. */
    shadows: string | null;
}
export interface StoreFeature {
    index: number;
    /** The registry matcher, or null when the feature could not be identified. */
    capability: string | null;
    label: string;
    source: string;
    status: 'resolved' | 'boundary';
    reason: string | null;
}
export interface StoreHook {
    kind: 'onInit' | 'onDestroy';
    source: string;
    featureIndex: number;
}
export interface SignalStoreDeclaration {
    id: string;
    name: string;
    /** `variable` is the generated class assigned to a name; `class-extends` subclasses it. */
    kind: 'variable' | 'class-extends';
    source: string;
    features: StoreFeature[];
    members: StoreMember[];
    stateKeys: string[];
    hooks: StoreHook[];
    /** `partial` means an unidentified feature may add or replace members in this Store. */
    status: 'resolved' | 'partial';
    gaps: string[];
}
export interface SignalStoreInstance {
    id: string;
    declarationId: string;
    kind: 'inject' | 'new' | 'provider';
    owner: string | null;
    source: string;
    /** A provider alone does not construct the Store; only a confirmed inject or new does. */
    created: boolean;
    conditions: string[];
}
export interface SignalStoreCatalog {
    declarations: Map<string, SignalStoreDeclaration>;
    instances: SignalStoreInstance[];
    diagnostics: string[];
}
/** Finds generated Store classes, then the sites that actually construct them. */
export declare function catalogSignalStores(context: AnalysisContext): SignalStoreCatalog;
export type StoreReferenceKind = 'instance' | 'construction-context';
export interface StoreReference {
    kind: StoreReferenceKind;
    declarationId: string;
    instanceId: string | null;
    /** Set when the name was destructured out of the Store rather than naming the Store itself. */
    member: string | null;
    source: string;
}
/** Maps a destructured signal or a captured Store name back to the instance or Store it came from. */
export declare function resolveStoreReference(context: AnalysisContext, catalog: SignalStoreCatalog, node: ts.Node): StoreReference | null;
export interface StoreLifetime {
    declarationId: string;
    instanceId: string | null;
    created: boolean;
    start: string[];
    end: string[];
    conditions: string[];
}
/** onInit is a start condition and onDestroy an end condition; neither is a result of a UI operation. */
export declare function storeLifetime(catalog: SignalStoreCatalog, declarationId: string, instanceId?: string | null): StoreLifetime;
