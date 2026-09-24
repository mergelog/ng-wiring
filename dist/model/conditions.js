import { conditionId } from './ids.js';
/**
 * §5 condition tree. An expression the analyzer cannot evaluate stays a `predicate`; only a branch
 * that was proven unreachable becomes `false`, and that proof is recorded as its reason.
 */
export class ConditionTable {
    byId = new Map();
    intern(body) {
        const id = conditionId(body);
        if (!this.byId.has(id))
            this.byId.set(id, { ...body, id });
        return id;
    }
    always() { return this.intern({ kind: 'true' }); }
    never(reason) {
        if (!reason.trim())
            throw new Error('A false condition must record why the branch was proven unreachable');
        return this.intern({ kind: 'false', reason });
    }
    predicate(input) {
        return this.intern({ kind: 'predicate', expression: input.expression, scope: input.scope, evidenceId: input.evidenceId });
    }
    phase(input) {
        return this.intern({ kind: 'phase', phase: input.phase, detail: input.detail ?? null, evidenceId: input.evidenceId ?? null });
    }
    all(operandIds) { return this.combine('all', operandIds); }
    any(operandIds) { return this.combine('any', operandIds); }
    not(operandId) { return this.intern({ kind: 'not', operandIds: [operandId] }); }
    combine(kind, operandIds) {
        const operands = [];
        for (const id of operandIds)
            if (!operands.includes(id))
                operands.push(id);
        if (!operands.length)
            return kind === 'all' ? this.always() : this.never(`Empty ${kind} has no reachable branch`);
        if (operands.length === 1)
            return operands[0];
        return this.intern({ kind, operandIds: operands });
    }
    get(id) { return this.byId.get(id); }
    list() { return [...this.byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
}
function evaluate(conditions, id) {
    const condition = conditions.get(id);
    if (!condition)
        return null;
    switch (condition.kind) {
        case 'true': return true;
        case 'false': return false;
        case 'not': {
            const operand = condition.operandIds[0];
            const value = operand === undefined ? null : evaluate(conditions, operand);
            return value === null ? null : !value;
        }
        case 'all':
        case 'any': {
            const values = condition.operandIds.map(operand => evaluate(conditions, operand));
            if (condition.kind === 'all')
                return values.includes(false) ? false : values.includes(null) ? null : true;
            return values.includes(true) ? true : values.includes(null) ? null : false;
        }
        default: return null;
    }
}
/** True only for branches proven unreachable; an unevaluated predicate returns false here (§5). */
export function isProvenFalse(conditions, id) {
    return id !== null && evaluate(conditions, id) === false;
}
const rank = { confirmed: 0, conditional: 1, unresolved: 2 };
/** §5 a single path takes the weakest value of its edges. */
export function weakestConfidence(values) {
    let weakest = 'confirmed';
    for (const value of values)
        if (rank[value] > rank[weakest])
            weakest = value;
    return weakest;
}
/** §5 a heading over several branches shows the weakest value and keeps each branch value. */
export function branchSummary(branches) {
    return { confidence: weakestConfidence(branches.map(branch => branch.confidence)),
        branches: branches.map(branch => ({ id: branch.id, confidence: branch.confidence })) };
}
/** §5 coverage is aggregated per scope and stays independent of confidence. */
export function combineCoverage(values) {
    for (const value of values)
        if (value === 'partial')
            return 'partial';
    return 'complete-within-scope';
}
