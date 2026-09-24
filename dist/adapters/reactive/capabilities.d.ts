import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
/** The reactive systems are kept apart: a shared shape never implies a shared bus or state source. */
export type ReactiveFramework = 'angular-signal' | 'signal-state' | 'signal-store' | 'ngrx-store';
export type CapabilitySupport = 'supported' | 'unsupported';
/** `invoke` is calling the produced value itself (a signal read); `option` is a configuration property. */
export type CapabilityForm = 'function' | 'member' | 'invoke' | 'class' | 'option' | 'module';
export interface Capability {
    matcherId: string;
    semanticId: string | null;
    contracts: string[];
    module: string;
    export: string | null;
    member: string | null;
    form: CapabilityForm;
    framework: ReactiveFramework | null;
    support: CapabilitySupport;
    note: string | null;
}
/** Versions the semantic models were read against; other versions are an R16 diagnostic, not a silent pass. */
export declare const SUPPORTED_PACKAGE_VERSIONS: Readonly<Record<string, string>>;
export declare function capabilities(): readonly Capability[];
export declare function capabilityById(matcherId: string): Capability | undefined;
export declare function capabilitiesForContract(contract: string): Capability[];
export declare const CONTRACT_IDS: readonly string[];
/** Maps a declaration file back to the specifier that publishes it, so subpaths stay distinct. */
export declare function moduleIdForFile(context: AnalysisContext, fileName: string): string | null;
export interface CapabilityMatch {
    capability: Capability;
    module: string;
    export: string;
    member: string | null;
}
/** Resolves an identifier through import aliases and re-exports before consulting the registry. */
export declare function matchIdentifier(context: AnalysisContext, node: ts.Node, forms?: CapabilityForm[]): CapabilityMatch | null;
/** Resolves the receiver's declared class, so `dispatch` on an unrelated object never matches. */
export declare function matchMember(context: AnalysisContext, receiver: ts.Expression, member: string): CapabilityMatch | null;
export interface UnsupportedUse {
    capability: Capability;
    module: string;
    specifier: string;
    location: ts.Node;
}
/** Reports imports of ranges with no semantic model; the caller turns these into R16 diagnostics. */
export declare function unsupportedImports(context: AnalysisContext, file: ts.SourceFile): UnsupportedUse[];
export interface CapabilityAudit {
    matcherId: string;
    problem: string;
}
/** Checks the registry against the installed packages so a renamed or removed export cannot pass unnoticed. */
export declare function auditCapabilities(context: AnalysisContext): CapabilityAudit[];
