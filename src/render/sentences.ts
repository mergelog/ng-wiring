import { edgeContracts, edgeKinds, type Condition, type DetailField, type EdgeKind } from '../model/types.js';
import { RenderError, escapeInline } from './text.js';

/**
 * §8 the closed sentence table. It shares its slots with `edgeContracts`, so a kind that is added to
 * the model without a sentence here becomes a render error rather than free prose.
 */
export const sentenceTemplates: Readonly<Record<EdgeKind, string>> = {
  'template-use': '{owner} が {location} で {child} を宣言する',
  'display-parent': '{child} の表示上の親は {parent}',
  projection: '{child} を {host} の {slot} に投影する',
  'view-insertion': '{declarer} の {fragment} を {insertion} に挿入する',
  'route-load': '{sourceRoute} が {loader} から {targetRoute} を取り込む',
  'route-outlet': '{route} の {component} を {outlet} に配置する',
  'route-redirect': '{route} は {destination} へのリダイレクトを定義する',
  bootstrap: '{application} が {component} を起動する',
  'dynamic-create': '{caller} が {container} で {component} を生成する',
  'dom-listener': '{selected} の {event} に対し {listener} の {handler} が登録されている',
  'event-propagation': '{event} は {phase} で {fromElement} から {toElement} に伝播し得る',
  'input-binding': '{owner} の {expression} を {input} に渡す',
  'output-subscription': '{subscriber} が {output} を購読する',
  'output-emit': '{output} に {valueExpression} を emit する（宣言型 {declaredType}）',
  call: '{caller} が {callee}({arguments}) を呼ぶ',
  'value-flow': '{valueExpression} が {destination} の入力となる',
  'state-write': '{writer} が {state} を {valueExpression} で更新する',
  'state-read': '{reader} が {state} を読む（{tracking}）',
  'reactive-link': '{source} は {operator} を介して {consumer} に接続する（{scheduling}）',
  'query-target': '{query} が {scope} から {target} を参照する',
  'di-resolve': '{token} は {provider} により {implementation} に解決される',
  'action-dispatch': '{caller} が {busId} に {action} を dispatch する（{dispatchMode}）',
  'action-consume': '{registration} の {consumer} が {busId} から {action} を受け取る',
  'event-dispatch': '{caller} が {busId} の {scope} に {event} を送信する（{dispatchMode}）',
  'event-consume': '{registration} の {consumer} が {busId} から {event} を受け取る',
  'http-create': '{method} {urlExpression} の要求を作る（要求型 {requestType}、応答型 {responseType}）',
  'http-consume': '{request} は {consumer} の購読/開始に接続する',
  'type-use': '{value} は {role} として {type} を使用する',
  boundary: '{lastConfirmed} で追跡停止: {reason}',
};

const slotPattern = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
/** The detail names one sentence prints, in the order §8 writes them. */
export const sentenceSlots = (kind: EdgeKind): string[] =>
  [...new Set([...(sentenceTemplates[kind] ?? '').matchAll(slotPattern)].map(match => match[1]!))];

/**
 * §8 every slot a sentence prints has to be a required detail of that kind. The reverse does not hold:
 * `template-use` also carries the occurrence id, which the table uses as a reference and not as prose.
 */
export function sentenceSlotProblems(): string[] {
  const problems: string[] = [];
  for (const kind of edgeKinds) {
    const template = sentenceTemplates[kind];
    if (!template) { problems.push(`Edge kind ${kind} has no sentence`); continue; }
    const required = edgeContracts[kind].details;
    for (const slot of sentenceSlots(kind)) {
      if (!required.includes(slot)) problems.push(`Edge kind ${kind} prints ${slot}, which is not a required detail`);
    }
  }
  for (const kind of Object.keys(sentenceTemplates)) {
    if (!edgeKinds.includes(kind as EdgeKind)) problems.push(`Sentence table has the unknown kind ${kind}`);
  }
  return problems;
}

