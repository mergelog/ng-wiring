import { createHash } from 'node:crypto';
import { canonicalJson } from '../cli/candidates.js';
import type { ConditionBody, EdgeKind, EvidenceSpan, Evidence, OccurrenceKey, Severity } from './types.js';

export const slash = (value: string): string => value.replaceAll('\\', '/');
const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
const span = (value: EvidenceSpan | null): EvidenceSpan | null =>
  value && { file: slash(value.file), start: value.start, end: value.end };

/** §5 `ComponentId = workspace relative TS path#ClassName`; symbol ids extend it with `.member`. */
export const definitionId = (symbolId: string): string => `def:${slash(symbolId)}`;

export function normalizeOccurrence(key: OccurrenceKey): OccurrenceKey {
  return { contextId: key.contextId, ownerId: slash(key.ownerId),
    definitionId: key.definitionId && slash(key.definitionId), span: span(key.span),
    insertion: key.insertion, projection: key.projection, route: key.route };
}
/** The id carries the identity of the use site only; it never stands for a count of runtime instances. */
export const occurrenceId = (key: OccurrenceKey): string => `occ:${digest(normalizeOccurrence(key))}`;
export const boundaryId = (contextId: string, reason: string, lastConfirmed: string): string =>
  `bnd:${digest({ contextId, reason, lastConfirmed })}`;

export const evidenceId = (evidence: Omit<Evidence, 'id'>): string => `ev:${digest({
  file: evidence.file, startOffset: evidence.startOffset, endOffset: evidence.endOffset,
  precision: evidence.precision, symbolId: evidence.symbolId, contentHash: evidence.contentHash,
})}`;

/** Evidence ids take part so that two call sites of the same relation never collapse into one edge (§8). */
export const edgeId = (edge: { contextId: string; from: string; to: string; kind: EdgeKind;
  evidenceIds: readonly string[]; conditionId: string | null }): string => `edge:${digest({
  contextId: edge.contextId, from: edge.from, to: edge.to, kind: edge.kind,
  evidenceIds: [...edge.evidenceIds].sort(), conditionId: edge.conditionId,
})}`;

export const conditionId = (body: ConditionBody): string => `cond:${digest(body)}`;
export const pathId = (path: { occurrenceIds: readonly string[]; edgeIds: readonly string[] }): string =>
  `path:${digest({ occurrenceIds: [...path.occurrenceIds], edgeIds: [...path.edgeIds] })}`;
export const operationId = (operation: { event: string; eventId: string; listenerId: string }): string =>
  `op:${digest(operation)}`;
export const diagnosticId = (diagnostic: { code: string; message: string; severity: Severity;
  evidenceIds: readonly string[]; relatedIds: readonly string[] }): string => `diag:${digest({
  code: diagnostic.code, message: diagnostic.message, severity: diagnostic.severity,
  evidenceIds: [...diagnostic.evidenceIds].sort(), relatedIds: [...diagnostic.relatedIds].sort(),
})}`;
export const gapId = (gap: { code: string; message: string; owner: string | null;
  evidenceIds: readonly string[] }): string => `gap:${digest({
  code: gap.code, message: gap.message, owner: gap.owner, evidenceIds: [...gap.evidenceIds].sort(),
})}`;
