import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { ControlFlowFrame, IndexedElement, IndexedSlot, Span, TemplateIndex } from '../../index/templates.js';
import type { MazeGraph } from '../../adapters/ng-maze/index.js';
import { resolveOutletPlacement, type RouteGraph, type RouteOccurrence } from './routes.js';
import type ts from 'typescript';

export type ViewRelation = 'element' | 'component-use' | 'projection-slot' | 'fragment-declaration' |
  'template-insertion' | 'structural-view' | 'control-flow' | 'dynamic-creation' | 'route-outlet' | 'bootstrap';
export interface ViewRouteRef {
  occurrenceId: string; pattern: string; outlet: string | null;
  definition: Span; anchor: Span; loaders: Span[]; rooted: boolean;
}
export interface ViewStep {
  number: string;
  relation: ViewRelation;
  ownerId: string;
  label: string;
  span: Span | null;
  displayParent: boolean;
  declarationOwnerId: string;
  expressionOwnerId: string;
  diOwnerId: string;
  diContextOverride: string | null;
  displayCondition: string | null;
  creationCondition: string | null;
  insertionContext: string | null;
  routeRef: ViewRouteRef | null;
  controlFlow: ControlFlowFrame | null;
  /** The creation call is separate from the unconfirmed display container. */
  callSite?: { file: string; line: number; column: number };
}
export interface ViewPath {
  steps: ViewStep[];
  declarationRefs: { ownerId: string; span: Span | null }[];
  end: 'root-unresolved' | 'unrendered' | 'projection-unresolved' | 'fragment-uninstantiated' | 'dynamic-boundary' |
  'route-unresolved' | 'bootstrap' | 'cycle' | 'limit';
  reason: string;
}
/** §6.3 initial finitization limits. */
export interface ViewLimits { depth: number; paths: number; states: number }
export const defaultViewLimits: ViewLimits = { depth: 200, paths: 1_000, states: 100_000 };
export interface ViewLimitReport extends ViewLimits {
  depthStops: number; pathStops: number; stateStops: number; unexplored: number;
}
export interface ViewResolution { paths: ViewPath[]; diagnostics: string[]; limits: ViewLimitReport }

function selectorMatches(context: AnalysisContext, selector: string, projected: IndexedElement): boolean {
  const ng = context.toolchain.angularCompiler;
  const matcher = new ng.SelectorMatcher<boolean>();
  try { matcher.addSelectables(ng.CssSelector.parse(selector), true); } catch { return false; }
  const projectedAs = projected.staticAttributes.get('ngProjectAs');
  let candidate: InstanceType<typeof ng.CssSelector>;
  if (projectedAs) {
    try { candidate = ng.CssSelector.parse(projectedAs)[0]!; }
    catch { return false; }
  } else {
    candidate = new ng.CssSelector();
    candidate.setElement(projected.tag);
    for (const [name, value] of projected.staticAttributes) {
      candidate.addAttribute(name, value);
      if (name === 'class') for (const part of value.split(/\s+/).filter(Boolean)) candidate.addClassName(part);
    }
    for (const name of projected.boundAttributes) candidate.addAttribute(name, '');
  }
  return matcher.match(candidate, null);
}

function slotFor(context: AnalysisContext, index: TemplateIndex, host: IndexedElement, projected: IndexedElement): IndexedSlot | null | 'unknown' {
  if (projected.boundAttributes.includes('ngProjectAs')) return 'unknown';
  const slots = index.slots.filter(slot => slot.owner.id === host.component).sort((a, b) => a.order - b.order);
  for (const slot of slots) if (slot.selector && slot.selector !== '*') {
    try { context.toolchain.angularCompiler.CssSelector.parse(slot.selector); }
    catch { return 'unknown'; }
  }
  for (const slot of slots) if (slot.selector && slot.selector !== '*' && selectorMatches(context, slot.selector, projected)) return slot;
  return slots.find(slot => !slot.selector || slot.selector === '*') ?? null;
}

