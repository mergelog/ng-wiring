import { conditionId } from './ids.js';
import type { Condition, ConditionBody, ConditionPhase, Confidence, Coverage } from './types.js';

/**
 * §5 condition tree. An expression the analyzer cannot evaluate stays a `predicate`; only a branch
 * that was proven unreachable becomes `false`, and that proof is recorded as its reason.
 */
export class ConditionTable {
  private readonly byId = new Map<string, Condition>();

  private intern(body: ConditionBody): string {
    const id = conditionId(body);
    if (!this.byId.has(id)) this.byId.set(id, { ...body, id } as Condition);
    return id;
  }

  always(): string { return this.intern({ kind: 'true' }); }
  never(reason: string): string {
    if (!reason.trim()) throw new Error('A false condition must record why the branch was proven unreachable');
    return this.intern({ kind: 'false', reason });
  }
  predicate(input: { expression: string; scope: string; evidenceId: string }): string {
    return this.intern({ kind: 'predicate', expression: input.expression, scope: input.scope, evidenceId: input.evidenceId });
  }
  phase(input: { phase: ConditionPhase; detail?: string | null; evidenceId?: string | null }): string {
    return this.intern({ kind: 'phase', phase: input.phase, detail: input.detail ?? null, evidenceId: input.evidenceId ?? null });
  }
  all(operandIds: readonly string[]): string { return this.combine('all', operandIds); }
  any(operandIds: readonly string[]): string { return this.combine('any', operandIds); }
  not(operandId: string): string { return this.intern({ kind: 'not', operandIds: [operandId] }); }

  private combine(kind: 'all' | 'any', operandIds: readonly string[]): string {
    const operands: string[] = [];
    for (const id of operandIds) if (!operands.includes(id)) operands.push(id);
    if (!operands.length) return kind === 'all' ? this.always() : this.never(`Empty ${kind} has no reachable branch`);
    if (operands.length === 1) return operands[0]!;
    return this.intern({ kind, operandIds: operands });
  }

  get(id: string): Condition | undefined { return this.byId.get(id); }
  list(): Condition[] { return [...this.byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
}

function evaluate(conditions: ReadonlyMap<string, Condition> | ConditionTable, id: string): boolean | null {
  const condition = conditions.get(id);
  if (!condition) return null;
  switch (condition.kind) {
    case 'true': return true;
    case 'false': return false;
    case 'not': {
      const operand = condition.operandIds[0];
      const value = operand === undefined ? null : evaluate(conditions, operand);
      return value === null ? null : !value;
    }
    case 'all': case 'any': {
      const values = condition.operandIds.map(operand => evaluate(conditions, operand));
      if (condition.kind === 'all') return values.includes(false) ? false : values.includes(null) ? null : true;
      return values.includes(true) ? true : values.includes(null) ? null : false;
    }
    default: return null;
  }
}

/** True only for branches proven unreachable; an unevaluated predicate returns false here (§5). */
export function isProvenFalse(conditions: ReadonlyMap<string, Condition> | ConditionTable, id: string | null): boolean {
  return id !== null && evaluate(conditions, id) === false;
}

const rank: Record<Confidence, number> = { confirmed: 0, conditional: 1, unresolved: 2 };
/** §5 a single path takes the weakest value of its edges. */
export function weakestConfidence(values: Iterable<Confidence>): Confidence {
  let weakest: Confidence = 'confirmed';
  for (const value of values) if (rank[value] > rank[weakest]) weakest = value;
  return weakest;
}
/** §5 a heading over several branches shows the weakest value and keeps each branch value. */
export function branchSummary<T extends { id: string; confidence: Confidence }>(branches: readonly T[]):
{ confidence: Confidence; branches: { id: string; confidence: Confidence }[] } {
  return { confidence: weakestConfidence(branches.map(branch => branch.confidence)),
    branches: branches.map(branch => ({ id: branch.id, confidence: branch.confidence })) };
}
/** §5 coverage is aggregated per scope and stays independent of confidence. */
export function combineCoverage(values: Iterable<Coverage>): Coverage {
  for (const value of values) if (value === 'partial') return 'partial';
  return 'complete-within-scope';
}
