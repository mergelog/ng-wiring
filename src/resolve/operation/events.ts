import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { ViewPath } from '../view/index.js';
import { getProperty } from '../../index/catalog.js';

/** DOM/UI Events baseline used by Angular 22 analysis. Unknown events stay unknown. */
export const uiEventsVersion = 'ui-events-2026-09-24';
export const uiEvents: Readonly<Record<string, { bubbles: boolean; composed: boolean }>> = Object.freeze({
  click: { bubbles: true, composed: true }, dblclick: { bubbles: true, composed: true },
  input: { bubbles: true, composed: true }, change: { bubbles: true, composed: false },
  keydown: { bubbles: true, composed: true }, keyup: { bubbles: true, composed: true },
  mouseover: { bubbles: true, composed: true }, mouseout: { bubbles: true, composed: true },
  focusin: { bubbles: true, composed: true }, focusout: { bubbles: true, composed: true },
  focus: { bubbles: false, composed: true }, blur: { bubbles: false, composed: true },
  mouseenter: { bubbles: false, composed: false }, mouseleave: { bubbles: false, composed: false },
});

export interface EventListener {
  selectedElement: IndexedElement;
  listenerElement: IndexedElement | null;
  eventSource: 'selected-dom' | 'component-output' | 'directive-output' | 'global' | 'host-dom' | 'unknown-dom';
  eventName: string;
  modifiers: string[];
  subscription: string | null;
  handler: string;
  span: Span | null;
  conditions: string[];
  status: 'candidate' | 'conditional' | 'unresolved';
  registration: 'template' | 'host' | 'capture';
}
export interface EventResolution {
  listeners: EventListener[];
  outputSubscriptions: EventListener[];
  derivedEvents: { from: string; to: string; status: 'boundary'; reason: string }[];
  diagnostics: string[];
}

function outputProducer(context: AnalysisContext, catalog: Catalog, index: TemplateIndex,
  subscription: string): { conditions: string[]; diagnostic: string | null } {
  const marker = subscription.lastIndexOf('.');
  if (marker < 0) return { conditions: [], diagnostic: null };
  const ownerId = subscription.slice(0, marker), output = subscription.slice(marker + 1);
  const owner = catalog.declarations.get(ownerId);
  if (!owner || !owner.outputs.has(output)) return { conditions: [], diagnostic: null };
  const t = context.toolchain.typescript;
  const sites: { method: string; guards: string[] }[] = [];
  for (const member of owner.node.members) {
    if (!t.isMethodDeclaration(member) || !member.body || !member.name) continue;
    const scan = (node: import('typescript').Node): void => {
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'emit' && t.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.expression.kind === t.SyntaxKind.ThisKeyword &&
        node.expression.expression.name.text === output) {
        const guards: string[] = [];
        for (let parent = node.parent; parent && parent !== member; parent = parent.parent) {
          if (t.isIfStatement(parent)) guards.push(
            parent.thenStatement.pos <= node.pos && node.end <= parent.thenStatement.end
              ? `if ${parent.expression.getText()}` : `else of ${parent.expression.getText()}`);
        }
        sites.push({ method: member.name.getText(), guards });
      }
      t.forEachChild(node, scan);
    };
    scan(member.body);
  }
  if (sites.length !== 1) return { conditions: [], diagnostic: null };
  const site = sites[0]!;
  const buttons = (index.byOwner.get(ownerId) ?? []).filter(element => element.tag === 'button' &&
    element.node.outputs.some((event, position) => event.name === 'click' &&
      element.eventHandlers[position]?.trim() === `${site.method}()`));
  return { conditions: [`${ownerId}.${site.method}() executes`, ...site.guards],
    diagnostic: buttons.length ? `${ownerId}: <button> click calls ${site.method}(); this is a separate operation from the selected input` : null };
}

