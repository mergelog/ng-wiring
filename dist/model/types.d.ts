import type { CandidateClass } from '../cli/candidates.js';
/** §5 intermediate model. Both renderers read this normalized shape and nothing else. */
export declare const SCHEMA_VERSION = "1.0.0";
export type NodeKind = 'application' | 'component' | 'directive' | 'pipe' | 'element' | 'template' | 'route' | 'listener' | 'symbol' | 'operation' | 'state' | 'action' | 'event' | 'event-bus' | 'effect' | 'service' | 'http' | 'type' | 'boundary';
/** Definitions and the places that use them stay separate nodes (§5). */
export type NodeRole = 'definition' | 'occurrence' | 'boundary';
export type EdgeKind = 'template-use' | 'display-parent' | 'projection' | 'view-insertion' | 'route-load' | 'route-outlet' | 'route-redirect' | 'bootstrap' | 'dynamic-create' | 'dom-listener' | 'event-propagation' | 'input-binding' | 'output-subscription' | 'output-emit' | 'call' | 'value-flow' | 'state-write' | 'state-read' | 'reactive-link' | 'query-target' | 'di-resolve' | 'action-dispatch' | 'action-consume' | 'event-dispatch' | 'event-consume' | 'http-create' | 'http-consume' | 'type-use' | 'boundary';
export type EdgeOrigin = 'ngmaze' | 'ngmaze-verified' | 'ng-wiring';
export type Confidence = 'confirmed' | 'conditional' | 'unresolved';
export type Coverage = 'complete-within-scope' | 'partial';
export type Precision = 'exact' | 'approximate';
export type Severity = 'info' | 'warning' | 'error';
export type ConditionPhase = 'lifecycle' | 'defer' | 'subscription' | 'route-activation';
export type DispatchMode = 'explicit' | 'reactive-factory' | 'named-dispatcher' | 'automatic-output';
export type GapRelation = 'related' | 'global-unknown' | 'unrelated';
export type PathEnd = 'root-unresolved' | 'unrendered' | 'projection-unresolved' | 'fragment-uninstantiated' | 'dynamic-boundary' | 'route-unresolved' | 'bootstrap' | 'cycle' | 'limit';
export type { CandidateClass };
export declare const nodeKinds: readonly NodeKind[];
export declare const confidences: readonly Confidence[];
export declare const conditionPhases: readonly ConditionPhase[];
export declare const dispatchModes: readonly DispatchMode[];
export declare const pathEnds: readonly PathEnd[];
/** §5 coverage is partial when the path stopped before a root or was cut off; `unrendered` is a complete answer. */
export declare const partialPathEnds: readonly PathEnd[];
/** §8 a detail is either a known value or null with the reason it stayed unknown. */
export interface DetailField {
    value: string | null;
    unresolvedReason: string | null;
}
export declare const detail: (value: string) => DetailField;
export declare const unresolvedDetail: (reason: string) => DetailField;
export interface EdgeContract {
    from: readonly NodeKind[];
    to: readonly NodeKind[];
    details: readonly string[];
}
/** §8 the closed relation table: required details plus the node kinds each end accepts. */
export declare const edgeContracts: Readonly<Record<EdgeKind, EdgeContract>>;
export declare const edgeKinds: readonly EdgeKind[];
export interface Evidence {
    id: string;
    file: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    precision: Precision;
    symbolId: string | null;
    contentHash: string;
}
export interface EvidenceSpan {
    file: string;
    start: number;
    end: number;
}
/** §5 an occurrence is identified by context, owner, use span and its insertion/projection/route setting. */
export interface OccurrenceKey {
    contextId: string;
    ownerId: string;
    definitionId: string | null;
    span: EvidenceSpan | null;
    insertion: string | null;
    projection: string | null;
    route: string | null;
}
export interface ModelNode {
    id: string;
    kind: NodeKind;
    role: NodeRole;
    contextId: string;
    definitionId: string | null;
    occurrence: OccurrenceKey | null;
    evidenceIds: string[];
    details: Record<string, DetailField>;
}
export interface ModelEdge {
    id: string;
    from: string;
    to: string;
    kind: EdgeKind;
    evidenceIds: string[];
    conditionId: string | null;
    confidence: Confidence;
    origin: EdgeOrigin;
    contextId: string;
    details: Record<string, DetailField>;
}
export type Condition = {
    id: string;
    kind: 'true';
} | {
    id: string;
    kind: 'false';
    reason: string;
} | {
    id: string;
    kind: 'predicate';
    expression: string;
    scope: string;
    evidenceId: string;
} | {
    id: string;
    kind: 'all' | 'any' | 'not';
    operandIds: string[];
} | {
    id: string;
    kind: 'phase';
    phase: ConditionPhase;
    detail: string | null;
    evidenceId: string | null;
};
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type ConditionBody = WithoutId<Condition>;
export interface ModelPath {
    id: string;
    occurrenceIds: string[];
    edgeIds: string[];
    declarationIds: string[];
    end: PathEnd;
    endReason: string;
    confidence: Confidence;
    coverage: Coverage;
    coverageReasons: string[];
}
export interface ModelOperation {
    id: string;
    event: string;
    eventId: string;
    listenerId: string;
    nodeIds: string[];
    edgeIds: string[];
    confidence: Confidence;
    coverage: Coverage;
    coverageReasons: string[];
}
export interface ModelDiagnostic {
    id: string;
    code: string;
    severity: Severity;
    message: string;
    evidenceIds: string[];
    relatedIds: string[];
    stopReason: string | null;
}
/** §8 gap relation is assigned by the diagnostic association step; the model only carries it. */
export interface CoverageGap {
    id: string;
    code: string;
    message: string;
    relation: GapRelation;
    owner: string | null;
    candidates: string[];
    evidenceIds: string[];
    resolvedBy: string | null;
    resolvedReason: string | null;
}
export interface CoverageReport {
    overall: Coverage;
    paths: Coverage;
    reasons: string[];
    events: {
        event: string;
        operationId: string;
        coverage: Coverage;
    }[];
    gaps: CoverageGap[];
    gapCounts: {
        code: string;
        count: number;
    }[];
}
export interface LimitReport {
    name: string;
    limit: number;
    stops: number;
    unexplored: number;
}
export interface Truncation {
    limit: string;
    reason: string;
    nodeId: string | null;
    edgeId: string | null;
    evidenceIds: string[];
}
export interface LimitsReport {
    applied: LimitReport[];
    truncations: Truncation[];
}
export interface ReportContext {
    id: string;
    workspaceRoot: string;
    projectName: string | null;
    projectType: 'application' | 'library' | 'explicit';
    tsconfig: string;
    configHash: string;
    strictNullChecks?: boolean;
    toolchain: {
        typescript: string;
        angularCompiler: string;
        ngmaze: string;
    };
    entry: string[];
    entryUnknown: boolean;
    excluded: string[];
    unapplied: string[];
}
export type QueryTarget = {
    kind: 'attribute';
    name: string;
    value: string;
} | {
    kind: 'source';
    file: string;
    line: number;
};
export interface CandidateSummary {
    id: string;
    contextId: string;
    class: CandidateClass;
    ownerId: string;
    element: EvidenceSpan;
    routePattern: string | null;
    events: string[];
    partialReasons: string[];
}
export interface ReportQuery {
    raw: string;
    target: QueryTarget;
    filters: {
        project: string | null;
        tsconfig: string | null;
        through: string | null;
        route: string | null;
        selector?: string;
        candidate: string | null;
        event: string | null;
    };
    candidates: CandidateSummary[];
    enumerationComplete: boolean;
}
export interface ReportSelection {
    candidateId: string;
    contextId: string;
    ownerId: string;
    targetNodeId: string;
    element: EvidenceSpan & {
        evidenceId: string;
    };
    routeIds: string[];
    bootstrapId: string | null;
    events: string[];
}
export interface WiringReport {
    schemaVersion: string;
    toolVersion: string;
    status: Coverage;
    generatedAt: string;
    snapshotId: string;
    context: ReportContext;
    query: ReportQuery;
    selection: ReportSelection;
    nodes: ModelNode[];
    edges: ModelEdge[];
    evidence: Evidence[];
    conditions: Condition[];
    paths: ModelPath[];
    operations: ModelOperation[];
    diagnostics: ModelDiagnostic[];
    coverage: CoverageReport;
    limits: LimitsReport;
}
