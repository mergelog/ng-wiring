import type { ConditionBody, EdgeKind, Evidence, OccurrenceKey, Severity } from './types.js';
export declare const slash: (value: string) => string;
/** §5 `ComponentId = workspace relative TS path#ClassName`; symbol ids extend it with `.member`. */
export declare const definitionId: (symbolId: string) => string;
export declare function normalizeOccurrence(key: OccurrenceKey): OccurrenceKey;
/** The id carries the identity of the use site only; it never stands for a count of runtime instances. */
export declare const occurrenceId: (key: OccurrenceKey) => string;
export declare const boundaryId: (contextId: string, reason: string, lastConfirmed: string) => string;
export declare const evidenceId: (evidence: Omit<Evidence, "id">) => string;
/** Evidence ids take part so that two call sites of the same relation never collapse into one edge (§8). */
export declare const edgeId: (edge: {
    contextId: string;
    from: string;
    to: string;
    kind: EdgeKind;
    evidenceIds: readonly string[];
    conditionId: string | null;
}) => string;
export declare const conditionId: (body: ConditionBody) => string;
export declare const pathId: (path: {
    occurrenceIds: readonly string[];
    edgeIds: readonly string[];
}) => string;
export declare const operationId: (operation: {
    event: string;
    eventId: string;
    listenerId: string;
}) => string;
export declare const diagnosticId: (diagnostic: {
    code: string;
    message: string;
    severity: Severity;
    evidenceIds: readonly string[];
    relatedIds: readonly string[];
}) => string;
export declare const gapId: (gap: {
    code: string;
    message: string;
    owner: string | null;
    evidenceIds: readonly string[];
}) => string;