function projectionChain(context: AnalysisContext, index: TemplateIndex, host: IndexedElement,
  projected: IndexedElement, active = new Set<IndexedElement>()): { steps: ViewStep[]; reason: string | null; unresolved: boolean } {
  if (active.has(host)) return { steps: [], reason: `Projection cycle at ${host.span.file}:${host.span.start}`, unresolved: true };
  active.add(host);
  const slot = slotFor(context, index, host, projected);
  if (slot === 'unknown') return { steps: [], reason: `Projection slot is unresolved in ${host.component}`, unresolved: true };
  if (!slot) return { steps: [], reason: `Projected content has no matching ng-content slot in ${host.component}`, unresolved: false };
  const projection = step('projection-slot', slot.owner.id, `ng-content${slot.selector ? ` select="${slot.selector}"` : ''}`,
    slot.span, true, `${host.span.file}:${host.span.start}`);
  projection.expressionOwnerId = projected.owner.id;
  projection.diOwnerId = projected.owner.id;
  projection.displayCondition = 'projection slot visible';
  projection.creationCondition = 'projected view created by declaration owner';
  const steps = [projection];
  for (let ancestor = slot.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.component) {
      const nested = projectionChain(context, index, ancestor, projected, active);
      if (nested.reason) return { steps: [...steps, ...nested.steps], reason: nested.reason, unresolved: nested.unresolved };
      steps.push(...nested.steps);
      const use = step('component-use', ancestor.owner.id, `${ancestor.owner.id} uses ${ancestor.component}`, ancestor.span);
      steps.push(use);
    } else if (ancestor.tag !== 'ng-container' && ancestor.tag !== 'ng-template') {
      steps.push(step('element', ancestor.owner.id, `<${ancestor.tag}>`, ancestor.span));
    }
  }
  active.delete(host);
  return { steps, reason: null, unresolved: false };
}

function hasProjectedContent(context: AnalysisContext, index: TemplateIndex, host: IndexedElement,
  targetSlot: IndexedSlot): boolean {
  if (index.elements.some(element => element.parent === host && slotFor(context, index, host, element) === targetSlot)) return true;
  for (const forwarding of index.slots.filter(slot => slot.parent === host)) {
    for (const use of index.elements.filter(element => element.component === forwarding.owner.id)) {
      for (const element of index.elements.filter(item => item.parent === use && slotFor(context, index, use, item) === forwarding)) {
        if (slotFor(context, index, host, element) === targetSlot) return true;
      }
    }
  }
  return false;
}

function step(relation: ViewRelation, ownerId: string, label: string, span: Span | null,
  displayParent = true, insertionContext: string | null = null): ViewStep {
  return { number: '', relation, ownerId, label, span, displayParent, declarationOwnerId: ownerId,
    expressionOwnerId: ownerId, diOwnerId: ownerId, diContextOverride: null,
    displayCondition: null, creationCondition: null, insertionContext, routeRef: null, controlFlow: null };
}

function finalize(steps: ViewStep[], end: ViewPath['end'], reason: string): ViewPath {
  const numbered = steps.map((item, index) => ({ ...item, number: String(index + 1).padStart(2, '0') }));
  const refs: ViewPath['declarationRefs'] = [];
  const seen = new Set<string>();
  for (const item of steps) if (!seen.has(item.declarationOwnerId)) {
    refs.push({ ownerId: item.declarationOwnerId, span: item.span }); seen.add(item.declarationOwnerId);
  }
  return { steps: numbered, declarationRefs: refs, end, reason };
}

function vcrInsertions(context: AnalysisContext, ownerId: string, reference: string,
  index: TemplateIndex): { span: Span; container: IndexedElement | null }[] {
  const t = context.toolchain.typescript;
  const owner = index.byOwner.get(ownerId)?.[0]?.owner;
  if (!owner) return [];
  const queries = new Map<string, string>();
  for (const member of owner.node.members) {
    if (!member.name || !t.isIdentifier(member.name)) continue;
    const calls: ts.CallExpression[] = [];
    for (const decorator of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
      if (t.isCallExpression(decorator.expression)) calls.push(decorator.expression);
    }
    if (t.isPropertyDeclaration(member) && member.initializer && t.isCallExpression(member.initializer)) calls.push(member.initializer);
    for (const call of calls) {
      const callee = t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
      if (!t.isIdentifier(callee) || !['ViewChild', 'ContentChild', 'viewChild', 'contentChild'].includes(callee.text)) continue;
      const argument = call.arguments[0];
      if (argument && t.isStringLiteralLike(argument)) queries.set(member.name.text, argument.text);
    }
  }
  const result: { span: Span; container: IndexedElement | null }[] = [];
  const visit = (node: ts.Node): void => {
    if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createEmbeddedView') {
      const receiver = node.expression.expression;
      const type = context.checker.getTypeAtLocation(receiver);
      const symbol = type.getSymbol();
      const angularVcr = symbol?.getName() === 'ViewContainerRef' && symbol.declarations?.some(d =>
        d.getSourceFile().fileName.includes('/node_modules/@angular/core/'));
      if (angularVcr) {
        const argument = node.arguments[0];
        const name = argument && t.isPropertyAccessExpression(argument) && argument.expression.kind === t.SyntaxKind.ThisKeyword
          ? queries.get(argument.name.text) : argument && t.isIdentifier(argument) ? queries.get(argument.text) ?? argument.text : undefined;
        if (name === reference) {
          const source = node.getSourceFile();
          const start = node.getStart(source);
          const point = source.getLineAndCharacterOfPosition(start);
          const containerName = t.isPropertyAccessExpression(receiver) && receiver.expression.kind === t.SyntaxKind.ThisKeyword
            ? queries.get(receiver.name.text) : undefined;
          const containers = containerName ? (index.byOwner.get(ownerId) ?? []).filter(item => item.references.includes(containerName)) : [];
          result.push({ span: { file: source.fileName, start, end: node.getEnd(), line: point.line + 1,
            endLine: source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1, column: point.character + 1 },
          container: containers.length === 1 ? containers[0]! : null });
        }
      }
    }
    t.forEachChild(node, visit);
  };
  visit(owner.node);
  return result;
}

