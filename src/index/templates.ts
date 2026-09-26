import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AST, TmplAstNode, TmplAstElement, TmplAstTemplate } from '@angular/compiler';
import type { AnalysisContext } from '../workspace/context.js';
import type { Catalog, Declaration } from './catalog.js';
import { ScopeResolver } from '../resolve/scope/index.js';
import type { MazeGraph, MazeEdge } from '../adapters/ng-maze/index.js';

export interface Span { file: string; start: number; end: number; line: number; endLine: number; column: number }
export interface IndexedElement {
  owner: Declaration;
  node: TmplAstElement | TmplAstTemplate;
  tag: string;
  span: Span;
  staticAttributes: Map<string, string>;
  boundAttributes: string[];
  boundExpressions: Map<string, string>;
  boundSpans: Map<string, Span>;
  events: string[];
  eventHandlers: string[];
  eventStops: { event: string; definite: boolean }[];
  eventSpans: (Span | null)[];
  references: string[];
  lexical: Map<string, LexicalBinding>;
  repeated: boolean;
  parent: IndexedElement | null;
  fallbackSlot: IndexedSlot | null;
  component: string | null;
  directives: string[];
  appliedInputs: Map<string, string[]>;
  appliedOutputs: Map<string, string[]>;
  origin: 'ngmaze' | 'ng-wiring' | null;
  gaps: string[];
  controlFlow: ControlFlowFrame[];
}
export interface LexicalBinding { kind: 'let' | 'loop' | 'fragment' | 'reference'; value: string; element: IndexedElement | null }
export interface IndexedSlot { owner: Declaration; node: TmplAstNode; selector: string; span: Span; parent: IndexedElement | null; order: number }

export type DeferPhase = 'main' | 'placeholder' | 'loading' | 'error';
export type DeferTriggerGroup = 'trigger' | 'prefetch' | 'hydrate';
export interface DeferTrigger { group: DeferTriggerGroup; kind: string; detail: string | null; text: string }
export interface DeferInfo {
  id: string;
  triggers: DeferTrigger[];
  placeholderMinimumMs: number | null;
  loadingAfterMs: number | null;
  loadingMinimumMs: number | null;
}
export type ControlFlowKind = 'if' | 'for' | 'for-empty' | 'switch' | 'defer';
/** One enclosing control-flow branch. Outer frames combine with inner frames by AND (§6.3). */
export interface ControlFlowFrame {
  kind: ControlFlowKind;
  id: string;
  label: string;
  condition: string;
  notes: string[];
  span: Span | null;
  phase: DeferPhase | null;
  repeated: boolean;
  alias: string | null;
  defer: DeferInfo | null;
}
export interface IndexedLet { owner: Declaration; name: string; value: string; span: Span | null }
export interface UnsupportedRegion { ownerId: string; kind: string; reason: string; span: Span | null }
export interface TemplateIndex {
  elements: IndexedElement[];
  slots: IndexedSlot[];
  byOwner: Map<string, IndexedElement[]>;
  diagnostics: string[];
  verifiedMazeEdges: MazeEdge[];
  unmatchedMazeEdges: MazeEdge[];
  lets: IndexedLet[];
  unsupported: UnsupportedRegion[];
}
const slash = (s: string): string => s.replaceAll('\\', '/');

function rawOffsetMap(expression: { getStart(): number; getText(): string; text: string }): number[] | null {
  const raw = expression.getText();
  if (!['\'', '"', '`'].includes(raw[0] ?? '') || raw.at(-1) !== raw[0]) return null;
  const result: number[] = [];
  let cooked = '';
  for (let i = 1; i < raw.length - 1;) {
    const start = i;
    let value: string;
    if (raw[i] !== '\\') { value = raw[i]!; i++; }
    else {
      const escaped = raw[i + 1];
      if (escaped === undefined) return null;
      const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
      if (escaped === '\n') { i += 2; continue; }
      if (escaped === '\r') { i += raw[i + 2] === '\n' ? 3 : 2; continue; }
      if (escaped === 'u' && /^[a-fA-F0-9]{4}$/.test(raw.slice(i + 2, i + 6))) {
        value = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)); i += 6;
      } else if (escaped === 'x' && /^[a-fA-F0-9]{2}$/.test(raw.slice(i + 2, i + 4))) {
        value = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16)); i += 4;
      } else if (escaped in simple) { value = simple[escaped]!; i += 2; }
      else if (['\\', '\'', '"', '`', '$'].includes(escaped)) { value = escaped; i += 2; }
      else return null;
    }
    for (let j = 0; j < value.length; j++) result.push(expression.getStart() + start);
    cooked += value;
  }
  result.push(expression.getStart() + raw.length - 1);
  return cooked === expression.text ? result : null;
}

