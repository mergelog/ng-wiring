import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Evidence, ModelEdge, ModelNode, ModelOperation, WiringReport } from '../model/types.js';
import type { RenderInput, RenderResult } from './markdown.js';
import { escapeInline, relativeLinkTarget } from './text.js';

interface Row { kind: string; relation: 'V' | 'C' | 'D' | 'A'; label: string; file: string; line: number; extraLines?: number[]; edgeId?: string }
interface Chain { operations: ModelOperation[]; request?: ModelEdge }
interface Branch { dispatch: ModelEdge; consume?: ModelEdge; request?: ModelEdge; reason?: string }

const value = (edge: ModelEdge, key: string): string => edge.details[key]?.value ?? '';
const outputName = (name: string): string => name.replace(/^this\./, '');
const className = (id: string): string => /#([A-Za-z_$][\w$]*)/.exec(id)?.[1] ?? '';
const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;
const escapeLabel = (text: string): string => text.replace(/[\r\n]+/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A small source reader makes the use-site labels point at the code that was actually analyzed. */
class Sources {
  private readonly files = new Map<string, string | null>();
  constructor(private readonly root: string) {}
  text(file: string): string | null {
    if (!this.files.has(file)) {
      try { this.files.set(file, readFileSync(path.resolve(this.root, file), 'utf8')); }
      catch { this.files.set(file, null); }
    }
    return this.files.get(file) ?? null;
  }
  line(file: string, line: number): string {
    return this.text(file)?.split(/\r?\n/)[line - 1]?.trim() ?? '';
  }
  span(evidence: Evidence): string {
    return this.text(evidence.file)?.slice(evidence.startOffset, evidence.endOffset) ?? '';
  }
  /** The evidence span for an Angular element covers the tag and body; keep only its opening tag. */
  opening(evidence: Evidence): string {
    const span = this.span(evidence);
    return span.slice(0, span.indexOf('>') + 1).replace(/\s+/g, ' ').trim();
  }
}

/** Follow emitted outputs into their matching selected operations, without joining unrelated events. */
function operationChains(report: WiringReport, edges: Map<string, ModelEdge>, evidence: Map<string, Evidence>): Chain[] {
  const byEvent = new Map<string, ModelOperation[]>();
  for (const operation of report.operations) {
    const list = byEvent.get(operation.event) ?? [];
    list.push(operation);
    byEvent.set(operation.event, list);
  }
  const listeners = report.operations.filter(operation => operation.edgeIds.some(id => edges.get(id)?.kind === 'dom-listener'));
  const starts = (listeners.length ? listeners : report.operations).filter(operation =>
    !report.query.filters.event || operation.event === report.query.filters.event ||
    operation.event.startsWith(`${report.query.filters.event}.`));
  const chains: Chain[] = [];
  for (const start of starts) {
    const queue: ModelOperation[][] = [[start]];
    const visited = new Set<string>();
    let longest: ModelOperation[] = [start];
    let reachedHttp: Chain | null = null;
    while (queue.length) {
      const current = queue.shift()!;
      const last = current.at(-1)!;
      if (visited.has(last.id)) continue;
      visited.add(last.id);
      if (current.length > longest.length) longest = current;
      const request = last.edgeIds.map(id => edges.get(id)).find((edge): edge is ModelEdge => edge?.kind === 'http-create');
      if (request && (!reachedHttp || current.length > reachedHttp.operations.length)) {
        reachedHttp = { operations: current, request };
      }
      const outputs = last.edgeIds.map(id => edges.get(id))
        .filter((edge): edge is ModelEdge => edge?.kind === 'output-emit')
        .filter(edge => evidence.get(edge.evidenceIds[0] ?? '')?.file ===
          last.listenerId.slice('def:'.length).split('#')[0])
        .map(edge => outputName(value(edge, 'output')));
      for (const name of new Set(outputs)) for (const next of byEvent.get(name) ?? []) {
        if (visited.has(next.id) || current.some(item => item.id === next.id)) continue;
        // The next operation must have a subscription at a use site for this output.
        if (!next.edgeIds.some(id => {
          const edge = edges.get(id);
          return edge?.kind === 'output-subscription' && value(edge, 'output').includes(name);
        })) continue;
        queue.push([...current, next]);
      }
    }
    chains.push(reachedHttp ?? { operations: longest });
  }
  return chains;
}

function sourceRow(evidence: Evidence | undefined, kind: string, relation: Row['relation'], label: string, edgeId?: string): Row | null {
  return evidence ? { kind, relation, label, file: evidence.file, line: evidence.startLine, ...(edgeId ? { edgeId } : {}) } : null;
}

function predicateReader(report: WiringReport): (id: string | null) => string[] {
  const byId = new Map((report.conditions ?? []).map(item => [item.id, item] as const));
  const cache = new Map<string, string[]>();
  const visit = (key: string | null, seen = new Set<string>()): string[] => {
    if (!key || seen.has(key)) return [];
    const cached = cache.get(key);
    if (cached) return cached;
    seen.add(key);
    const item = byId.get(key);
    if (!item) return [];
    const values = item.kind === 'predicate' ? [item.expression] :
      'operandIds' in item ? item.operandIds.flatMap(child => visit(child, seen)) : [];
    cache.set(key, values);
    return values;
  };
  return id => [...new Set(visit(id))];
}

function operationBranches(chain: Chain, edges: Map<string, ModelEdge>,
  evidence: Map<string, Evidence>, sources: Sources, predicates: (id: string | null) => string[]): Branch[] {
  const last = chain.operations.at(-1)!;
  const ownFile = last.listenerId.slice('def:'.length).split('#')[0];
  const listenerOwner = last.listenerId.slice('def:'.length).split(':').slice(0, 2).join(':')
    .replace(/\.[^.]+$/, '');
  const all = last.edgeIds.map(id => edges.get(id)).filter((edge): edge is ModelEdge => !!edge);
  const dispatches = all.filter(edge => edge.kind === 'action-dispatch' &&
    (value(edge, 'caller') ? value(edge, 'caller') === listenerOwner :
      evidence.get(edge.evidenceIds[0] ?? '')?.file === ownFile));
  const consumes = all.filter(edge => edge.kind === 'action-consume');
  const requests = all.filter(edge => edge.kind === 'http-create');
  const calls = all.filter(edge => edge.kind === 'call');
  const effectMemberAt = (file: string, line: number): string | null => {
    const lines = sources.text(file)?.split(/\r?\n/).slice(0, line) ?? [];
    const declaration = [...lines].reverse().find(text => /\b\w+\s*=\s*createEffect\s*\(/.test(text));
    return declaration ? /\b([\w$]+)\s*=\s*createEffect\s*\(/.exec(declaration)?.[1] ?? null : null;
  };
  return dispatches.flatMap(dispatch => {
    const branch = predicates(dispatch.conditionId);
    const compatible = (edge: ModelEdge): boolean => branch.every(item => predicates(edge.conditionId).includes(item));
    const matching = requests.filter(compatible);
    const consumers = consumes.filter(edge => edge.from === dispatch.to && compatible(edge));
    const linked: Branch[] = [];
    for (const request of matching) {
      const endpoint = /\/([\w.]+)$/.exec(value(request, 'urlExpression'))?.[1] ?? '';
      const method = endpoint.replace(/\.([a-z])/g, (_, char: string) => char.toUpperCase());
      const matchingConsumers = consumers.filter(item => {
        const file = value(item, 'consumer').split('#')[0];
        const member = value(item, 'consumer').split('#').at(-1);
        const inEffect = evidence.get(request.evidenceIds[0] ?? '');
        if (inEffect?.file === file && effectMemberAt(file, inEffect.startLine) === member) return true;
        return !!method && calls.some(call => {
          const at = evidence.get(call.evidenceIds[0] ?? '');
          if (at?.file !== file || !value(call, 'callee').toLowerCase().endsWith(method.toLowerCase())) return false;
          const effect = effectMemberAt(file, at.startLine);
          return !effect || effect === member;
        });
      });
      if (matchingConsumers.length === 1) linked.push({ dispatch, consume: matchingConsumers[0], request });
    }
    if (linked.length) return linked;
    const boundary = all.find(edge => edge.kind === 'boundary' && compatible(edge) &&
      (value(edge, 'reason').includes('provideEffects') || value(edge, 'reason').includes('injector')));
    return [{ dispatch, reason: value(boundary ?? dispatch, 'reason') || '通信への接続を確認できない' }];
  });
}

function viewRows(report: WiringReport, nodes: Map<string, ModelNode>, evidence: Map<string, Evidence>, sources: Sources): Row[] {
  const occurrences = [...(report.paths[0]?.occurrenceIds ?? [])].reverse().map(id => nodes.get(id)).filter((node): node is ModelNode => !!node);
  const result: Row[] = [];
  const callSites = (report.diagnostics ?? []).filter(item => item.code === 'dynamic-call-site');
  for (const item of callSites) {
    const ev = evidence.get(item.evidenceIds[0] ?? '');
    if (!ev) continue;
    const lines = sources.text(ev.file)?.split(/\r?\n/).slice(0, ev.startLine) ?? [];
    const method = [...lines].reverse().map((line, index) => {
      const beforeCall = index === 0 ? line.slice(0, Math.max(0, line.indexOf('.open'))) : line;
      const names = [...beforeCall.matchAll(/\b([\w$]+)\([^)]*\)\s*\{/g)];
      return names.at(-1)?.[1];
    })
      .find((name): name is string => !!name);
    result.push({ kind: 'C', relation: 'V', label: `${method ? `${method}() → ` : ''}MatDialog.open`,
      file: ev.file, line: ev.startLine });
  }
  const outletCandidate = (segment: ModelNode[]): Row | null => {
    if (segment.some(node => node.details.label?.value?.startsWith('<router-outlet'))) return null;
    const files = [...new Set(segment.flatMap(node => node.evidenceIds.map(id => evidence.get(id)?.file))
      .filter((file): file is string => !!file && file.endsWith('.html')))];
    const matches: Row[] = [];
    for (const file of files) {
      const source = sources.text(file);
      if (!source) continue;
      source.split(/\r?\n/).forEach((line, index) => {
        const match = /<router-outlet\b[^>]*>/.exec(line);
        if (match) matches.push({ kind: 'O', relation: 'V', label: match[0], file, line: index + 1 });
      });
    }
    return matches.length === 1 ? matches[0]! : null;
  };
  let betweenRoutes: ModelNode[] = [];
  for (const node of occurrences) {
    if (callSites.length && node.details.relation?.value === 'dynamic-creation') continue;
    if (node.kind === 'route') {
      const outlet = outletCandidate(betweenRoutes);
      if (outlet) result.push(outlet);
      betweenRoutes = [];
    } else betweenRoutes.push(node);
    const ev = evidence.get(node.evidenceIds[0] ?? '');
    if (!ev) continue;
    const label = node.details.label?.value ?? '';
    if (node.kind === 'application') {
      const line = sources.line(ev.file, ev.startLine);
      const call = /bootstrap(?:Application|Module)\([A-Za-z_$][\w$]*/.exec(line)?.[0];
      result.push({ kind: 'B', relation: 'V', label: call ? `${call})` : label, file: ev.file, line: ev.startLine });
    } else if (node.kind === 'route') {
      const target = /#([\w$]+)/.exec(node.details.sentence?.value ?? '')?.[1];
      result.push({ kind: 'R', relation: 'V', label: target ? `${label} → ${target}` : label, file: ev.file, line: ev.startLine });
    } else if (node.details.relation?.value === 'control-flow') {
      result.push({ kind: '@', relation: 'C', label, file: ev.file, line: ev.startLine });
    } else if (node.id === report.selection.targetNodeId || node.kind === 'component' ||
      /<(?:[\w]+-[\w-]+|form|input)\b/.test(label)) {
      const opening = sources.opening(ev);
      const tag = /^<([\w-]+)/.exec(opening)?.[1] ?? '';
      let shown = opening;
      if (!tag) shown = label;
      else if (tag === 'input') {
        const id = /\bdata-id="[^"]*"/.exec(opening)?.[0];
        const model = /\[\(ngModel\)\]="[^"]*"/.exec(opening)?.[0];
        shown = `<input ${[id, model].filter(Boolean).join(' ')}>`;
      } else if (node.kind === 'component') {
        const editable = /\[editable\]="[^"]*"/.exec(opening)?.[0];
        shown = `<${tag}${editable ? ` ${editable}` : ''}>`;
      } else if (tag.includes('-')) {
        const visible = /\[visible\]="[^"]*"/.exec(opening)?.[0];
        shown = `<${tag}${visible ? ` ${visible}` : ''}>`;
      } else if (tag === 'form') shown = `<form${opening.includes('#form') ? ' #form' : ''}>`;
      else if (node.id === report.selection.targetNodeId && report.query.target.kind === 'attribute') {
        const name = report.query.target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attribute = new RegExp(`\\b${name}="[^"]*"`).exec(opening)?.[0];
        shown = `<${tag}${attribute ? ` ${attribute}` : ''}>`;
      }
      else if (tag) shown = `<${tag}>`;
      const ownerFile = node.occurrence?.ownerId.split('#')[0] ?? '';
      const kind = tag.startsWith('as-split') && sources.text(ownerFile)?.includes('angular-split') ? 'L' : 'h';
      result.push({ kind, relation: 'V', label: shown || label, file: ev.file, line: ev.startLine });
    }
  }
  return result;
}

