import { ConditionTable, combineCoverage, weakestConfidence } from './conditions.js';
import { ModelError, type EvidenceTable } from './evidence.js';
import { activeGaps, placeGaps, strongestRelation, type GapScope, type RawGap } from './gaps.js';
import { boundaryId, definitionId, diagnosticId, edgeId, gapId, normalizeOccurrence, occurrenceId, operationId, pathId, slash } from './ids.js';
import { SCHEMA_VERSION, partialPathEnds, type Confidence, type Coverage, type CoverageGap, type DetailField,
  type EdgeKind, type EdgeOrigin, type GapRelation, type LimitsReport, type ModelDiagnostic, type ModelEdge,
  type ModelNode, type ModelOperation, type ModelPath, type NodeKind, type OccurrenceKey, type PathEnd,
  type ReportContext, type ReportQuery, type ReportSelection, type Severity, type WiringReport } from './types.js';

export interface ReportBuilderInput {
  toolVersion: string; snapshotId: string; generatedAt: string;
  context: ReportContext; query: ReportQuery;
  evidence: EvidenceTable; conditions?: ConditionTable;
}

const byId = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** §3.4-4 the local analysis time with its UTC offset, as the report and the file name both need it. */
export function localIsoString(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, '0');
  const zone = offset === 0 ? 'Z' : `${offset < 0 ? '-' : '+'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${zone}`;
}

interface RawPath { id: string; occurrenceIds: string[]; edgeIds: string[]; declarationIds: string[];
  end: PathEnd; endReason: string; coverageReasons: string[] }
interface RawOperation { id: string; event: string; eventId: string; listenerId: string;
  nodeIds: string[]; edgeIds: string[]; coverageReasons: string[] }

/**
 * §5 the single place where the analysis result is normalized. Markdown and JSON are both rendered from
 * the `WiringReport` this produces, so neither renderer re-derives confidence, coverage or ids.
 */
export class ReportBuilder {
  readonly evidence: EvidenceTable;
  readonly conditions: ConditionTable;
  private readonly contextId: string;
  private readonly nodes = new Map<string, ModelNode>();
  private readonly edges = new Map<string, ModelEdge>();
  private readonly diagnostics = new Map<string, ModelDiagnostic>();
  private readonly gaps = new Map<string, CoverageGap>();
  private readonly paths: RawPath[] = [];
  private readonly operations: RawOperation[] = [];
  private limitsReport: LimitsReport = { applied: [], truncations: [] };
  private selection: ReportSelection | null = null;

  constructor(private readonly input: ReportBuilderInput) {
    this.evidence = input.evidence;
    this.conditions = input.conditions ?? new ConditionTable();
    this.contextId = input.context.id;
  }

  private put(node: ModelNode): string {
    const existing = this.nodes.get(node.id);
    if (!existing) { this.nodes.set(node.id, node); return node.id; }
    if (existing.kind !== node.kind || existing.role !== node.role) {
      throw new ModelError(`Node ${node.id} was already recorded as ${existing.role} ${existing.kind}`);
    }
    existing.evidenceIds = unique([...existing.evidenceIds, ...node.evidenceIds]);
    for (const [key, value] of Object.entries(node.details)) existing.details[key] ??= value;
    return node.id;
  }

  /** A declaration site: the class, symbol, route or type itself, independent of where it is used. */
  definition(input: { kind: NodeKind; symbolId: string; evidenceIds: readonly string[];
    details?: Record<string, DetailField> }): string {
    return this.put({ id: definitionId(input.symbolId), kind: input.kind, role: 'definition',
      contextId: this.contextId, definitionId: null, occurrence: null,
      evidenceIds: unique([...input.evidenceIds]), details: { ...input.details } });
  }

  /** A use site. The key keeps the owner, span and insertion/projection/route setting apart (§5). */
  occurrence(input: { kind: NodeKind; key: Omit<OccurrenceKey, 'contextId'>; evidenceIds: readonly string[];
    details?: Record<string, DetailField> }): string {
    const key = normalizeOccurrence({ ...input.key, contextId: this.contextId });
    return this.put({ id: occurrenceId(key), kind: input.kind, role: 'occurrence', contextId: this.contextId,
      definitionId: key.definitionId, occurrence: key,
      evidenceIds: unique([...input.evidenceIds]), details: { ...input.details } });
  }

  /** §5 the unknown end of an exploration. Never stand in for a guessed concrete target. */
  boundary(input: { reason: string; lastConfirmed: string; evidenceIds: readonly string[];
    details?: Record<string, DetailField> }): string {
    return this.put({ id: boundaryId(this.contextId, input.reason, slash(input.lastConfirmed)), kind: 'boundary',
      role: 'boundary', contextId: this.contextId, definitionId: null, occurrence: null,
      evidenceIds: unique([...input.evidenceIds]),
      details: { reason: { value: input.reason, unresolvedReason: null },
        lastConfirmed: { value: slash(input.lastConfirmed), unresolvedReason: null }, ...input.details } });
  }