function templateAliases(context: AnalysisContext, ownerId: string, reference: string,
  index: TemplateIndex): Set<string> {
  const aliases = new Set([reference]);
  const owner = index.byOwner.get(ownerId)?.[0]?.owner;
  if (!owner) return aliases;
  const t = context.toolchain.typescript;
  for (const member of owner.node.members) {
    if (!member.name || !t.isIdentifier(member.name)) continue;
    const calls: ts.CallExpression[] = [];
    for (const decorator of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
      if (t.isCallExpression(decorator.expression)) calls.push(decorator.expression);
    }
    if (t.isPropertyDeclaration(member) && member.initializer && t.isCallExpression(member.initializer)) calls.push(member.initializer);
    for (const call of calls) {
      const name = t.isPropertyAccessExpression(call.expression) ? call.expression.name.text :
        t.isIdentifier(call.expression) ? call.expression.text : '';
      if (!['ViewChild', 'ContentChild', 'viewChild', 'contentChild'].includes(name)) continue;
      if (call.arguments[0] && t.isStringLiteralLike(call.arguments[0]) && call.arguments[0].text === reference) aliases.add(member.name.text);
    }
  }
  const assignments: { left: string; right: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.EqualsToken &&
      t.isPropertyAccessExpression(node.left) && node.left.expression.kind === t.SyntaxKind.ThisKeyword) {
      const right = t.isPropertyAccessExpression(node.right) && node.right.expression.kind === t.SyntaxKind.ThisKeyword
        ? node.right.name.text : t.isIdentifier(node.right) ? node.right.text : undefined;
      if (right) assignments.push({ left: node.left.name.text, right });
    }
    t.forEachChild(node, visit);
  };
  visit(owner.node);
  for (let i = 0; i < assignments.length; i++) for (const assignment of assignments) {
    if (aliases.has(assignment.right)) aliases.add(assignment.left);
  }
  return aliases;
}

/** Only the PrimeNG Table slots whose receiver and TemplateRef query are verified. */
function externalTableSlot(context: AnalysisContext, catalog: Catalog, fragment: IndexedElement):
  { host: IndexedElement; slot: 'header' | 'body' } | null {
  const slot = fragment.references[0];
  if (slot !== 'header' && slot !== 'body') return null;
  const host = fragment.parent;
  if (!host || host.tag !== 'p-table') return null;
  const external = [...catalog.external.values()].find(item => item.kind === 'component' &&
    item.selector === 'p-table' && item.id.endsWith('#Table') && item.id.includes('/primeng/'));
  if (!external) return null;
  const marker = external.id.lastIndexOf('#');
  const source = context.program.getSourceFile(external.id.slice('external:'.length, marker));
  const t = context.toolchain.typescript;
  const declaration = source?.statements.find(item => t.isClassDeclaration(item) && item.name?.text === 'Table');
  if (!declaration || !t.isClassDeclaration(declaration)) return null;
  const member = declaration.members.find(item => item.name?.getText(source) === `${slot}Template`);
  if (!member || !member.getText(source).includes('TemplateRef<')) return null;
  const metadata = declaration.members.find(item => item.name?.getText(source) === 'ɵcmp');
  if (!metadata || !new RegExp(`["']${slot}Template["']`).test(metadata.getText(source))) return null;
  return { host, slot };
}

