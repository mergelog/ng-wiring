import { type Condition, type DetailField, type EdgeKind } from '../model/types.js';
/**
 * §8 the closed sentence table. It shares its slots with `edgeContracts`, so a kind that is added to
 * the model without a sentence here becomes a render error rather than free prose.
 */
export declare const sentenceTemplates: Readonly<Record<EdgeKind, string>>;
/** The detail names one sentence prints, in the order §8 writes them. */
export declare const sentenceSlots: (kind: EdgeKind) => string[];
/**
 * §8 every slot a sentence prints has to be a required detail of that kind. The reverse does not hold:
 * `template-use` also carries the occurrence id, which the table uses as a reference and not as prose.
 */
export declare function sentenceSlotProblems(): string[];
/** §8 `in/process/out/state/service/relation` group the document only; they are never analysis kinds. */
export declare const displayGroups: readonly ["in", "process", "out", "state", "service", "relation"];
export type DisplayGroup = typeof displayGroups[number];
export declare const displayGroupLabels: Readonly<Record<DisplayGroup, string>>;
export declare const displayGroupOf: Readonly<Record<EdgeKind, DisplayGroup>>;
/**
 * §8 `state` and `service` also exist as node kinds, so the two vocabularies must not be mixed up: the
 * sentence table is keyed by edge kind alone, the document prints the group as its own label beside the
 * raw kind, and no group name may become an edge kind.
 */
export declare function displayGroupProblems(): string[];
export interface Sentence {
    text: string;
    unresolved: string[];
}
/**
 * §8 renders one relation from the closed table. An unknown kind or a missing required detail stops the
 * render instead of producing prose the model does not support (§8, P14-05).
 */
export declare function renderSentence(kind: EdgeKind, details: Record<string, DetailField>): Sentence;
/**
 * §8 conditions are shown mechanically from the recorded expression and phase. Nothing is reworded into
 * a new causal claim, so an unevaluated predicate is printed as the expression it came from.
 */
export declare function renderCondition(conditions: ReadonlyMap<string, Condition>, id: string | null, depth?: number): string | null;
