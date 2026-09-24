import { createHash } from 'node:crypto';
import { canonicalJson } from '../cli/candidates.js';
export const slash = (value) => value.replaceAll('\\', '/');
const digest = (value) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
const span = (value) => value && { file: slash(value.file), start: value.start, end: value.end };
/** §5 `ComponentId = workspace relative TS path#ClassName`; symbol ids extend it with `.member`. */
export const definitionId = (symbolId) => `def:${slash(symbolId)}`;
export function normalizeOccurrence(key) {
    return { contextId: key.contextId, ownerId: slash(key.ownerId),
        definitionId: key.definitionId && slash(key.definitionId), span: span(key.span),
        insertion: key.insertion, projection: key.projection, route: key.route };
}
/** The id carries the identity of the use site only; it never stands for a count of runtime instances. */
export const occurrenceId = (key) => `occ:${digest(normalizeOccurrence(key))}`;
export const boundaryId = (contextId, reason, lastConfirmed) => `bnd:${digest({ contextId, reason, lastConfirmed })}`;
export const evidenceId = (evidence) => `ev:${digest({
    file: evidence.file, startOffset: evidence.startOffset, endOffset: evidence.endOffset,
    precision: evidence.precision, symbolId: evidence.symbolId, contentHash: evidence.contentHash,
})}`;
/** Evidence ids take part so that two call sites of the same relation never collapse into one edge (§8). */
export const edgeId = (edge) => `edge:${digest({
    contextId: edge.contextId, from: edge.from, to: edge.to, kind: edge.kind,
    evidenceIds: [...edge.evidenceIds].sort(), conditionId: edge.conditionId,
})}`;
export const conditionId = (body) => `cond:${digest(body)}`;
export const pathId = (path) => `path:${digest({ occurrenceIds: [...path.occurrenceIds], edgeIds: [...path.edgeIds] })}`;
export const operationId = (operation) => `op:${digest(operation)}`;
export const diagnosticId = (diagnostic) => `diag:${digest({
    code: diagnostic.code, message: diagnostic.message, severity: diagnostic.severity,
    evidenceIds: [...diagnostic.evidenceIds].sort(), relatedIds: [...diagnostic.relatedIds].sort(),
})}`;
export const gapId = (gap) => `gap:${digest({
    code: gap.code, message: gap.message, owner: gap.owner, evidenceIds: [...gap.evidenceIds].sort(),
})}`;
