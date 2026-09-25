import type { CandidateClass } from '../cli/candidates.js';

/** §5 intermediate model. Both renderers read this normalized shape and nothing else. */
export const SCHEMA_VERSION = '1.0.0';

export type NodeKind = 'application' | 'component' | 'directive' | 'pipe' | 'element' | 'template' | 'route' |
  'listener' | 'symbol' | 'operation' | 'state' | 'action' | 'event' | 'event-bus' | 'effect' | 'service' |
  'http' | 'type' | 'boundary';
/** Definitions and the places that use them stay separate nodes (§5). */
export type NodeRole = 'definition' | 'occurrence' | 'boundary';
export type EdgeKind = 'template-use' | 'display-parent' | 'projection' | 'view-insertion' | 'route-load' |
  'route-outlet' | 'route-redirect' | 'bootstrap' | 'dynamic-create' | 'dom-listener' | 'event-propagation' |
  'input-binding' | 'output-subscription' | 'output-emit' | 'call' | 'value-flow' | 'state-write' | 'state-read' |
  'reactive-link' | 'query-target' | 'di-resolve' | 'action-dispatch' | 'action-consume' | 'event-dispatch' |
  'event-consume' | 'http-create' | 'http-consume' | 'type-use' | 'boundary';
export type EdgeOrigin = 'ngmaze' | 'ngmaze-verified' | 'ng-wiring';
export type Confidence = 'confirmed' | 'conditional' | 'unresolved';
export type Coverage = 'complete-within-scope' | 'partial';
export type Precision = 'exact' | 'approximate';
export type Severity = 'info' | 'warning' | 'error';
export type ConditionPhase = 'lifecycle' | 'defer' | 'subscription' | 'route-activation';
export type DispatchMode = 'explicit' | 'reactive-factory' | 'named-dispatcher' | 'automatic-output';
export type GapRelation = 'related' | 'global-unknown' | 'unrelated';
export type PathEnd = 'root-unresolved' | 'unrendered' | 'projection-unresolved' | 'fragment-uninstantiated' |
  'dynamic-boundary' | 'route-unresolved' | 'bootstrap' | 'cycle' | 'limit';
export type { CandidateClass };

export const nodeKinds: readonly NodeKind[] = ['application', 'component', 'directive', 'pipe', 'element',
  'template', 'route', 'listener', 'symbol', 'operation', 'state', 'action', 'event', 'event-bus', 'effect',
  'service', 'http', 'type', 'boundary'];
export const confidences: readonly Confidence[] = ['confirmed', 'conditional', 'unresolved'];
export const conditionPhases: readonly ConditionPhase[] = ['lifecycle', 'defer', 'subscription', 'route-activation'];
export const dispatchModes: readonly DispatchMode[] = ['explicit', 'reactive-factory', 'named-dispatcher', 'automatic-output'];
export const pathEnds: readonly PathEnd[] = ['root-unresolved', 'unrendered', 'projection-unresolved',
  'fragment-uninstantiated', 'dynamic-boundary', 'route-unresolved', 'bootstrap', 'cycle', 'limit'];
/** §5 coverage is partial when the path stopped before a root or was cut off; `unrendered` is a complete answer. */
export const partialPathEnds: readonly PathEnd[] = ['root-unresolved', 'projection-unresolved',
  'fragment-uninstantiated', 'dynamic-boundary', 'route-unresolved', 'cycle', 'limit'];

/** §8 a detail is either a known value or null with the reason it stayed unknown. */
export interface DetailField { value: string | null; unresolvedReason: string | null }
export const detail = (value: string): DetailField => ({ value, unresolvedReason: null });
export const unresolvedDetail = (reason: string): DetailField => ({ value: null, unresolvedReason: reason });