  /** Direction is parent to child and cause to receiver; the renderer walks it backwards (§5). */
  edge(input: { kind: EdgeKind; from: string; to: string; evidenceIds: readonly string[];
    confidence: Confidence; origin: EdgeOrigin; conditionId?: string | null;
    details?: Record<string, DetailField> }): string {
    const evidenceIds = unique([...input.evidenceIds]);
    if (!evidenceIds.length) throw new ModelError(`Edge ${input.kind} ${input.from} -> ${input.to} has no evidence`);
    const conditionId = input.conditionId ?? null;
    const id = edgeId({ contextId: this.contextId, from: input.from, to: input.to, kind: input.kind, evidenceIds, conditionId });
    const existing = this.edges.get(id);
    if (existing) {
      if (existing.confidence !== input.confidence) {
        existing.confidence = weakestConfidence([existing.confidence, input.confidence]);
      }
      for (const [key, value] of Object.entries(input.details ?? {})) existing.details[key] ??= value;
      return id;
    }
    this.edges.set(id, { id, from: input.from, to: input.to, kind: input.kind, evidenceIds, conditionId,
      confidence: input.confidence, origin: input.origin, contextId: this.contextId, details: { ...input.details } });
    return id;
  }

  path(input: { occurrenceIds: readonly string[]; edgeIds: readonly string[]; declarationIds?: readonly string[];
    end: PathEnd; endReason: string; coverageReasons?: readonly string[] }): string {
    const raw: RawPath = { id: pathId({ occurrenceIds: input.occurrenceIds, edgeIds: input.edgeIds }),
      occurrenceIds: [...input.occurrenceIds], edgeIds: [...input.edgeIds],
      declarationIds: unique([...(input.declarationIds ?? [])]), end: input.end, endReason: input.endReason,
      coverageReasons: unique([...(input.coverageReasons ?? [])]) };
    const existing = this.paths.find(item => item.id === raw.id);
    if (existing) { existing.coverageReasons = unique([...existing.coverageReasons, ...raw.coverageReasons]); return raw.id; }
    this.paths.push(raw);
    return raw.id;
  }

  operation(input: { event: string; eventId: string; listenerId: string; nodeIds: readonly string[];
    edgeIds: readonly string[]; coverageReasons?: readonly string[] }): string {
    const raw: RawOperation = { id: operationId({ event: input.event, eventId: input.eventId, listenerId: input.listenerId }),
      event: input.event, eventId: input.eventId, listenerId: input.listenerId,
      nodeIds: unique([...input.nodeIds]), edgeIds: unique([...input.edgeIds]),
      coverageReasons: unique([...(input.coverageReasons ?? [])]) };
    const existing = this.operations.find(item => item.id === raw.id);
    if (existing) {
      existing.nodeIds = unique([...existing.nodeIds, ...raw.nodeIds]);
      existing.edgeIds = unique([...existing.edgeIds, ...raw.edgeIds]);
      existing.coverageReasons = unique([...existing.coverageReasons, ...raw.coverageReasons]);
      return raw.id;
    }
    this.operations.push(raw);
    return raw.id;
  }

  /** §5 a configuration error has no source span, so evidence may stay empty. */
  diagnostic(input: { code: string; severity: Severity; message: string; evidenceIds?: readonly string[];
    relatedIds?: readonly string[]; stopReason?: string | null }): string {
    const body = { code: input.code, severity: input.severity, message: input.message,
      evidenceIds: unique([...(input.evidenceIds ?? [])]), relatedIds: unique([...(input.relatedIds ?? [])]) };
    const id = diagnosticId(body);
    if (!this.diagnostics.has(id)) this.diagnostics.set(id, { ...body, id, stopReason: input.stopReason ?? null });
    return id;
  }

  /** §8 every detection gap is kept with how it relates to the selection. */
  gap(input: { code: string; message: string; relation: GapRelation; owner?: string | null;
    candidates?: readonly string[]; evidenceIds?: readonly string[];
    resolvedBy?: string | null; resolvedReason?: string | null }): string {
    const body = { code: input.code, message: input.message, owner: input.owner ?? null,
      evidenceIds: unique([...(input.evidenceIds ?? [])]) };
    const id = gapId(body);
    const existing = this.gaps.get(id);
    if (existing) {
      // The same gap can arrive twice; it keeps the closest association and the resolution either showed.
      existing.relation = strongestRelation([existing.relation, input.relation]);
      existing.candidates = unique([...existing.candidates, ...(input.candidates ?? [])]);
      if (!existing.resolvedBy && input.resolvedBy) {
        existing.resolvedBy = input.resolvedBy;
        existing.resolvedReason = input.resolvedReason ?? null;
      }
      return id;
    }
    this.gaps.set(id, { ...body, id, relation: input.relation, candidates: unique([...(input.candidates ?? [])]),
      resolvedBy: input.resolvedBy ?? null, resolvedReason: input.resolvedReason ?? null });
    return id;
  }