/** A local structural directive must actually insert its own TemplateRef. */
function structuralInsertion(context: AnalysisContext, catalog: Catalog, template: IndexedElement,
  branch: 'primary' | 'else' = 'primary'):
  { directive: string; condition: string; span: Span } | null {
  const t = context.toolchain.typescript;
  for (const id of template.directives) {
    const declaration = catalog.declarations.get(id);
    if (!declaration || declaration.kind !== 'directive') continue;
    const selector = declaration.selector?.match(/^\[([^\]]+)\]$/)?.[1];
    const attrs = (template.node as IndexedElement['node'] & {
      templateAttrs?: { name: string; value?: { source?: string } }[] }).templateAttrs ?? [];
    if (!selector || !attrs.some(item => item.name === selector)) continue;
    const ctor = declaration.node.members.find(t.isConstructorDeclaration);
    const templateNames = new Set<string>();
    const containerNames = new Set<string>();
    for (const parameter of ctor?.parameters ?? []) {
      const type = parameter.type?.getText() ?? '';
      if (type.startsWith('TemplateRef')) templateNames.add(parameter.name.getText());
      if (type.startsWith('ViewContainerRef')) containerNames.add(parameter.name.getText());
    }
    for (const member of declaration.node.members) if (t.isPropertyDeclaration(member) && member.name) {
      if (branch === 'else' && member.type?.getText().startsWith('TemplateRef'))
        templateNames.add(member.name.getText());
      const call = member.initializer;
      if (!call || !t.isCallExpression(call) || !t.isIdentifier(call.expression)) continue;
      if (call.expression.text !== 'inject') continue;
      if (call.arguments[0]?.getText() === 'TemplateRef') templateNames.add(member.name.getText());
      if (call.arguments[0]?.getText() === 'ViewContainerRef') containerNames.add(member.name.getText());
    }
    if (branch === 'else' && !attrs.some(item => item.name === `${selector}Else`)) continue;
    if (branch === 'else' && !declaration.node.members.some(member => t.isSetAccessorDeclaration(member) &&
      member.name.getText() === `${selector}Else`)) continue;
    if (!templateNames.size || !containerNames.size) continue;
    let found: { directive: string; condition: string; span: Span } | null = null;
    const visit = (node: ts.Node, conditions: string[]): void => {
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'createEmbeddedView' &&
        containerNames.has(node.expression.expression.getText().replace(/^this\./, '')) &&
        node.arguments[0] && templateNames.has(node.arguments[0].getText().replace(/^this\./, '')) &&
        (branch === 'else') === node.arguments[0].getText().replace(/^this\./, '').toLowerCase().includes('else')) {
        const source = node.getSourceFile();
        const start = node.getStart(source);
        const point = source.getLineAndCharacterOfPosition(start);
        const input = attrs.find(item => item.name === selector)?.value?.source;
        found = { directive: selector,
          condition: [input ? `${selector}(${input})` : selector, ...conditions].join(' && '),
          span: { file: source.fileName, start, end: node.getEnd(), line: point.line + 1,
            endLine: source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1, column: point.character + 1 } };
      }
      if (t.isIfStatement(node)) {
        visit(node.thenStatement, [...conditions, node.expression.getText()]);
        if (node.elseStatement) visit(node.elseStatement, [...conditions, `!(${node.expression.getText()})`]);
      } else t.forEachChild(node, child => visit(child, conditions));
    };
    visit(declaration.node, []);
    if (found) return found;
  }
  return null;
}