export interface EdgeContract { from: readonly NodeKind[]; to: readonly NodeKind[]; details: readonly string[] }
const holder: readonly NodeKind[] = ['component', 'directive', 'element', 'template', 'symbol', 'operation', 'listener', 'effect', 'service'];
const producer: readonly NodeKind[] = ['symbol', 'operation', 'listener', 'effect', 'service', 'component', 'directive', 'state'];
/** §8 the closed relation table: required details plus the node kinds each end accepts. */
export const edgeContracts: Readonly<Record<EdgeKind, EdgeContract>> = {
  'template-use': { from: ['component'], to: ['component', 'directive', 'pipe', 'element', 'template'], details: ['owner', 'child', 'occurrence', 'location'] },
  'display-parent': { from: ['component', 'element', 'template', 'application'], to: ['component', 'element', 'template'], details: ['parent', 'child'] },
  projection: { from: ['component', 'element'], to: ['component', 'directive', 'element', 'template'], details: ['child', 'host', 'slot'] },
  'view-insertion': { from: ['template'], to: ['component', 'directive', 'element', 'template'], details: ['fragment', 'declarer', 'insertion'] },
  'route-load': { from: ['route'], to: ['route'], details: ['sourceRoute', 'targetRoute', 'loader'] },
  'route-outlet': { from: ['route'], to: ['component', 'element'], details: ['route', 'component', 'outlet'] },
  'route-redirect': { from: ['route'], to: ['route'], details: ['route', 'destination'] },
  bootstrap: { from: ['application'], to: ['component'], details: ['application', 'component'] },
  'dynamic-create': { from: ['component', 'directive', 'service', 'symbol', 'operation'], to: ['component', 'directive', 'template'], details: ['caller', 'component', 'container'] },
  'dom-listener': { from: ['element', 'component', 'directive'], to: ['listener'], details: ['event', 'selected', 'listener', 'handler'] },
  'event-propagation': { from: ['element', 'component'], to: ['element', 'component'], details: ['event', 'fromElement', 'toElement', 'phase'] },
  'input-binding': { from: ['component', 'element', 'template'], to: ['component', 'directive', 'symbol'], details: ['expression', 'owner', 'input'] },
  'output-subscription': { from: ['component', 'directive', 'element', 'symbol', 'event'], to: ['component', 'listener', 'symbol', 'operation'], details: ['output', 'subscriber'] },
  'output-emit': { from: producer, to: ['event', 'symbol'], details: ['output', 'valueExpression', 'declaredType'] },
  call: { from: producer, to: ['symbol', 'operation', 'service', 'effect'], details: ['caller', 'callee', 'arguments'] },
  'value-flow': { from: ['symbol', 'operation', 'state', 'http', 'event', 'action'], to: ['symbol', 'operation', 'state', 'http', 'element', 'component'], details: ['valueExpression', 'destination'] },
  'state-write': { from: producer, to: ['state'], details: ['writer', 'state', 'valueExpression'] },
  'state-read': { from: ['state'], to: holder, details: ['reader', 'state', 'tracking'] },
  'reactive-link': { from: ['state', 'symbol', 'operation', 'event', 'action', 'http'], to: ['symbol', 'operation', 'state', 'effect', 'component'], details: ['source', 'operator', 'consumer', 'scheduling'] },
  'query-target': { from: ['symbol'], to: ['component', 'directive', 'element', 'template'], details: ['query', 'target', 'scope'] },
  'di-resolve': { from: ['symbol', 'service', 'type'], to: ['service', 'symbol', 'component', 'directive'], details: ['token', 'implementation', 'provider'] },
  'action-dispatch': { from: producer, to: ['action', 'event-bus'], details: ['caller', 'action', 'busId', 'dispatchMode'] },
  'action-consume': { from: ['action', 'event-bus'], to: ['effect', 'state', 'symbol', 'operation', 'service'], details: ['action', 'consumer', 'busId', 'registration'] },
  'event-dispatch': { from: producer, to: ['event', 'event-bus'], details: ['caller', 'event', 'busId', 'scope', 'dispatchMode'] },
  'event-consume': { from: ['event', 'event-bus'], to: ['effect', 'state', 'symbol', 'operation', 'service'], details: ['event', 'consumer', 'busId', 'registration'] },
  'http-create': { from: ['symbol', 'operation', 'service', 'effect'], to: ['http'], details: ['method', 'urlExpression', 'requestType', 'responseType'] },
  'http-consume': { from: ['http'], to: ['symbol', 'operation', 'effect', 'state', 'component', 'service'], details: ['request', 'consumer'] },
  'type-use': { from: ['symbol', 'operation', 'state', 'http', 'action', 'event', 'component', 'service'], to: ['type'], details: ['value', 'type', 'role'] },
  boundary: { from: nodeKinds.filter(kind => kind !== 'boundary'), to: ['boundary'], details: ['reason', 'lastConfirmed'] },
};
export const edgeKinds = Object.keys(edgeContracts) as readonly EdgeKind[];

export interface Evidence {
  id: string; file: string;
  startOffset: number; endOffset: number;
  startLine: number; startColumn: number; endLine: number; endColumn: number;
  precision: Precision; symbolId: string | null; contentHash: string;
}