function dataRows(chain: Chain, edges: Map<string, ModelEdge>, nodes: Map<string, ModelNode>,
  evidence: Map<string, Evidence>, sources: Sources, branch?: Branch, branchConditions: string[] = [],
  includePrefix = true): Row[] {
  const result: Row[] = [];
  const edgeOf = (operation: ModelOperation, predicate: (edge: ModelEdge) => boolean): ModelEdge | undefined =>
    operation.edgeIds.map(id => edges.get(id)).find((edge): edge is ModelEdge => !!edge && predicate(edge));
  const evidenceOf = (edge: ModelEdge | undefined): Evidence | undefined => evidence.get(edge?.evidenceIds[0] ?? '');
  const push = (edge: ModelEdge | undefined, kind: string, relation: Row['relation'], label: string,
    alternate?: Evidence): void => {
    const row = sourceRow(alternate ?? evidenceOf(edge), kind, relation, label, edge?.id);
    if (row) result.push(row);
  };
  const first = chain.operations[0]!;
  const listener = edgeOf(first, edge => edge.kind === 'dom-listener');
  if (includePrefix && listener) push(listener, 'h', 'D', `(${first.event}) ${value(listener, 'handler')}`);
  for (let i = 0; includePrefix && i < chain.operations.length - 1; i++) {
    const current = chain.operations[i]!, next = chain.operations[i + 1]!;
    const emitted = edgeOf(current, edge => edge.kind === 'output-emit' && outputName(value(edge, 'output')) === next.event);
    if (emitted) {
      const ev = evidenceOf(emitted);
      const code = ev ? sources.line(ev.file, ev.startLine).replace(/;$/, '') : '';
      push(emitted, 'C', 'D', code || `${next.event}.emit(...)`);
    }
    const subscription = edgeOf(next, edge => edge.kind === 'output-subscription' &&
      value(edge, 'output').includes(next.event) && evidenceOf(edge)?.file.endsWith('.html') === true);
    if (subscription) {
      const subscriber = value(subscription, 'subscriber');
      const owner = className(next.listenerId);
      push(subscription, 'h', 'D', `${owner ? `${owner}.` : ''}${subscriber}`);
    }
  }
  const last = chain.operations.at(-1)!;
  const dispatch = branch?.dispatch ?? edgeOf(last, edge => edge.kind === 'action-dispatch');
  if (branch && branchConditions.length) push(dispatch, '@', 'C', `条件: ${branchConditions.join(' / ')}`);
  if (dispatch) {
    const ev = evidenceOf(dispatch);
    const code = ev ? sources.line(ev.file, ev.startLine).replace(/;$/, '') : '';
    push(dispatch, 'D', 'D', code || value(dispatch, 'action'));
  }
  const consume = branch ? branch.consume : dispatch && edgeOf(last, edge => edge.kind === 'action-consume' && edge.from === dispatch.to);
  if (consume) {
    const effect = nodes.get(consume.to);
    const effectName = value(consume, 'consumer').split('#').at(-1) ?? effect?.details.label?.value ?? '';
    const effectFile = value(consume, 'consumer').split('#')[0] ?? '';
    const line = (sources.text(effectFile)?.split(/\r?\n/).findIndex(text =>
      text.includes(effectName) && /=\s*(?:createEffect|inject|\()/u.test(text)) ?? -1) + 1;
    const ev = line ? { ...evidenceOf(consume)!, file: effectFile, startLine: line } : undefined;
    const action = value(consume, 'action').split('#').at(-1) ?? '';
    const nearby = sources.text(effectFile)?.split(/\r?\n/).slice(line, line + 8).join(' ') ?? '';
    const registered = action && new RegExp(`\\bofType\\(\\s*${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`).test(nearby);
    push(consume, 'E', 'D', registered ? `${effectName}（ofType(${action})）` : effectName, ev);
  }
  const request = branch ? branch.request : chain.request;
  if (!request) {
    if (branch?.reason) push(dispatch, '@', 'C', `停止: ${branch.reason}`);
    return result;
  }
  const url = value(request, 'urlExpression');
  const method = value(request, 'method') || 'HTTP';
  const endpoint = /\/([\w.]+)$/.exec(url)?.[1] ?? '';
  const methodName = endpoint.replace(/\.([a-z])/g, (_, char: string) => char.toUpperCase());
  const effectFile = consume ? value(consume, 'consumer').split('#')[0] : '';
  const serviceCall = edgeOf(last, edge => edge.kind === 'call' && !!methodName &&
    value(edge, 'callee').toLowerCase().endsWith(methodName.toLowerCase()) &&
    !!effectFile && evidenceOf(edge)?.file === effectFile);
  if (serviceCall) {
    const ev = evidenceOf(serviceCall);
    const code = ev ? sources.line(ev.file, ev.startLine).replace(/;$/, '') : '';
    push(serviceCall, 'E', 'D', code || value(serviceCall, 'callee'));
  }
  const service = edgeOf(last, edge => edge.kind === 'call' && evidenceOf(edge)?.file.endsWith('.service.ts') === true &&
    !!endpoint && sources.line(evidenceOf(edge)!.file, evidenceOf(edge)!.startLine).includes(endpoint));
  push(service ?? request, 'S', 'A', `${method} ${url || '（URL 未解決）'}`);
  return result;
}

function execCommand(report: WiringReport, belowData: boolean): string {
  const args = ['npx', 'github:mergelog/ng-wiring'];
  if (report.query.target.kind === 'source') args.push('--source', `${report.query.target.file}:${report.query.target.line}`);
  else args.push(report.query.raw);
  for (const key of ['project', 'tsconfig', 'through', 'route', 'selector', 'event'] as const) {
    const value = report.query.filters[key];
    if (value) args.push(`--${key}`, value);
  }
  args.push('--candidate', report.selection.candidateId);
  if (belowData) args.push('--belowData');
  return args.map((arg, index) => index < 2 || arg.startsWith('--') ? arg : shellQuote(arg)).join(' ');
}

export function renderSimple(input: RenderInput & { belowData?: boolean }): RenderResult {
  const { report } = input;
  const sources = new Sources(report.context.workspaceRoot);
  const nodes = new Map(report.nodes.map(node => [node.id, node] as const));
  const edges = new Map(report.edges.map(edge => [edge.id, edge] as const));
  const evidence = new Map(report.evidence.map(item => [item.id, item] as const));
  const predicates = predicateReader(report);
  const chains = operationChains(report, edges, evidence);
  const primary = chains.find(chain => chain.request && chain.operations.some(operation => operation.event.startsWith('keydown.')))
    ?? chains.find(chain => chain.request) ?? chains[0];
  const siblings = primary ? chains.filter(chain => chain.request?.id === primary.request?.id &&
    chain.operations.map(operation => operation.event).slice(1).join('/') ===
    primary.operations.map(operation => operation.event).slice(1).join('/')) : [];
  const view = input.belowData ? [] : viewRows(report, nodes, evidence, sources);
  const branches = primary ? operationBranches(primary, edges, evidence, sources, predicates) : [];
  const data = primary ? branches.length ? branches.flatMap((branch, index) => {
    const branchTerms = predicates(branch.dispatch.conditionId).filter(term =>
      /^(?:if |else |switch |case |route )/.test(term));
    return dataRows(primary, edges, nodes, evidence, sources, branch, branchTerms, index === 0);
  }) : dataRows(primary, edges, nodes, evidence, sources) : [];
  if (data.length && siblings.length > 1) {
    const events = [...new Set(siblings.map(chain => chain.operations[0]!.event))];
    const listener = data[0]!;
    const handler = listener.label.slice(listener.label.indexOf(')') + 1).trim();
    listener.label = `${events.map(event => `(${event})`).join('/')} ${handler}`;
    listener.extraLines = siblings.map(chain => chain.operations[0]!).flatMap(operation =>
      operation.edgeIds.map(id => edges.get(id)).filter((edge): edge is ModelEdge => edge?.kind === 'dom-listener')
        .map(edge => evidence.get(edge.evidenceIds[0] ?? '')?.startLine).filter((line): line is number => !!line))
      .filter(line => line !== listener.line);
  }
  const rows = [...view, ...data];
  const out: string[] = [`# ${escapeInline(report.query.raw)} 解析結果`, '', `## ${escapeInline(report.query.target.kind === 'attribute' ? report.query.target.value : report.query.raw)} の 遷移`, ''];
  const problems: string[] = [];
  rows.forEach((row, index) => {
    const absolute = path.resolve(report.context.workspaceRoot, row.file);
    const target = relativeLinkTarget(input.outputDir, absolute, input.platform ?? path);
    const marker = `▶️:${row.kind}:${row.relation}`;
    const link = target ? `[${marker}](${target}#L${row.line})` : `[${marker}]`;
    if (!target) problems.push(`No relative source link to ${absolute}`);
    const lines = [row.line, ...(row.extraLines ?? [])].sort((a, b) => a - b);
    out.push(`- ${String(rows.length - index).padStart(2, '0')}. ${link} ${escapeLabel(row.label)}:${[...new Set(lines)].join(',')}`);
  });
  if ((report.diagnostics ?? []).some(item => item.code === 'event-propagation' &&
    item.message.includes('this is a separate operation from the selected input')))
    out.push('- 操作: 入力と送信ボタンの click は別操作。output は送信メソッドが emit した場合に届く');
  if (!primary?.request && !branches.some(branch => branch.request)) out.push('- 通信: この探索範囲では未検出');
  out.push('', '## 凡例', '');
  const kinds: Record<string, string> = { h: 'html', C: 'コンポーネントクラスts', D: 'ディスパッチ', E: 'エフェクト',
    S: 'サービス', R: 'ルート定義', O: 'router-outlet（配置先）', '@': '制御フロー', L: '外部ライブラリ部品', B: 'bootstrap' };
  out.push('1個目（種別）', '');
  for (const kind of [...new Set(rows.map(row => row.kind))]) out.push(`- \`:${kind}\` ${kinds[kind] ?? 'その他'}`);
  out.push('', '2個目（関係）', '');
  const relations: Record<string, string> = { D: 'データ受け渡し', A: 'API通信', V: '表示配置', C: '条件分岐' };
  for (const relation of [...new Set(rows.map(row => row.relation))]) out.push(`- \`:${relation}\` ${relations[relation] ?? '何もなし'}`);
  if (!input.belowData && report.query.filters.selector) {
    out.push('', '## selector path', '');
    for (const part of report.query.filters.selector.split('>').map(part => part.trim())) out.push(`- ${escapeInline(part)}`);
  }
  out.push('', '## exec command', '', execCommand(report, !!input.belowData), '');
  return { text: out.join('\n'), edgeIds: rows.flatMap(row => row.edgeId ? [row.edgeId] : []), problems };
}