function baseName(event: string): string { return event.split('.')[0]!; }
function hostEvents(context: AnalysisContext, catalog: Catalog, element: IndexedElement): { event: string; handler: string; subscription: string }[] {
  const t = context.toolchain.typescript;
  const result: { event: string; handler: string; subscription: string }[] = [];
  for (const id of [element.component, ...element.directives].filter((id): id is string => !!id)) {
    const declaration = catalog.declarations.get(id);
    if (!declaration) continue;
    const host = declaration.metadata.properties.find(part => t.isPropertyAssignment(part) && part.name.getText().replaceAll(/["']/g, '') === 'host');
    if (host && t.isPropertyAssignment(host) && t.isObjectLiteralExpression(host.initializer)) {
      for (const part of host.initializer.properties) if (t.isPropertyAssignment(part)) {
        const event = part.name.getText().replaceAll(/["'()]/g, '');
        if (part.name.getText().includes('(')) result.push({ event, handler: part.initializer.getText(), subscription: id });
      }
    }
    const seen = new Set<import('typescript').ClassDeclaration>();
    const scan = (node: import('typescript').ClassDeclaration): void => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const member of node.members) for (const decorator of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
        if (!t.isCallExpression(decorator.expression)) continue;
        const callee = decorator.expression.expression;
        if (!t.isIdentifier(callee) || callee.text !== 'HostListener') continue;
        const arg = decorator.expression.arguments[0];
        if (arg && t.isStringLiteralLike(arg)) result.push({ event: arg.text, handler: member.name?.getText() ?? '', subscription: id });
      }
      for (const heritage of node.heritageClauses ?? []) if (heritage.token === t.SyntaxKind.ExtendsKeyword)
        for (const base of heritage.types) {
          let symbol = context.checker.getSymbolAtLocation(base.expression);
          if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
          const parent = symbol?.declarations?.find(t.isClassDeclaration);
          if (parent) scan(parent);
        }
    };
    scan(declaration.node);
  }
  return result;
}

function captureListeners(selected: IndexedElement, context: AnalysisContext, eventFilter?: string): EventListener[] {
  const t = context.toolchain.typescript;
  const result: EventListener[] = [];
  const isHostRef = (node: import('typescript').Expression): boolean => {
    if (!t.isPropertyAccessExpression(node) || node.name.text !== 'nativeElement') return false;
    const receiver = node.expression;
    const name = t.isPropertyAccessExpression(receiver) && receiver.expression.kind === t.SyntaxKind.ThisKeyword
      ? receiver.name.text : t.isIdentifier(receiver) ? receiver.text : null;
    if (!name) return false;
    const field = selected.owner.node.members.find(member => t.isPropertyDeclaration(member) && member.name.getText() === name);
    if (!field || !t.isPropertyDeclaration(field) || !field.initializer || !t.isCallExpression(field.initializer)) return false;
    const call = field.initializer;
    if (!t.isIdentifier(call.expression) || call.expression.text !== 'inject') return false;
    const token = call.arguments[0];
    if (!token || !t.isIdentifier(token) || token.text !== 'ElementRef') return false;
    const angularSymbol = (name: import('typescript').Identifier): boolean => {
      let symbol = context.checker.getSymbolAtLocation(name);
      if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
      return !!symbol?.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll('\\', '/')
        .includes('/node_modules/@angular/core/'));
    };
    return angularSymbol(call.expression) && angularSymbol(token);
  };
  const scan = (node: import('typescript').Node): void => {
    if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addEventListener') {
      const [nameNode, handler, options] = node.arguments;
      if (nameNode && t.isStringLiteralLike(nameNode) && handler) {
        if (eventFilter && nameNode.text !== eventFilter && baseName(nameNode.text) !== eventFilter) return;
        const capture = options?.kind === t.SyntaxKind.TrueKeyword || !!options && t.isObjectLiteralExpression(options) &&
          getProperty(t, options, 'capture')?.kind === t.SyntaxKind.TrueKeyword;
        if (capture) {
          const receiver = node.expression.expression;
          const global = t.isIdentifier(receiver) && ['document', 'window'].includes(receiver.text);
          const host = isHostRef(receiver);
          if (global || host) result.push({ selectedElement: selected, listenerElement: null,
            eventSource: global ? 'global' : 'host-dom', eventName: nameNode.text,
            modifiers: [], subscription: selected.owner.id, handler: handler.getText(), span: null,
            conditions: [global ? `${receiver.getText()} capture listener registration and same-document placement are conditional` :
              'component host capture listener registration and creation are conditional'],
            status: 'conditional', registration: 'capture' });
        }
      }
    }
    t.forEachChild(node, scan);
  };
  for (const member of selected.owner.node.members) scan(member);
  return result;
}

/** A DOM source and an Angular output are separate possible sources for the same spelling. */
export function resolveEventListeners(selected: IndexedElement, context: AnalysisContext, catalog: Catalog,
  eventFilter?: string, placement?: { index: TemplateIndex; path: ViewPath }): EventResolution {
  const listeners: EventListener[] = [];
  const outputSubscriptions: EventListener[] = [];
  const diagnostics: string[] = [];
  const ancestry: IndexedElement[] = [];
  for (let current: IndexedElement | null = selected; current; current = current.parent) ancestry.push(current);
  if (placement) {
    for (const step of placement.path.steps) {
      if (!step.displayParent || !['element', 'component-use'].includes(step.relation) || !step.span) continue;
      const parent = placement.index.elements.find(candidate => candidate.owner.id === step.ownerId &&
        candidate.span.file === step.span!.file && candidate.span.start === step.span!.start);
      if (parent && !ancestry.includes(parent)) ancestry.push(parent);
    }
  }
  // A projection/template insertion can change the actual DOM ancestry. Never invent a parent across that boundary.
  const placementUnknown = placement ? placement.path.end !== 'bootstrap' && placement.path.end !== 'root-unresolved' :
    selected.fallbackSlot !== null || ancestry.some(item => item.tag === 'ng-template') ||
    ancestry.some(item => item.component !== null && item !== selected);
  for (const [depth, element] of ancestry.entries()) {
    const template = element.node.outputs.map((output, index) => ({ event: output.name, handler: element.eventHandlers[index] ?? '',
      subscription: null as string | null, span: element.eventSpans[index] ?? element.span, registration: 'template' as const,
      target: output.target ?? null }));
    const hosted = hostEvents(context, catalog, element).map(item => ({ ...item, span: element.span,
      registration: 'host' as const, target: null }));
    for (const binding of [...template, ...hosted]) {
      const normalized = binding.event.replace(/^(window|document):/, '');
      const name = baseName(normalized);
      if (eventFilter && normalized !== eventFilter && !(eventFilter === name && !eventFilter.includes('.'))) continue;
      const modifiers = binding.event.split('.').slice(1);
      const global = binding.target === 'window' || binding.target === 'document' ||
        binding.event.startsWith('window:') || binding.event.startsWith('document:');
      const actualName = normalized;
      const event = uiEvents[baseName(actualName)];
      const outputs = global ? [] : element.appliedOutputs.get(name) ?? [];
      const conditions: string[] = selected.controlFlow.map(frame => `source view requires ${frame.condition}`);
      for (const subscription of outputs) {
        const producer = placement ? outputProducer(context, catalog, placement.index, subscription) :
          { conditions: [], diagnostic: null };
        if (producer.diagnostic && !diagnostics.includes(producer.diagnostic)) diagnostics.push(producer.diagnostic);
        outputSubscriptions.push({ selectedElement: selected, listenerElement: element,
        eventSource: subscription.includes('#') && (catalog.declarations.get(subscription.slice(0, subscription.lastIndexOf('.')))?.kind === 'component')
          ? 'component-output' : 'directive-output', eventName: actualName, modifiers, subscription,
        handler: binding.handler, span: binding.span,
        conditions: [...selected.controlFlow.map(frame => `source view requires ${frame.condition}`),
          'requires explicit output emit from this instance; a DOM event does not trigger it', ...producer.conditions],
        status: 'conditional', registration: binding.registration });
      }
      if (depth > 0 && !event?.bubbles && !global) continue;
      if (!event && !global) conditions.push('DOM event bubbles/composed are unknown');
      if (modifiers.length) conditions.push(`event modifiers ${modifiers.join('.')} must match`);
      if (placementUnknown) conditions.push('actual DOM placement across component or projection boundary is unknown');
      if (depth > 0 && ancestry.slice(0, depth).some(item => item.eventStops.some(Boolean)))
        conditions.push('an inner listener may stop propagation');
      if (selected.staticAttributes.has('disabled') || selected.boundAttributes.includes('disabled'))
        conditions.push('disabled state may suppress user activation');
      if (event?.composed && depth > 0) conditions.push('shadow DOM retargeting may change the event target');
      if (global) conditions.push('global listener registration; no ancestor element is implied');
      const base: EventListener = { selectedElement: selected, listenerElement: global ? null : element,
        eventSource: global ? 'global' : event ? 'selected-dom' : 'unknown-dom',
        eventName: actualName, modifiers, subscription: binding.subscription, handler: binding.handler,
        span: binding.span, conditions, status: !event && !global ? 'unresolved' : conditions.length ? 'conditional' : 'candidate',
        registration: binding.registration };
      if (global || event || depth === 0) listeners.push(base);
      else diagnostics.push(`Unknown DOM propagation for ${actualName} at ${element.span.file}:${element.span.line}`);
    }
  }
  listeners.push(...captureListeners(selected, context, eventFilter));
  const derivedEvents: EventResolution['derivedEvents'] = [];
  if ((!eventFilter || eventFilter === 'click') && selected.tag === 'button') derivedEvents.push({
    from: 'click', to: 'submit', status: 'boundary',
    reason: 'submit requires a form owner, an enabled submit control, and uncancelled default activation',
  });
  if (listeners.some(listener => /\.\s*focus\s*\(/.test(listener.handler))) derivedEvents.push({
    from: 'focus()', to: 'focusin', status: 'boundary',
    reason: 'the focus call must execute and cause a focus transition before focusin is dispatched',
  });
  // An output on an ancestor is never a DOM bubble path from the selected element.
  return { listeners, outputSubscriptions, derivedEvents, diagnostics };
}