function selectorFor(context: AnalysisContext, element: TmplAstElement | TmplAstTemplate): InstanceType<typeof context.toolchain.angularCompiler.CssSelector> {
  const selector = new context.toolchain.angularCompiler.CssSelector();
  selector.setElement(element instanceof context.toolchain.angularCompiler.TmplAstElement ? element.name : element.tagName ?? 'ng-template');
  for (const attr of element.attributes) {
    selector.addAttribute(attr.name, attr.value);
    if (attr.name === 'class') for (const name of attr.value.split(/\s+/).filter(Boolean)) selector.addClassName(name);
  }
  for (const input of element.inputs) selector.addAttribute(input.name, '');
  for (const output of element.outputs) selector.addAttribute(output.name, '');
  if (element instanceof context.toolchain.angularCompiler.TmplAstTemplate) {
    for (const attr of element.templateAttrs) selector.addAttribute(attr.name, '');
  }
  return selector;
}

export async function indexTemplates(context: AnalysisContext, catalog: Catalog, maze?: MazeGraph): Promise<TemplateIndex> {
  const ng = context.toolchain.angularCompiler;
  const stopPropagation = (handler: AST): { definite: boolean; possible: boolean } => {
    let definite = false;
    let possible = false;
    const isAst = (value: unknown): value is AST => !!value && typeof value === 'object' &&
      'visit' in value && typeof value.visit === 'function';
    const visit = (node: AST, conditional: boolean): void => {
      const callee = node instanceof ng.Call ? node.receiver : null;
      if (callee instanceof ng.PropertyRead && ['stopPropagation', 'stopImmediatePropagation'].includes(callee.name) &&
        callee.receiver instanceof ng.PropertyRead && callee.receiver.name === '$event' &&
        callee.receiver.receiver instanceof ng.ImplicitReceiver) {
        possible = true;
        if (!conditional) definite = true;
      }
      if (node instanceof ng.Conditional) {
        visit(node.condition, conditional);
        visit(node.trueExp, true);
        visit(node.falseExp, true);
        return;
      }
      if (node instanceof ng.Binary) {
        visit(node.left, conditional);
        visit(node.right, true);
        return;
      }
      for (const value of Object.values(node)) {
        if (isAst(value)) visit(value, conditional);
        else if (Array.isArray(value)) for (const child of value) if (isAst(child)) visit(child, conditional);
      }
    };
    visit(handler, false);
    return { definite, possible };
  };
  const scopes = new ScopeResolver(catalog);
  const elements: IndexedElement[] = [];
  const slots: IndexedSlot[] = [];
  const byOwner = new Map<string, IndexedElement[]>();
  const diagnostics: string[] = [];
  const matchedMaze = new Set<MazeEdge>();
  const templateCache = new Map<string, string>();
  const lets: IndexedLet[] = [];
  const unsupported: UnsupportedRegion[] = [];
  for (const owner of catalog.declarations.values()) {
    if (owner.kind !== 'component' || owner.template.kind === 'none') continue;
    let source = owner.template.text;
    if (owner.template.kind === 'external') {
      const cached = templateCache.get(owner.template.file);
      if (cached !== undefined) source = cached;
      else {
        try { source = await readFile(owner.template.file, 'utf8'); templateCache.set(owner.template.file, source); await context.snapshot.recordIfExists(owner.template.file); }
        catch { diagnostics.push(`${owner.id}: missing template ${owner.template.file}`); continue; }
      }
    }
    const parsed = ng.parseTemplate(source, owner.template.file, { preserveWhitespaces: true });
    if (parsed.errors?.length) {
      diagnostics.push(`${owner.id}: template parse error: ${parsed.errors.map(error => error.msg).join(' | ')}`);
      continue;
    }
    const offsetMap = owner.template.kind === 'inline' && owner.template.expression ? rawOffsetMap(owner.template.expression) : null;
    if (owner.template.kind === 'inline' && !offsetMap) diagnostics.push(`${owner.id}: inline template offset cannot be mapped exactly`);
    const sourceFile = context.program.getSourceFile(owner.template.file);
    const map = (start: number, end: number): Span | null => {
      const mappedStart = owner.template.kind === 'inline' ? offsetMap?.[start] : start;
      const mappedEnd = owner.template.kind === 'inline' ? offsetMap?.[end] : end;
      if (mappedStart === undefined || mappedEnd === undefined) return null;
      const text = owner.template.kind === 'external' ? source : sourceFile?.text;
      if (!text) return null;
      const before = text.slice(0, mappedStart);
      const line = before.split('\n').length;
      const column = mappedStart - before.lastIndexOf('\n');
      const endLine = text.slice(0, Math.max(mappedStart, mappedEnd - 1)).split('\n').length;
      return { file: owner.template.file, start: mappedStart, end: mappedEnd, line, endLine, column };
    };
    const scope = scopes.scopeOf(owner);
    const matcher = new ng.SelectorMatcher<string>();
    for (const id of scope.ids) {
      const declaration = catalog.declarations.get(id) ?? catalog.external.get(id);
      if (!declaration?.selector || !['component', 'directive'].includes(declaration.kind)) continue;
      try { matcher.addSelectables(ng.CssSelector.parse(declaration.selector), id); }
      catch { diagnostics.push(`${id}: invalid Angular selector ${declaration.selector}`); }
    }
    const ownerElements: IndexedElement[] = [];
    const walk = (nodes: TmplAstNode[], parent: IndexedElement | null, frames: ControlFlowFrame[],
      fallbackSlot: IndexedSlot | null, inherited: Map<string, LexicalBinding> = new Map(), newView = true): void => {
      const repeated = frames.some(frame => frame.repeated);
      const lexical = newView ? new Map(inherited) : inherited;
      // References are visible within their view even before their element in source order.
      // Embedded templates and control-flow blocks start a distinct lexical view.
      const collectRefs = (items: TmplAstNode[]): void => {
        for (const item of items) {
          if (item instanceof ng.TmplAstElement || item instanceof ng.TmplAstTemplate) {
            for (const ref of item.references) if (!lexical.has(ref.name))
              lexical.set(ref.name, { kind: 'reference', value: ref.value, element: null });
            if (item instanceof ng.TmplAstElement) collectRefs(item.children);
          } else if (item instanceof ng.TmplAstContent) collectRefs(item.children);
        }
      };
      collectRefs(nodes);
      for (const node of nodes) {
        let current = parent;
        let localFallback = fallbackSlot;
        if (node instanceof ng.TmplAstContent) {
          const position = map(node.startSourceSpan.start.offset, node.startSourceSpan.end.offset);
          if (position) {
            localFallback = { owner, node, selector: node.selector, span: position, parent,
              order: slots.filter(slot => slot.owner.id === owner.id).length };
            slots.push(localFallback);
          }
        }
        if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate) {
          const position = map(node.startSourceSpan.start.offset, node.startSourceSpan.end.offset);
          if (position) {
            const matches = new Set<string>();
            matcher.match(selectorFor(context, node), (_selector, id) => { matches.add(id); });
            const components = [...matches].filter(id => (catalog.declarations.get(id) ?? catalog.external.get(id))?.kind === 'component');
            const directives = [...matches].filter(id => (catalog.declarations.get(id) ?? catalog.external.get(id))?.kind === 'directive');
            const directMatches = [...directives];
            for (const id of [...directives, ...components]) for (const host of catalog.declarations.get(id)?.hostDirectives ?? []) directives.push(host);
            const gaps: string[] = [];
            for (const input of node.inputs) {
              const text = source.slice(input.sourceSpan.start.offset, input.sourceSpan.end.offset);
              if (input.type === ng.BindingType.Attribute || text.includes('{{')) {
                gaps.push(`Dynamic or interpolated attribute ${input.name} is outside static matching`);
              }
            }
            if (components.length > 1) gaps.push(`Ambiguous component selectors: ${components.join(', ')}`);
            if (components.some(id => id.startsWith('external:'))) gaps.push('External component display boundary');
            for (const id of [...components, ...directMatches]) {
              const metadata = catalog.declarations.get(id);
              if (metadata) gaps.push(...metadata.gaps.filter(gap => gap.startsWith('hostDirectives:')));
            }
            if (!scope.complete) gaps.push(...scope.reasons);
            const component = components.length === 1 && scope.complete && !components[0]!.startsWith('external:') ? components[0]! : null;
            const relativeFile = slash(path.relative(context.workspaceRoot, position.file));
            const mazeEdge = component && maze?.edges.find(edge => edge.kind === 'template' && edge.from === owner.id &&
              edge.to === component && edge.location.file === relativeFile && edge.location.line === position.line &&
              edge.location.column === position.column);
            if (mazeEdge) matchedMaze.add(mazeEdge);
            const appliedInputs = new Map<string, string[]>();
            const appliedOutputs = new Map<string, string[]>();
            const addAliases = (id: string, inputs: Map<string, string>, outputs: Map<string, string>): void => {
              for (const [alias, member] of inputs) appliedInputs.set(alias, [...(appliedInputs.get(alias) ?? []), `${id}.${member}`]);
              for (const [alias, member] of outputs) appliedOutputs.set(alias, [...(appliedOutputs.get(alias) ?? []), `${id}.${member}`]);
            };
            for (const id of [...components, ...directMatches]) {
              const declaration = catalog.declarations.get(id) ?? catalog.external.get(id);
              if (declaration) addAliases(id, declaration.inputs, declaration.outputs);
              const local = catalog.declarations.get(id);
              if (local) {
                for (const [hostId, aliases] of local.hostDirectiveExposures) addAliases(hostId, aliases.inputs, aliases.outputs);
              }
            }
            const indexed: IndexedElement = {
              owner, node, tag: node instanceof ng.TmplAstElement ? node.name : node.tagName ?? 'ng-template', span: position,
              staticAttributes: new Map(node.attributes.map(attribute => [attribute.name, attribute.value])),
              boundAttributes: node.inputs.map(input => input.name),
              boundExpressions: new Map(node.inputs.map(input => [input.name,
                input.valueSpan ? source.slice(input.valueSpan.start.offset, input.valueSpan.end.offset) : ''])),
              boundSpans: new Map(node.inputs.flatMap(input => {
                const span = map(input.sourceSpan.start.offset, input.sourceSpan.end.offset);
                return span ? [[input.name, span] as const] : [];
              })),
              events: node.outputs.map(output => output.name),
              eventHandlers: node.outputs.map(output => source.slice(output.handlerSpan.start.offset, output.handlerSpan.end.offset)),
              eventStops: node.outputs.flatMap(output => {
                const stop = stopPropagation(output.handler);
                return stop.possible ? [{ event: output.name, definite: stop.definite }] : [];
              }),
              eventSpans: node.outputs.map(output => map(output.sourceSpan.start.offset, output.sourceSpan.end.offset)),
              references: node.references.map(ref => ref.name), lexical: new Map(lexical), repeated, parent, fallbackSlot: localFallback,
              component, directives: [...new Set(directives)],
              appliedInputs, appliedOutputs,
              origin: component ? mazeEdge ? 'ngmaze' : 'ng-wiring' : null, gaps,
              controlFlow: frames,
            };
            elements.push(indexed); ownerElements.push(indexed); current = indexed;
            for (const ref of node.references) {
              const binding = lexical.get(ref.name)?.kind === 'reference' ? lexical.get(ref.name)! :
                { kind: 'reference' as const, value: ref.value, element: null };
              binding.element = indexed;
              lexical.set(ref.name, binding);
              indexed.lexical.set(ref.name, binding);
            }
          }
        }
        descend(node, current, frames, localFallback, lexical);
      }
    };
    const at = (node: TmplAstNode): string => `${owner.id}@${node.sourceSpan.start.offset}`;
    const expressionText = (ast: unknown): string | null => {
      const source = (ast as { source?: unknown } | null | undefined)?.source;
      return typeof source === 'string' && source.trim() ? source.trim() : null;
    };
    const frame = (input: Partial<ControlFlowFrame> & Pick<ControlFlowFrame, 'kind' | 'id' | 'label' | 'condition'>,
      node: TmplAstNode): ControlFlowFrame => ({
      notes: [], span: map(node.sourceSpan.start.offset, node.sourceSpan.end.offset), phase: null,
      repeated: false, alias: null, defer: null, ...input,
    });
    const markUnsupported = (node: TmplAstNode, kind: string, reason: string): void => {
      const span = map(node.sourceSpan.start.offset, node.sourceSpan.end.offset);
      unsupported.push({ ownerId: owner.id, kind, reason, span });
      diagnostics.push(`${owner.id}: unsupported template node ${kind} at ${span ?
        `${slash(path.relative(context.workspaceRoot, span.file))}:${span.line}` : 'an unmapped offset'}: ${reason}`);
    };
    const deferTriggers = (block: InstanceType<typeof ng.TmplAstDeferredBlock>): DeferTrigger[] => {
      const groups: [DeferTriggerGroup, Record<string, unknown>][] = [['trigger', block.triggers],
        ['prefetch', block.prefetchTriggers], ['hydrate', block.hydrateTriggers]];
      const result: DeferTrigger[] = [];
      for (const [group, table] of groups) for (const [kind, trigger] of Object.entries(table ?? {})) {
        const delay = (trigger as { delay?: unknown }).delay;
        const detail = kind === 'when' ? expressionText((trigger as { value?: unknown }).value) :
          typeof delay === 'number' ? `${delay}ms` : (trigger as { reference?: string | null }).reference || null;
        const body = kind === 'when' ? `when ${detail ?? '(expression unresolved)'}` : `on ${kind}${detail ? `(${detail})` : ''}`;
        result.push({ group, kind, detail, text: `${group === 'trigger' ? '' : `${group} `}${body}` });
      }
      return result;
    };
    const descend = (node: TmplAstNode, current: IndexedElement | null, frames: ControlFlowFrame[],
      fallbackSlot: IndexedSlot | null, lexical: Map<string, LexicalBinding>): void => {
      if (node instanceof ng.TmplAstTemplate) {
        const fragment = new Map(lexical);
        for (const variable of node.variables) fragment.set(variable.name,
          { kind: 'fragment', value: variable.value, element: current });
        const loop = node.templateAttrs.find(attribute => attribute.name === 'ngForOf') ??
          node.templateAttrs.find(attribute => attribute.name === 'ngFor');
        if (!loop) { walk(node.children, current, frames, fallbackSlot, fragment); return; }
        const value = (loop as { valueSpan?: typeof loop.sourceSpan }).valueSpan ?? loop.sourceSpan;
        const subject = source.slice(value.start.offset, value.end.offset);
        walk(node.children, current, [...frames, frame({ kind: 'for', id: `for:${at(node)}`, label: `*ngFor (${subject})`,
          condition: `${subject} has at least one item`, repeated: true,
          notes: ['the iteration count is unknown and an individual row is not identified'] }, node)], fallbackSlot, fragment);
        return;
      }
      if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstContent) {
        walk(node.children, current, frames, fallbackSlot, lexical, false); return;
      }
      if (node instanceof ng.TmplAstIfBlock) {
        const preceding: string[] = [];
        for (const [order, branch] of node.branches.entries()) {
          const own = expressionText(branch.expression);
          // Every branch carries the negation of the branches declared before it (§6.3).
          const condition = [...preceding.map(item => `!(${item})`), ...(own ? [`(${own})`] : [])].join(' && ') || 'true';
          const alias = branch.expressionAlias?.name ?? null;
          const branchScope = new Map(lexical);
          if (alias) branchScope.set(alias, { kind: 'let', value: own ?? '', element: null });
          walk(branch.children, current, [...frames, frame({ kind: 'if', id: `if:${at(node)}#${order}`,
            label: order === 0 ? `@if (${own ?? 'true'})` : own ? `@else if (${own})` : '@else', condition, alias,
            notes: alias ? [`@if alias ${alias} holds the evaluated condition value`] : [] }, branch)], fallbackSlot, branchScope);
          if (own) preceding.push(own);
        }
        return;
      }
      if (node instanceof ng.TmplAstForLoopBlock) {
        const subject = expressionText(node.expression) ?? '(collection expression unresolved)';
        const track = expressionText(node.trackBy);
        const item = node.item?.name ?? '$implicit';
        const loopScope = new Map(lexical);
        loopScope.set(item, { kind: 'loop', value: '$implicit', element: null });
        for (const variable of node.contextVariables) loopScope.set(variable.name,
          { kind: 'loop', value: variable.value, element: null });
        walk(node.children, current, [...frames, frame({ kind: 'for', id: `for:${at(node)}`,
          label: `@for (${item} of ${subject}${track ? `; track ${track}` : ''})`,
          condition: `${subject} has at least one item`, repeated: true, alias: item,
          notes: ['the iteration count is unknown and an individual row is not identified'] }, node)], fallbackSlot, loopScope);
        // @empty is the complementary branch and is not repeated: the empty collection is kept as its own case.
        if (node.empty) walk(node.empty.children, current, [...frames, frame({ kind: 'for-empty', id: `for-empty:${at(node)}`,
          label: '@empty', condition: `${subject} is empty` }, node.empty)], fallbackSlot, lexical);
        return;
      }
      if (node instanceof ng.TmplAstSwitchBlock) {
        const subject = expressionText(node.expression) ?? '(switch expression unresolved)';
        const declared = node.groups.flatMap(group => group.cases.map(item => expressionText(item.expression)))
          .filter((item): item is string => item !== null);
        for (const [order, group] of node.groups.entries()) {
          const values = group.cases.map(item => expressionText(item.expression));
          const fallback = values.some(item => item === null);
          const matched = values.filter((item): item is string => item !== null);
          walk(group.children, current, [...frames, frame({ kind: 'switch', id: `switch:${at(node)}#${order}`,
            label: fallback ? `@switch (${subject}) @default` : `@switch (${subject}) @case (${matched.join(', ')})`,
            condition: fallback ? `${subject} matches no @case (${declared.join(', ') || 'none declared'})` :
              matched.map(value => `${subject} === ${value}`).join(' || ') }, group)], fallbackSlot, lexical);
        }
        for (const unknown of node.unknownBlocks ?? []) markUnsupported(unknown, `@${unknown.name}`, 'unknown block inside @switch');
        return;
      }
      if (node instanceof ng.TmplAstDeferredBlock) {
        const triggers = deferTriggers(node);
        const pick = (group: DeferTriggerGroup): DeferTrigger[] => triggers.filter(item => item.group === group);
        // Several triggers on one block combine by OR; the enclosing frames combine by AND (§6.3).
        const started = pick('trigger').map(item => item.text).join(' OR ') || 'on idle (Angular default)';
        const notes = ['a started @defer stays started: when turning false later does not return it to the unloaded state'];
        const prefetch = pick('prefetch');
        const hydrate = pick('hydrate');
        if (prefetch.length) notes.push(`${prefetch.map(item => item.text).join(' OR ')} loads dependencies without rendering this block`);
        if (hydrate.length) notes.push(`${hydrate.map(item => item.text).join(' OR ')} belongs to SSR hydration and is not a browser interaction path`);
        const defer: DeferInfo = { id: `defer:${at(node)}`, triggers,
          placeholderMinimumMs: node.placeholder?.minimumTime ?? null,
          loadingAfterMs: node.loading?.afterTime ?? null, loadingMinimumMs: node.loading?.minimumTime ?? null };
        const phase = (name: DeferPhase, label: string, condition: string, extra: string[], target: TmplAstNode):
        ControlFlowFrame => frame({ kind: 'defer', id: `${defer.id}#${name}`, label, condition, phase: name,
          notes: [...notes, ...extra], defer }, target);
        walk(node.children, current, [...frames, phase('main', `@defer (${started})`,
          `@defer ${defer.id} has started (${started})`, [], node)], fallbackSlot, lexical);
        if (node.placeholder) walk(node.placeholder.children, current, [...frames, phase('placeholder', '@placeholder',
          `@defer ${defer.id} has not started`, defer.placeholderMinimumMs === null ? [] :
            [`@placeholder stays for at least ${defer.placeholderMinimumMs}ms`], node.placeholder)], fallbackSlot, lexical);
        if (node.loading) walk(node.loading.children, current, [...frames, phase('loading', '@loading',
          `@defer ${defer.id} has started and its dependencies are still loading`,
          [...defer.loadingAfterMs === null ? [] : [`@loading appears after ${defer.loadingAfterMs}ms`],
            ...defer.loadingMinimumMs === null ? [] : [`@loading stays for at least ${defer.loadingMinimumMs}ms`]],
          node.loading)], fallbackSlot, lexical);
        if (node.error) walk(node.error.children, current, [...frames, phase('error', '@error',
          `@defer ${defer.id} failed to load its dependencies`, [], node.error)], fallbackSlot, lexical);
        return;
      }
      // @let defines a value in the surrounding scope; it is not a display branch (§6.3).
      if (node instanceof ng.TmplAstLetDeclaration) {
        lets.push({ owner, name: node.name, span: map(node.sourceSpan.start.offset, node.sourceSpan.end.offset),
          value: source.slice(node.valueSpan.start.offset, node.valueSpan.end.offset) });
        lexical.set(node.name, { kind: 'let', value: source.slice(node.valueSpan.start.offset, node.valueSpan.end.offset), element: null });
        return;
      }
      if (node instanceof ng.TmplAstText || node instanceof ng.TmplAstBoundText) return;
      if (node instanceof ng.TmplAstIcu) {
        markUnsupported(node, 'Icu', 'markup inside an ICU message is not indexed as elements'); return;
      }
      if (node instanceof ng.TmplAstUnknownBlock) { markUnsupported(node, `@${node.name}`, 'unknown template block'); return; }
      markUnsupported(node, node.constructor.name, 'unrecognized template AST node');
    };
    walk(parsed.nodes, null, [], null);
    byOwner.set(owner.id, ownerElements);
  }
  const verifiesOutlet = (edge: MazeEdge): boolean => {
    const host = elements.find(element => element.owner.id === edge.from &&
      element.boundSpans.get('ngComponentOutlet')?.line === edge.location.line &&
      element.boundSpans.get('ngComponentOutlet')?.column === edge.location.column &&
      slash(path.relative(context.workspaceRoot, element.span.file)) === edge.location.file &&
      element.boundExpressions.has('ngComponentOutlet'));
    if (!host) return false;
    const expression = host.boundExpressions.get('ngComponentOutlet')!.trim().replace(/^this\./, '');
    const member = host.owner.node.members.find(node =>
      context.toolchain.typescript.isPropertyDeclaration(node) && node.name.getText() === expression);
    const t = context.toolchain.typescript;
    if (!member || !t.isPropertyDeclaration(member) || !member.initializer) return false;
    const target = edge.to.slice(edge.to.lastIndexOf('#') + 1);
    const check = (node: import('typescript').Node): boolean => {
      if (t.isIdentifier(node)) {
        let symbol = context.checker.getSymbolAtLocation(node);
        if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
        if (symbol?.declarations?.some(declaration => t.isClassDeclaration(declaration) &&
          declaration.name?.text === target &&
          `${slash(path.relative(context.workspaceRoot, declaration.getSourceFile().fileName))}#${target}` === edge.to)) return true;
      }
      return t.forEachChild(node, check) ?? false;
    };
    return check(member.initializer);
  };
  const verifiedMazeEdges = maze?.edges.filter(edge => edge.kind === 'template' ? matchedMaze.has(edge) :
    edge.kind === 'ng-component-outlet' ? verifiesOutlet(edge) : true) ?? [];
  const unmatchedMazeEdges = maze?.edges.filter(edge => !verifiedMazeEdges.includes(edge)) ?? [];
  diagnostics.push(...unmatchedMazeEdges.map(edge => `${edge.from}: ngmaze ${edge.kind} edge to ${edge.to} was not confirmed at ${edge.location.file}:${edge.location.line}`));
  return { elements, slots, byOwner, diagnostics, verifiedMazeEdges, unmatchedMazeEdges, lets, unsupported };
}

export function matchingElements(index: TemplateIndex, target: { kind: 'attribute'; name: string; value: string } |
  { kind: 'source'; file: string; line: number }): IndexedElement[] {
  const matches = target.kind === 'attribute' ? index.elements.filter(element =>
    [...element.staticAttributes].some(([name, value]) => name.toLowerCase() === target.name.toLowerCase() &&
      value === target.value)) : index.elements.filter(element =>
    path.resolve(element.span.file) === path.resolve(target.file) &&
    element.span.line <= target.line && target.line <= element.span.endLine);
  // Custom structural microsyntax duplicates the host attributes on a synthetic Template node.
  // Keep the real element while retaining the established built-in directive candidates.
  return matches.filter(element => !matches.some(child => child !== element && child.parent === element &&
    element.node.constructor.name === 'Template' && child.span.start === element.span.start &&
    (element.node as TmplAstTemplate).templateAttrs.some(attribute =>
      !['ngIf', 'ngFor', 'ngForOf', 'ngSwitchCase', 'ngSwitchDefault'].includes(attribute.name))));
}