function portalOutlet(context: AnalysisContext, catalog: Catalog, componentId: string): boolean {
  const owner = catalog.declarations.get(componentId);
  if (!owner) return false;
  const source = owner.node.getSourceFile();
  const text = owner.node.getText(source);
  return /\bnew\s+DomPortalOutlet\s*\(/.test(text) && /\.attach\s*\(/.test(text) &&
    source.text.includes("from '@angular/cdk/portal'");
}

function routeStepFor(occurrence: RouteOccurrence, ownerId: string): ViewStep {
  const name = occurrence.outlet ? ` name="${occurrence.outlet}"` : '';
  const placement = step('route-outlet', ownerId, `route ${occurrence.pattern} places ${ownerId} in <router-outlet${name}>`,
    occurrence.definition, true, occurrence.id);
  placement.creationCondition = 'route activation';
  placement.displayCondition = occurrence.conditions.map(condition => condition.text).join('; ') || 'route matches the URL';
  placement.routeRef = { occurrenceId: occurrence.id, pattern: occurrence.pattern, outlet: occurrence.outlet,
    definition: occurrence.definition, anchor: occurrence.anchor, loaders: occurrence.loaders, rooted: occurrence.rooted };
  return placement;
}

/** Frames introduced between an element and its display parent, outermost first. */
function ownControlFlow(element: IndexedElement): ControlFlowFrame[] {
  const outer = element.parent?.controlFlow ?? [];
  let shared = 0;
  while (shared < outer.length && shared < element.controlFlow.length && outer[shared] === element.controlFlow[shared]) shared++;
  return element.controlFlow.slice(shared);
}

function controlFlowSteps(element: IndexedElement): ViewStep[] {
  const created: Record<ControlFlowFrame['kind'], string> = {
    if: 'embedded view created while this branch is selected',
    for: 'one embedded view per item; individual rows are not identified',
    'for-empty': 'embedded view created while the collection is empty',
    switch: 'embedded view created while this case is selected',
    defer: 'deferred view created for this phase',
  };
  // Innermost first: steps run from the element towards the root.
  return ownControlFlow(element).reverse().map(frame => {
    const item = step('control-flow', element.owner.id, frame.label, frame.span, false);
    item.displayCondition = [frame.condition, ...frame.notes].join('; ');
    item.creationCondition = frame.phase && frame.phase !== 'main'
      ? `${frame.phase} view created for ${frame.defer?.id ?? 'the @defer block'}` : created[frame.kind];
    item.controlFlow = frame;
    return item;
  });
}

/** §6.3 cycle key: no growing ancestor array, and the same class at another use stays distinct. */
function cycleKey(context: AnalysisContext, element: IndexedElement, relation: ViewRelation, insertion: string): string {
  return [context.id, element.owner.id, `${element.span.file}:${element.span.start}-${element.span.end}`,
    relation, insertion].join('|');
}

export function resolveViewPaths(target: IndexedElement, context: AnalysisContext, catalog: Catalog,
  index: TemplateIndex, limit: number | Partial<ViewLimits> = {}, maze?: MazeGraph, routes?: RouteGraph): ViewResolution {
  const limits: ViewLimits = { ...defaultViewLimits, ...typeof limit === 'number' ? { paths: limit } : limit };
  const report: ViewLimitReport = { ...limits, depthStops: 0, pathStops: 0, stateStops: 0, unexplored: 0 };
  const diagnostics: string[] = [];
  const paths: ViewPath[] = [];
  type State = { current: IndexedElement; steps: ViewStep[]; keys: Set<string>; depth: number;
    routeIds: Set<string>; relation: ViewRelation; insertion: string; anchor?: boolean };
  const stack: State[] = [{ current: target, steps: [], keys: new Set(), depth: 0, routeIds: new Set(),
    relation: 'element', insertion: 'none' }];
  let states = 0;
  const stop = (kind: 'depth' | 'paths' | 'states', state: State, reason: string): void => {
    report[`${kind === 'depth' ? 'depth' : kind === 'paths' ? 'path' : 'state'}Stops`]++;
    diagnostics.push(reason);
    paths.push(finalize(state.steps, 'limit', reason));
  };
  while (stack.length) {
    const state = stack.pop()!;
    const current = state.current;
    const where = `${current.owner.id} at ${current.span.file}:${current.span.line}`;
    if (states >= limits.states) {
      report.unexplored += stack.length + 1;
      stop('states', state, `View expansion stopped after ${limits.states} states at ${where}; ${stack.length + 1} branches were not enumerated`);
      break;
    }
    states++;
    const key = cycleKey(context, current, state.relation, state.insertion);
    if (state.keys.has(key)) {
      // The boundary is reported once; the other non-cyclic branches keep being enumerated (§6.3).
      paths.push(finalize(state.steps, 'cycle', `Recursion boundary: ${where} is re-entered through ${state.relation}`));
      continue;
    }
    if (state.depth >= limits.depth) {
      report.unexplored += 1;
      stop('depth', state, `Parent path depth limit ${limits.depth} reached at ${where}`);
      continue;
    }
    if (paths.length >= limits.paths) {
      report.unexplored += stack.length + 1;
      stop('paths', state, `Candidate limit ${limits.paths} reached at ${where}; ${stack.length + 1} branches were not enumerated`);
      break;
    }
    const keys = new Set(state.keys); keys.add(key);
    const routeIds = state.routeIds;
    const insertion = state.insertion;
    const steps = [...state.steps];
    // A routed component is a sibling of its <router-outlet> anchor, so the anchor is not a display ancestor.
    if (!state.anchor && current.node.constructor.name !== 'Template' &&
      current.tag !== 'ng-container' && current.tag !== 'ng-template') {
      const entry = step('element', current.owner.id, `<${current.tag}>`, current.span);
      if (current.repeated) entry.displayCondition = '@for iteration exists; individual row is not identified';
      steps.push(entry);
    }
    steps.push(...controlFlowSteps(current));
    if (current.parent) {
      const parent = current.parent;
      if (parent.component) {
        if (portalOutlet(context, catalog, parent.component)) {
          const outletId = parent.staticAttributes.get('outletId') ?? parent.boundExpressions.get('outletId') ?? 'unknown';
          const movement = step('template-insertion', parent.component,
            `DomPortalOutlet.attach → #${outletId}`, parent.span, false);
          movement.displayCondition = 'portal attached after render';
          movement.creationCondition = 'projected content created in declaration context';
          paths.push(finalize([...steps, movement], 'dynamic-boundary',
            `Portal DOM destination #${outletId} is not confirmed as a display parent`));
          continue;
        }
        let projected = current;
        while (projected.parent && projected.parent !== parent) projected = projected.parent;
        const chain = projectionChain(context, index, parent, projected);
        if (chain.reason) {
          const reason = chain.reason;
          diagnostics.push(reason); paths.push(finalize(steps, chain.unresolved ? 'projection-unresolved' : 'unrendered', reason)); continue;
        }
        stack.push({ current: parent, steps: [...steps, ...chain.steps], keys, depth: state.depth + 1, routeIds,
          relation: 'projection-slot', insertion: `${parent.span.file}:${parent.span.start}` });
        continue;
      }
      if (parent.node.constructor.name === 'Template') {
        const isExplicit = parent.tag === 'ng-template';
        if (isExplicit) {
          const reference = parent.references[0];
          const aliases = reference ? templateAliases(context, parent.owner.id, reference, index) : new Set<string>();
          const directInsertions = reference ? (index.byOwner.get(parent.owner.id) ?? []).filter(element => {
            const expression = element.boundExpressions.get('ngTemplateOutlet')?.trim().replace(/^this\./, '');
            return expression !== undefined && aliases.has(expression);
          }) : [];
          const crossInsertions: IndexedElement[] = [];
          if (reference) for (const use of index.byOwner.get(parent.owner.id) ?? []) {
            if (!use.component) continue;
            const child = catalog.declarations.get(use.component);
            if (!child) continue;
            for (const [alias, expression] of use.boundExpressions) {
              if (expression.trim() !== reference) continue;
              const member = child.inputs.get(alias);
              if (!member) continue;
              crossInsertions.push(...(index.byOwner.get(child.id) ?? []).filter(element =>
                [member, `this.${member}`].includes(element.boundExpressions.get('ngTemplateOutlet')?.trim() ?? '')));
            }
          }
          const insertions = [...new Set([...directInsertions, ...crossInsertions])];
          const vcr = reference ? vcrInsertions(context, parent.owner.id, reference, index) : [];
          const external = externalTableSlot(context, catalog, parent);
          const structuralElse = reference ? (index.byOwner.get(parent.owner.id) ?? []).flatMap(element => {
            if (element.node.constructor.name !== 'Template') return [];
            const attrs = (element.node as IndexedElement['node'] & {
              templateAttrs?: { name: string; value?: { source?: string } }[] }).templateAttrs ?? [];
            if (!attrs.some(attr => attr.name.endsWith('Else') && attr.value?.source?.trim() === reference)) return [];
            const verified = structuralInsertion(context, catalog, element, 'else');
            return verified ? [{ host: element, verified }] : [];
          }) : [];
          if (!insertions.length && !vcr.length && !external && !structuralElse.length) {
            const reason = `TemplateRef ${reference ?? '(unnamed)'} has no confirmed insertion`;
            diagnostics.push(reason); paths.push(finalize([...steps, step('fragment-declaration', parent.owner.id, 'ng-template', parent.span, false)],
              'fragment-uninstantiated', reason)); continue;
          }
          if (external) {
            const fragment = step('fragment-declaration', parent.owner.id, `#${external.slot}`, parent.span, false);
            const placement = step('template-insertion', parent.owner.id,
              `PrimeNG Table ${external.slot}Template`, external.host.span, true,
              `${external.host.span.file}:${external.host.span.start}`);
            placement.displayCondition = external.slot === 'body'
              ? 'p-table renders a row for each available item' : 'p-table renders its header';
            placement.creationCondition = `p-table receives #${external.slot} content template`;
            const variables = (parent.node as IndexedElement['node'] & { variables?: { name: string; value: string }[] }).variables ?? [];
            placement.insertionContext = `#${external.slot}${variables.length ? `: ${variables.map(variable =>
              `${variable.name}<-${variable.value || '$implicit'}`).join(', ')}` : ''}`;
            stack.push({ current: external.host, steps: [...steps, fragment, placement], keys,
              depth: state.depth + 1, routeIds, relation: 'template-insertion',
              insertion: `${external.host.span.file}:${external.host.span.start}` });
          }
          for (const insertion of insertions) {
            const fragment = step('fragment-declaration', parent.owner.id, `#${reference}`, parent.span, false);
            const variables = (parent.node as IndexedElement['node'] & { variables?: { name: string; value: string }[] }).variables ?? [];
            const placement = step('template-insertion', insertion.owner.id, `NgTemplateOutlet(${reference})`, insertion.span, true,
              `${insertion.span.file}:${insertion.span.start}`);
            placement.expressionOwnerId = parent.owner.id;
            placement.diOwnerId = parent.owner.id;
            placement.diContextOverride = insertion.boundExpressions.get('ngTemplateOutletInjector') ?? null;
            placement.displayCondition = 'NgTemplateOutlet creates embedded view';
            placement.creationCondition = 'fragment declaration exists';
            placement.insertionContext = variables.length ? `${variables.map(variable =>
              `${variable.name}<-${variable.value || '$implicit'}`).join(', ')}; ${insertion.boundExpressions.get('ngTemplateOutletContext') ?? 'context unknown'}` :
              insertion.boundExpressions.get('ngTemplateOutletContext') ?? null;
            if (placement.diContextOverride) diagnostics.push(`DI context overridden at ${insertion.span.file}:${insertion.span.line}`);
            stack.push({ current: insertion, steps: [...steps, fragment, placement], keys, depth: state.depth + 1, routeIds,
              relation: 'template-insertion', insertion: `${insertion.span.file}:${insertion.span.start}` });
          }
          for (const insertion of vcr) {
            const fragment = step('fragment-declaration', parent.owner.id, `#${reference}`, parent.span, false);
            const placement = step('template-insertion', parent.owner.id, `ViewContainerRef.createEmbeddedView(#${reference})`,
              insertion.span, !!insertion.container, `${insertion.span.file}:${insertion.span.start}`);
            placement.displayCondition = 'createEmbeddedView call executes';
            placement.creationCondition = 'fragment declaration exists';
            if (insertion.container) stack.push({ current: insertion.container, steps: [...steps, fragment, placement], keys,
              depth: state.depth + 1, routeIds, relation: 'template-insertion',
              insertion: `${insertion.span.file}:${insertion.span.start}` });
            else paths.push(finalize([...steps, fragment, placement], 'dynamic-boundary', 'ViewContainerRef location is unresolved'));
          }
          for (const { host, verified } of structuralElse) {
            const fragment = step('fragment-declaration', parent.owner.id, `#${reference}`, parent.span, false);
            const structural = step('structural-view', host.owner.id,
              `*${verified.directive} → ViewContainerRef.createEmbeddedView(else)`, verified.span, false);
            structural.displayCondition = `${verified.directive}: ${verified.condition}`;
            structural.creationCondition = 'directive inserts its else TemplateRef';
            stack.push({ current: host, steps: [...steps, fragment, structural], keys, depth: state.depth + 1, routeIds,
              relation: 'structural-view', insertion: `${host.span.file}:${host.span.start}` });
          }
          continue;
        }
        const template = parent.node as IndexedElement['node'] & { templateAttrs?: { name: string }[] };
        const knownStructural = template.templateAttrs?.some(attr =>
          ['ngIf', 'ngFor', 'ngForOf', 'ngSwitchCase', 'ngSwitchDefault'].includes(attr.name));
        if (!knownStructural) {
          const verified = structuralInsertion(context, catalog, parent);
          if (verified) {
            const structural = step('structural-view', parent.owner.id,
              `*${verified.directive} → ViewContainerRef.createEmbeddedView`, verified.span, false);
            structural.displayCondition = `${verified.directive}: ${verified.condition}`;
            structural.creationCondition = 'directive inserts its TemplateRef';
            stack.push({ current: parent, steps: [...steps, structural], keys, depth: state.depth + 1,
              routeIds, relation: 'structural-view', insertion });
            continue;
          }
          const reason = `Custom structural directive insertion is unresolved at ${parent.span.file}:${parent.span.line}`;
          diagnostics.push(reason);
          paths.push(finalize(steps, 'fragment-uninstantiated', reason));
          continue;
        }
        const structural = step('structural-view', parent.owner.id, `*${parent.tag}`, parent.span, false);
        structural.displayCondition = [...parent.boundAttributes, ...(template.templateAttrs ?? []).map(attr => attr.name)].join(', ');
        steps.push(structural);
        stack.push({ current: parent, steps, keys, depth: state.depth + 1, routeIds,
          relation: 'structural-view', insertion });
        continue;
      }
      stack.push({ current: parent, steps, keys, depth: state.depth + 1, routeIds, relation: 'element', insertion });
      continue;
    }
    const uses = index.elements.filter(element => element.component === current.owner.id);
    const dynamic = maze?.edges.filter(edge => edge.to === current.owner.id && edge.kind !== 'template') ?? [];
    for (const edge of dynamic) {
      const relation = step('dynamic-creation', edge.from, `${edge.kind} creates ${edge.to}`, null, false);
      relation.callSite = { file: edge.location.file, line: edge.location.line, column: edge.location.column };
      relation.creationCondition = 'runtime creation call executes';
      relation.displayCondition = 'render container or overlay parent unresolved';
      paths.push(finalize([...steps, relation], 'dynamic-boundary', `Dynamic display container is not confirmed for ${edge.to}`));
    }
    const external = maze?.externalUsages.filter(usage => usage.target === current.owner.id) ?? [];
    for (const usage of external) {
      const relation = step('dynamic-creation', `external:${usage.callerName}`, `${usage.kind} creates ${usage.target}`,
        null, false);
      relation.creationCondition = 'external caller executes';
      relation.displayCondition = 'external library wrapper and display container unresolved';
      paths.push(finalize([...steps, relation], 'dynamic-boundary', `External caller ${usage.callerName} is a display boundary`));
    }
    const occurrences = routes?.byComponent.get(current.owner.id) ?? [];
    for (const occurrence of occurrences) {
      if (routeIds.has(occurrence.id)) {
        paths.push(finalize([...steps, routeStepFor(occurrence, current.owner.id)], 'cycle',
          `Route cycle at ${occurrence.pattern}`));
        continue;
      }
      for (const placement of resolveOutletPlacement(context, routes!, index, occurrence)) {
        const entry = routeStepFor(occurrence, current.owner.id);
        if (placement.kind === 'unresolved') {
          diagnostics.push(placement.reason);
          paths.push(finalize([...steps, entry], 'route-unresolved', placement.reason));
          continue;
        }
        entry.ownerId = placement.hostId;
        entry.declarationOwnerId = placement.hostId;
        entry.expressionOwnerId = current.owner.id;
        entry.diOwnerId = current.owner.id;
        if (placement.conditions.length) entry.displayCondition = `${entry.displayCondition}; ${placement.conditions.join('; ')}`;
        stack.push({ current: placement.element, steps: [...steps, entry], keys,
          depth: state.depth + 1, routeIds: new Set([...routeIds, occurrence.id]), anchor: true,
          relation: 'route-outlet', insertion: occurrence.id });
      }
    }
    const bootstraps = routes?.bootstrapByComponent.get(current.owner.id) ?? [];
    for (const bootstrap of bootstraps) {
      const entry = step('bootstrap', bootstrap.id, `${bootstrap.id} bootstraps ${current.owner.id}`, bootstrap.span, false);
      entry.creationCondition = 'application bootstrap';
      entry.displayCondition = `${bootstrap.kind === 'module' ? 'bootstrapModule' : 'bootstrapApplication'} runs for entry ${bootstrap.entry}`;
      paths.push(finalize([...steps, entry], 'bootstrap', `Bootstrapped from ${bootstrap.entry}`));
    }
    if (!uses.length) {
      if (dynamic.length || external.length || occurrences.length || bootstraps.length) continue;
      const declaration = catalog.declarations.get(current.owner.id);
      const reason = declaration ? `No confirmed display use for ${current.owner.id}` : `Unknown declaration ${current.owner.id}`;
      paths.push(finalize(steps, 'root-unresolved', reason)); continue;
    }
    let fallbackVisible = false;
    for (const use of uses) {
      if (target.fallbackSlot) {
        if (hasProjectedContent(context, index, use, target.fallbackSlot)) continue;
        fallbackVisible = true;
      }
      const relation = step('component-use', use.owner.id, `${use.owner.id} uses ${current.owner.id}`, use.span);
      relation.expressionOwnerId = use.owner.id;
      relation.diOwnerId = use.owner.id;
      if (target.fallbackSlot) relation.displayCondition = 'ng-content fallback when no projected content matches';
      stack.push({ current: use, steps: [...steps, relation], keys, depth: state.depth + 1, routeIds,
        relation: 'component-use', insertion });
    }
    if (target.fallbackSlot && !fallbackVisible) {
      const reason = `ng-content fallback is suppressed by projected content in ${current.owner.id}`;
      diagnostics.push(reason); paths.push(finalize(steps, 'unrendered', reason));
    }
  }
  if (!paths.length) paths.push(finalize([], 'root-unresolved', 'No display path'));
  return { paths, diagnostics, limits: report };
}