/** §8 `in/process/out/state/service/relation` group the document only; they are never analysis kinds. */
export const displayGroups = ['in', 'process', 'out', 'state', 'service', 'relation'] as const;
export type DisplayGroup = typeof displayGroups[number];
export const displayGroupLabels: Readonly<Record<DisplayGroup, string>> = {
  in: '入力', process: '処理', out: '出力', state: '状態', service: 'サービス', relation: '関連',
};
export const displayGroupOf: Readonly<Record<EdgeKind, DisplayGroup>> = {
  'template-use': 'relation', 'display-parent': 'relation', projection: 'relation', 'view-insertion': 'relation',
  'route-load': 'relation', 'route-outlet': 'relation', 'route-redirect': 'relation', bootstrap: 'relation',
  'dynamic-create': 'relation', 'query-target': 'relation', 'type-use': 'relation', boundary: 'relation',
  'dom-listener': 'in', 'event-propagation': 'in', 'input-binding': 'in', 'output-subscription': 'in',
  'action-consume': 'in', 'event-consume': 'in', 'http-consume': 'in',
  call: 'process', 'value-flow': 'process', 'reactive-link': 'process',
  'output-emit': 'out', 'action-dispatch': 'out', 'event-dispatch': 'out', 'http-create': 'out',
  'state-read': 'state', 'state-write': 'state',
  'di-resolve': 'service',
};

/**
 * §8 `state` and `service` also exist as node kinds, so the two vocabularies must not be mixed up: the
 * sentence table is keyed by edge kind alone, the document prints the group as its own label beside the
 * raw kind, and no group name may become an edge kind.
 */
export function displayGroupProblems(): string[] {
  const problems: string[] = [];
  for (const group of displayGroups) {
    if ((edgeKinds as readonly string[]).includes(group)) problems.push(`Display group ${group} is also an edge kind`);
    if (group in sentenceTemplates) problems.push(`Display group ${group} has a sentence of its own`);
  }
  for (const kind of edgeKinds) if (!displayGroupOf[kind]) problems.push(`Edge kind ${kind} has no display group`);
  return problems;
}

export interface Sentence { text: string; unresolved: string[] }

/**
 * §8 renders one relation from the closed table. An unknown kind or a missing required detail stops the
 * render instead of producing prose the model does not support (§8, P14-05).
 */
export function renderSentence(kind: EdgeKind, details: Record<string, DetailField>): Sentence {
  const template = sentenceTemplates[kind];
  if (!template || !edgeContracts[kind]) throw new RenderError(`No sentence is defined for edge kind ${kind}`);
  const unresolved: string[] = [];
  const text = template.replace(slotPattern, (_match, key: string) => {
    const field = details[key];
    if (!field) throw new RenderError(`Edge kind ${kind} is missing the ${key} detail`);
    // §8 an unknown detail stays an unresolved marker with its reason; no placeholder name is asserted.
    if (field.value === null) {
      unresolved.push(`${key}: ${field.unresolvedReason ?? '理由の記録なし'}`);
      return `（未解決: ${escapeInline(key)}）`;
    }
    return escapeInline(field.value);
  });
  return { text, unresolved };
}

const conditionDepthLimit = 64;

/**
 * §8 conditions are shown mechanically from the recorded expression and phase. Nothing is reworded into
 * a new causal claim, so an unevaluated predicate is printed as the expression it came from.
 */
export function renderCondition(conditions: ReadonlyMap<string, Condition>, id: string | null, depth = 0): string | null {
  if (id === null) return null;
  if (depth >= conditionDepthLimit) return '…（条件木の表示深さ上限）';
  const condition = conditions.get(id);
  if (!condition) return `未知の条件参照 ${escapeInline(id)}`;
  switch (condition.kind) {
    case 'true': return null;
    case 'false': return `false（${escapeInline(condition.reason)}）`;
    case 'predicate': return `${escapeInline(condition.expression)}（scope: ${escapeInline(condition.scope)}）`;
    case 'phase':
      return `phase ${escapeInline(condition.phase)}${condition.detail ? `（${escapeInline(condition.detail)}）` : ''}`;
    case 'not':
      return `not（${renderCondition(conditions, condition.operandIds[0] ?? null, depth + 1) ?? 'true'}）`;
    default: {
      const joiner = condition.kind === 'all' ? ' かつ ' : ' または ';
      const parts = condition.operandIds.map(operand => renderCondition(conditions, operand, depth + 1) ?? 'true');
      return parts.length ? `（${parts.join(joiner)}）` : null;
    }
  }
}