  /**
   * §8 the association step: place the reported gaps against the selection and record each one with the
   * relation it earned. The reason behind every decision is returned so the caller can report it.
   */
  relateGaps(gaps: readonly RawGap[], scope: GapScope): { id: string; relation: GapRelation; reason: string }[] {
    return placeGaps(gaps, scope).map(placed => ({
      id: this.gap({ code: placed.code, message: placed.message, relation: placed.relation,
        owner: placed.owner ?? null, candidates: placed.candidates, evidenceIds: placed.evidenceIds,
        resolvedBy: placed.resolvedBy, resolvedReason: placed.resolvedReason }),
      relation: placed.relation, reason: placed.reason,
    }));
  }

  limits(report: LimitsReport): void {
    this.limitsReport = { applied: [...report.applied], truncations: [...report.truncations] };
  }

  select(selection: ReportSelection): void { this.selection = selection; }

  build(): WiringReport {
    const selection = this.selection;
    if (!selection) throw new ModelError('The selected candidate must be set before the report is built');
    const edges = [...this.edges.values()].sort(byId);
    const confidenceOf = new Map(edges.map(edge => [edge.id, edge.confidence] as const));
    const weakest = (ids: readonly string[]): Confidence =>
      weakestConfidence(ids.map(id => confidenceOf.get(id) ?? 'unresolved'));
    const paths: ModelPath[] = this.paths.map(raw => {
      const reasons = unique(partialPathEnds.includes(raw.end)
        ? [...raw.coverageReasons, `Path ended at ${raw.end}: ${raw.endReason}`] : raw.coverageReasons);
      return { id: raw.id, occurrenceIds: raw.occurrenceIds, edgeIds: raw.edgeIds,
        declarationIds: raw.declarationIds, end: raw.end, endReason: raw.endReason, confidence: weakest(raw.edgeIds),
        coverage: reasons.length ? 'partial' : 'complete-within-scope', coverageReasons: reasons };
    });
    const operations: ModelOperation[] = this.operations.map(raw => ({
      id: raw.id, event: raw.event, eventId: raw.eventId, listenerId: raw.listenerId,
      nodeIds: raw.nodeIds, edgeIds: raw.edgeIds, confidence: weakest(raw.edgeIds),
      coverage: raw.coverageReasons.length ? 'partial' : 'complete-within-scope',
      coverageReasons: raw.coverageReasons,
    }));
    const gaps = [...this.gaps.values()].sort(byId);
    // §8 a gap ng-wiring filled in keeps its record but leaves the active missing list.
    const openGaps = activeGaps(gaps);
    const truncations = this.limitsReport.truncations.map(item => `Truncated by ${item.limit}: ${item.reason}`);
    const gapCounts = new Map<string, number>();
    for (const gap of gaps) if (gap.relation === 'unrelated') gapCounts.set(gap.code, (gapCounts.get(gap.code) ?? 0) + 1);
    const events = operations.map(operation => ({ event: operation.event, operationId: operation.id, coverage: operation.coverage }));
    // Each scope is aggregated on its own so an unrelated branch never rewrites the parent path (§5).
    const pathCoverage = combineCoverage(paths.map(item => item.coverage));
    const overall = combineCoverage([pathCoverage, ...events.map(item => item.coverage),
      ...(openGaps.length ? ['partial' as Coverage] : []), ...(truncations.length ? ['partial' as Coverage] : [])]);
    const unresolved = [...paths, ...operations].some(item => item.confidence === 'unresolved');
    return {
      schemaVersion: SCHEMA_VERSION, toolVersion: this.input.toolVersion,
      status: overall === 'partial' || unresolved ? 'partial' : 'complete-within-scope',
      generatedAt: this.input.generatedAt, snapshotId: this.input.snapshotId,
      context: this.input.context, query: this.input.query, selection,
      nodes: [...this.nodes.values()].sort(byId), edges, evidence: this.evidence.list(),
      conditions: this.conditions.list(), paths, operations,
      diagnostics: [...this.diagnostics.values()].sort(byId),
      coverage: { overall, paths: pathCoverage, events, gaps, gapCounts:
        [...gapCounts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([code, count]) => ({ code, count })),
        reasons: unique([...paths.flatMap(item => item.coverageReasons),
          ...operations.flatMap(item => item.coverageReasons),
          ...openGaps.map(gap => `${gap.code}: ${gap.message}`), ...truncations]) },
      limits: this.limitsReport,
    };
  }
}