export interface EvidenceSpan { file: string; start: number; end: number }
/** §5 an occurrence is identified by context, owner, use span and its insertion/projection/route setting. */
export interface OccurrenceKey {
  contextId: string; ownerId: string; definitionId: string | null; span: EvidenceSpan | null;
  insertion: string | null; projection: string | null; route: string | null;
}

export interface ModelNode {
  id: string; kind: NodeKind; role: NodeRole; contextId: string;
  definitionId: string | null; occurrence: OccurrenceKey | null;
  evidenceIds: string[]; details: Record<string, DetailField>;
}

export interface ModelEdge {
  id: string; from: string; to: string; kind: EdgeKind;
  evidenceIds: string[]; conditionId: string | null; confidence: Confidence;
  origin: EdgeOrigin; contextId: string; details: Record<string, DetailField>;
}

export type Condition =
  | { id: string; kind: 'true' }
  | { id: string; kind: 'false'; reason: string }
  | { id: string; kind: 'predicate'; expression: string; scope: string; evidenceId: string }
  | { id: string; kind: 'all' | 'any' | 'not'; operandIds: string[] }
  | { id: string; kind: 'phase'; phase: ConditionPhase; detail: string | null; evidenceId: string | null };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type ConditionBody = WithoutId<Condition>;

export interface ModelPath {
  id: string; occurrenceIds: string[]; edgeIds: string[]; declarationIds: string[];
  end: PathEnd; endReason: string; confidence: Confidence; coverage: Coverage; coverageReasons: string[];
}

export interface ModelOperation {
  id: string; event: string; eventId: string; listenerId: string;
  nodeIds: string[]; edgeIds: string[];
  confidence: Confidence; coverage: Coverage; coverageReasons: string[];
}

export interface ModelDiagnostic {
  id: string; code: string; severity: Severity; message: string;
  evidenceIds: string[]; relatedIds: string[]; stopReason: string | null;
}

/** §8 gap relation is assigned by the diagnostic association step; the model only carries it. */
export interface CoverageGap {
  id: string; code: string; message: string; relation: GapRelation;
  owner: string | null; candidates: string[]; evidenceIds: string[];
  resolvedBy: string | null; resolvedReason: string | null;
}

export interface CoverageReport {
  overall: Coverage; paths: Coverage; reasons: string[];
  events: { event: string; operationId: string; coverage: Coverage }[];
  gaps: CoverageGap[]; gapCounts: { code: string; count: number }[];
}

export interface LimitReport { name: string; limit: number; stops: number; unexplored: number }
export interface Truncation { limit: string; reason: string; nodeId: string | null; edgeId: string | null; evidenceIds: string[] }
export interface LimitsReport { applied: LimitReport[]; truncations: Truncation[] }

export interface ReportContext {
  id: string; workspaceRoot: string; projectName: string | null;
  projectType: 'application' | 'library' | 'explicit';
  tsconfig: string; configHash: string; strictNullChecks?: boolean;
  toolchain: { typescript: string; angularCompiler: string; ngmaze: string };
  entry: string[]; entryUnknown: boolean; excluded: string[]; unapplied: string[];
}

export type QueryTarget =
  | { kind: 'attribute'; name: string; value: string }
  | { kind: 'source'; file: string; line: number };

export interface CandidateSummary {
  id: string; contextId: string; class: CandidateClass; ownerId: string;
  element: EvidenceSpan; routePattern: string | null; events: string[]; partialReasons: string[];
}

export interface ReportQuery {
  raw: string; target: QueryTarget;
  filters: { project: string | null; tsconfig: string | null; through: string | null;
    route: string | null; candidate: string | null; event: string | null };
  candidates: CandidateSummary[]; enumerationComplete: boolean;
}

export interface ReportSelection {
  candidateId: string; contextId: string; ownerId: string; targetNodeId: string;
  element: EvidenceSpan & { evidenceId: string };
  routeIds: string[]; bootstrapId: string | null; events: string[];
}

export interface WiringReport {
  schemaVersion: string; toolVersion: string; status: Coverage;
  generatedAt: string; snapshotId: string;
  context: ReportContext; query: ReportQuery; selection: ReportSelection;
  nodes: ModelNode[]; edges: ModelEdge[]; evidence: Evidence[]; conditions: Condition[];
  paths: ModelPath[]; operations: ModelOperation[];
  diagnostics: ModelDiagnostic[]; coverage: CoverageReport; limits: LimitsReport;
}
