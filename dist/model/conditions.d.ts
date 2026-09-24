import type { Condition, ConditionPhase, Confidence, Coverage } from './types.js';
/**
 * §5 condition tree. An expression the analyzer cannot evaluate stays a `predicate`; only a branch
 * that was proven unreachable becomes `false`, and that proof is recorded as its reason.
 */
export declare class ConditionTable {
    private readonly byId;
    private intern;
    always(): string;
    never(reason: string): string;
    predicate(input: {
        expression: string;
        scope: string;
        evidenceId: string;
    }): string;
    phase(input: {
        phase: ConditionPhase;
        detail?: string | null;
        evidenceId?: string | null;
    }): string;
    all(operandIds: readonly string[]): string;
    any(operandIds: readonly string[]): string;
    not(operandId: string): string;
    private combine;
    get(id: string): Condition | undefined;
    list(): Condition[];
}
/** True only for branches proven unreachable; an unevaluated predicate returns false here (§5). */
export declare function isProvenFalse(conditions: ReadonlyMap<string, Condition> | ConditionTable, id: string | null): boolean;
/** §5 a single path takes the weakest value of its edges. */
export declare function weakestConfidence(values: Iterable<Confidence>): Confidence;
/** §5 a heading over several branches shows the weakest value and keeps each branch value. */
export declare function branchSummary<T extends {
    id: string;
    confidence: Confidence;
}>(branches: readonly T[]): {
    confidence: Confidence;
    branches: {
        id: string;
        confidence: Confidence;
    }[];
};
/** §5 coverage is aggregated per scope and stays independent of confidence. */
export declare function combineCoverage(values: Iterable<Coverage>): Coverage;
