import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { isProvenFalse, weakestConfidence } from './conditions.js';
import { ModelError } from './evidence.js';
import { evidenceId, occurrenceId } from './ids.js';
import { SCHEMA_VERSION, edgeContracts } from './types.js';
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
function detailProblems(owner, details) {
    const problems = [];
    for (const [key, field] of Object.entries(details)) {
        if (!field || typeof field !== 'object') {
            problems.push(`${owner} detail ${key} is not a detail field`);
            continue;
        }
        if (field.value === null && !field.unresolvedReason)
            problems.push(`${owner} detail ${key} is null without a reason`);
        if (field.value !== null && field.unresolvedReason !== null)
            problems.push(`${owner} detail ${key} has both a value and an unresolved reason`);
    }
    return problems;
}
/**
 * §5 model validation: every id reference resolves, the report holds one context, edge kinds match the node
 * kinds at both ends, partial always carries its reason, and spans stay inside their file.
 */
export function validateReport(report) {
    const problems = [];
    const check = (ok, message) => { if (!ok)
        problems.push(message); };
    if (report.schemaVersion !== SCHEMA_VERSION)
        problems.push(`schemaVersion must be ${SCHEMA_VERSION}`);
    check(report.toolVersion.length > 0, 'toolVersion is empty');
    check(ISO_WITH_OFFSET.test(report.generatedAt), `generatedAt must be an ISO time with a UTC offset: ${report.generatedAt}`);
    check(/^[a-f0-9]{64}$/.test(report.snapshotId), 'snapshotId must be a SHA-256 digest');
    const evidence = new Map(report.evidence.map(item => [item.id, item]));
    check(evidence.size === report.evidence.length, 'evidence ids are not unique');
    for (const item of report.evidence) {
        const { id, ...body } = item;
        if (evidenceId(body) !== id)
            problems.push(`Evidence ${id} does not match its content`);
        check(item.startOffset >= 0 && item.endOffset > item.startOffset, `Evidence ${id} must be a non-empty half-open range`);
        check(item.startLine >= 1 && item.startColumn >= 1 && item.endLine >= item.startLine, `Evidence ${id} has a line or column outside the 1-based range`);
        check(item.endLine !== item.startLine || item.endColumn > item.startColumn, `Evidence ${id} ends before it starts on the same line`);
        check(/^[a-f0-9]{64}$/.test(item.contentHash), `Evidence ${id} has no content hash`);
        check(!path.isAbsolute(item.file) && !item.file.includes('\\'), `Evidence ${id} file must be a relative POSIX path`);
    }
    const nodes = new Map(report.nodes.map(node => [node.id, node]));
    check(nodes.size === report.nodes.length, 'node ids are not unique');
    const knownEvidence = (owner, ids) => {
        for (const id of ids)
            if (!evidence.has(id))
                problems.push(`${owner} refers to unknown evidence ${id}`);
    };
    for (const node of report.nodes) {
        check(node.contextId === report.context.id, `Node ${node.id} belongs to another analysis context`);
        knownEvidence(`Node ${node.id}`, node.evidenceIds);
        problems.push(...detailProblems(`Node ${node.id}`, node.details));
        check((node.kind === 'boundary') === (node.role === 'boundary'), `Node ${node.id} mixes the boundary kind and role`);
        if (node.role === 'occurrence') {
            check(node.occurrence !== null && occurrenceId(node.occurrence) === node.id, `Occurrence ${node.id} does not match its identity key`);
            check(node.occurrence?.contextId === report.context.id, `Occurrence ${node.id} keys another context`);
        }
        else
            check(node.occurrence === null, `Node ${node.id} is not an occurrence but carries an occurrence key`);
        if (node.role === 'definition')
            check(node.id.startsWith('def:'), `Definition ${node.id} has an unexpected id form`);
        if (node.role === 'boundary') {
            check(node.id.startsWith('bnd:'), `Boundary ${node.id} has an unexpected id form`);
            check(!!node.details.reason?.value, `Boundary ${node.id} must state why the exploration stopped`);
        }
        if (node.definitionId !== null) {
            const definition = nodes.get(node.definitionId);
            check(definition?.role === 'definition', `Node ${node.id} refers to unknown definition ${node.definitionId}`);
        }
        // §5 an approximate position must not stand in for an exact tag position.
        if (node.kind === 'element' && node.role === 'occurrence') {
            check(node.evidenceIds.some(id => evidence.get(id)?.precision === 'exact'), `Element ${node.id} has no exact evidence for its tag position`);
        }
    }
    const conditions = new Map(report.conditions.map(condition => [condition.id, condition]));
    check(conditions.size === report.conditions.length, 'condition ids are not unique');
    for (const condition of report.conditions) {
        switch (condition.kind) {
            case 'false':
                check(condition.reason.trim().length > 0, `Condition ${condition.id} is false without a proof`);
                break;
            case 'predicate':
                check(condition.expression.length > 0, `Condition ${condition.id} has no expression`);
                knownEvidence(`Condition ${condition.id}`, [condition.evidenceId]);
                break;
            case 'phase':
                if (condition.evidenceId)
                    knownEvidence(`Condition ${condition.id}`, [condition.evidenceId]);
                break;
            case 'all':
            case 'any':
            case 'not':
                check(condition.kind !== 'not' || condition.operandIds.length === 1, `Condition ${condition.id} must negate one operand`);
                for (const operand of condition.operandIds) {
                    if (!conditions.has(operand))
                        problems.push(`Condition ${condition.id} refers to unknown operand ${operand}`);
                }
                break;
        }
    }
    const edges = new Map(report.edges.map(edge => [edge.id, edge]));
    check(edges.size === report.edges.length, 'edge ids are not unique');
    const excluded = new Set();
    for (const edge of report.edges) {
        check(edge.contextId === report.context.id, `Edge ${edge.id} belongs to another analysis context`);
        check(edge.evidenceIds.length > 0, `Edge ${edge.id} has no evidence`);
        knownEvidence(`Edge ${edge.id}`, edge.evidenceIds);
        problems.push(...detailProblems(`Edge ${edge.id}`, edge.details));
        if (edge.conditionId !== null && !conditions.has(edge.conditionId)) {
            problems.push(`Edge ${edge.id} refers to unknown condition ${edge.conditionId}`);
        }
        const from = nodes.get(edge.from), to = nodes.get(edge.to);
        check(!!from, `Edge ${edge.id} starts at unknown node ${edge.from}`);
        check(!!to, `Edge ${edge.id} ends at unknown node ${edge.to}`);
        const contract = edgeContracts[edge.kind];
        if (!contract) {
            problems.push(`Edge ${edge.id} uses unknown kind ${edge.kind}`);
            continue;
        }
        if (from)
            check(contract.from.includes(from.kind), `Edge ${edge.id} (${edge.kind}) cannot start at a ${from.kind} node`);
        if (to)
            check(contract.to.includes(to.kind), `Edge ${edge.id} (${edge.kind}) cannot end at a ${to.kind} node`);
        for (const key of contract.details) {
            if (!(key in edge.details))
                problems.push(`Edge ${edge.id} (${edge.kind}) is missing the ${key} detail`);
        }
        // §5 an unresolvable target ends in a boundary; a known connection keeps its kind and marks the unknown field.
        check(edge.confidence !== 'unresolved' || edge.kind === 'boundary', `Edge ${edge.id} is unresolved but does not end at a boundary`);
        check((edge.kind === 'boundary') === (to?.kind === 'boundary'), `Edge ${edge.id} mixes the boundary kind and a boundary target`);
        if (isProvenFalse(conditions, edge.conditionId))
            excluded.add(edge.id);
    }
    for (const id of excluded) {
        check(report.diagnostics.some(diagnostic => diagnostic.relatedIds.includes(id)), `Edge ${id} was excluded as a false branch without a diagnostic`);
    }
    const paths = new Map(report.paths.map(item => [item.id, item]));
    const operations = new Map(report.operations.map(item => [item.id, item]));
    const gaps = new Map(report.coverage.gaps.map(gap => [gap.id, gap]));
    const weakest = (ids) => weakestConfidence(ids.map(id => edges.get(id)?.confidence ?? 'unresolved'));
    const walk = (owner, ids, roles) => {
        for (const id of ids) {
            const node = nodes.get(id);
            if (!node) {
                problems.push(`${owner} refers to unknown node ${id}`);
                continue;
            }
            if (!roles.includes(node.role))
                problems.push(`${owner} refers to ${node.role} node ${id}`);
        }
    };
    for (const item of report.paths) {
        walk(`Path ${item.id}`, item.occurrenceIds, ['occurrence', 'boundary']);
        walk(`Path ${item.id}`, item.declarationIds, ['definition']);
        for (const id of item.edgeIds) {
            if (!edges.has(id))
                problems.push(`Path ${item.id} refers to unknown edge ${id}`);
            if (excluded.has(id))
                problems.push(`Path ${item.id} keeps the excluded branch ${id}`);
        }
        check(item.confidence === weakest(item.edgeIds), `Path ${item.id} does not carry the weakest edge confidence`);
        check((item.coverage === 'partial') === (item.coverageReasons.length > 0), `Path ${item.id} coverage does not match its reasons`);
    }
    for (const item of report.operations) {
        walk(`Operation ${item.id}`, [item.eventId, item.listenerId], ['occurrence', 'definition']);
        walk(`Operation ${item.id}`, item.nodeIds, ['occurrence', 'definition', 'boundary']);
        for (const id of item.edgeIds) {
            if (!edges.has(id))
                problems.push(`Operation ${item.id} refers to unknown edge ${id}`);
            if (excluded.has(id))
                problems.push(`Operation ${item.id} keeps the excluded branch ${id}`);
        }
        check(item.confidence === weakest(item.edgeIds), `Operation ${item.id} does not carry the weakest edge confidence`);
        check((item.coverage === 'partial') === (item.coverageReasons.length > 0), `Operation ${item.id} coverage does not match its reasons`);
    }
    const anyId = (id) => nodes.has(id) || edges.has(id) || paths.has(id) || operations.has(id) ||
        evidence.has(id) || conditions.has(id) || gaps.has(id);
    for (const diagnostic of report.diagnostics) {
        knownEvidence(`Diagnostic ${diagnostic.id}`, diagnostic.evidenceIds);
        for (const id of diagnostic.relatedIds) {
            if (!anyId(id))
                problems.push(`Diagnostic ${diagnostic.id} relates to unknown id ${id}`);
        }
    }
    for (const gap of report.coverage.gaps)
        knownEvidence(`Gap ${gap.id}`, gap.evidenceIds);
    for (const truncation of report.limits.truncations) {
        knownEvidence(`Truncation ${truncation.limit}`, truncation.evidenceIds);
        if (truncation.nodeId !== null && !nodes.has(truncation.nodeId)) {
            problems.push(`Truncation ${truncation.limit} refers to unknown node ${truncation.nodeId}`);
        }
        if (truncation.edgeId !== null && !edges.has(truncation.edgeId)) {
            problems.push(`Truncation ${truncation.limit} refers to unknown edge ${truncation.edgeId}`);
        }
    }
    // §5 only the selected context is stored; other contexts stay in the candidate list.
    const selected = report.query.candidates.find(candidate => candidate.id === report.selection.candidateId);
    check(!!selected, `Selected candidate ${report.selection.candidateId} is not in the candidate list`);
    check(report.selection.contextId === report.context.id, 'The selection belongs to another analysis context');
    check(!selected || selected.contextId === report.context.id, 'The selected candidate belongs to another analysis context');
    walk('Selection', [report.selection.targetNodeId], ['occurrence']);
    knownEvidence('Selection', [report.selection.element.evidenceId]);
    for (const id of report.selection.routeIds) {
        check(nodes.get(id)?.kind === 'route', `Selection refers to ${id} as a route`);
    }
    if (report.selection.bootstrapId !== null) {
        const bootstrap = nodes.get(report.selection.bootstrapId);
        check(bootstrap?.kind === 'application' || bootstrap?.kind === 'component', `Selection refers to ${report.selection.bootstrapId} as a bootstrap`);
    }
    const openGaps = report.coverage.gaps.filter(gap => gap.relation === 'related' && !gap.resolvedBy);
    const expected = report.paths.some(item => item.coverage === 'partial') ||
        report.operations.some(item => item.coverage === 'partial') ||
        openGaps.length > 0 || report.limits.truncations.length > 0 ? 'partial' : 'complete-within-scope';
    check(report.coverage.overall === expected, 'coverage.overall does not match the aggregated scopes');
    check(report.coverage.paths === (report.paths.some(item => item.coverage === 'partial') ? 'partial' : 'complete-within-scope'), 'coverage.paths does not match the display paths');
    check(report.coverage.events.length === report.operations.length, 'coverage.events does not cover every operation');
    for (const event of report.coverage.events) {
        check(operations.get(event.operationId)?.coverage === event.coverage, `coverage.events entry ${event.operationId} does not match its operation`);
    }
    const unresolved = [...report.paths, ...report.operations].some(item => item.confidence === 'unresolved');
    check(report.status === (report.coverage.overall === 'partial' || unresolved ? 'partial' : 'complete-within-scope'), 'status does not match coverage and confidence');
    if (report.status === 'partial')
        check(report.coverage.reasons.length > 0 || unresolved, 'partial status has no reason');
    return problems;
}
export function assertValidReport(report) {
    const problems = validateReport(report);
    if (problems.length)
        throw new ModelError(`Model validation failed:\n${problems.join('\n')}`);
}
export function schemaPath() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/ng-wiring.schema.json');
}
/** §5 the shipped JSON Schema is the published contract; the model is checked against it before output. */
export async function validateAgainstSchema(report) {
    const schema = JSON.parse(await readFile(schemaPath(), 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    if (validate(report))
        return [];
    return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}
