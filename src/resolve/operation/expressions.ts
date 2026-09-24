import path from 'node:path';
import type ts from 'typescript';
import type { AST } from '@angular/compiler';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog, Declaration } from '../../index/catalog.js';
import { classAt, getProperty, idForClass } from '../../index/catalog.js';
import type { IndexedElement, LexicalBinding, Span, TemplateIndex } from '../../index/templates.js';
import { StaticEvaluator } from '../../workspace/evaluate.js';
import { ScopeResolver } from '../scope/index.js';

export interface ExpressionReference {
  name: string;
  kind: 'local' | 'event' | 'pipe' | 'member' | 'reference' | 'unknown';
  origin: string;
  symbol: ts.Symbol | null;
  targetIds: string[];
  conditions: string[];
  diagnostics: string[];
}
export interface QueryResolution {
  member: string;
  kind: 'viewChild' | 'contentChild' | 'viewChildren' | 'contentChildren';
  targetIds: string[];
  read: string | null;
  occurrences: Span[];
  conditions: string[];
  diagnostics: string[];
}
export interface CallResolution {
  callee: string;
  receiver: ExpressionReference;
  symbol: ts.Symbol | null;
  target: string | null;
  status: 'resolved' | 'conditional' | 'unresolved';
  conditions: string[];
  diagnostics: string[];
}
export interface ExpressionResolution {
  references: ExpressionReference[];
  calls: CallResolution[];
  queries: QueryResolution[];
  diagnostics: string[];
}

const slash = (value: string): string => value.replaceAll('\\', '/');
function sourceId(context: AnalysisContext, node: ts.Node): string {
  const file = node.getSourceFile();
  const location = file.getLineAndCharacterOfPosition(node.getStart());
  return `${slash(path.relative(context.workspaceRoot, file.fileName))}:${location.line + 1}:${location.character + 1}`;
}
function classSymbol(context: AnalysisContext, owner: Declaration, name: string): ts.Symbol | null {
  return context.checker.getTypeAtLocation(owner.node).getProperty(name) ?? null;
}
function referenceTarget(context: AnalysisContext, catalog: Catalog, binding: LexicalBinding): ExpressionReference {
  const element = binding.element;
  if (!element) return { name: '', kind: 'unknown', origin: 'template reference without host', symbol: null,
    targetIds: [], conditions: [], diagnostics: ['Reference host is unknown'] };
  if (!binding.value && element.gaps.some(gap => gap.includes('Ambiguous component') || gap.includes('External component')))
    return { name: '', kind: 'unknown', origin: 'ambiguous component host', symbol: null, targetIds: [],
      conditions: [], diagnostics: ['Bare reference host component is unresolved'] };
  if (!binding.value && element.tag === 'ng-template') return { name: '', kind: 'reference', origin: 'template-ref',
    symbol: null, targetIds: [], conditions: ['TemplateRef requires an insertion to appear in the DOM'], diagnostics: [] };
  if (!binding.value && element.tag === 'ng-container') return { name: '', kind: 'unknown', origin: 'ng-container',
    symbol: null, targetIds: [], conditions: [], diagnostics: ['ng-container has no DOM element instance'] };
  if (!binding.value) return { name: '', kind: 'reference', origin: element.component ? 'component-host' : 'dom-element',
    symbol: null, targetIds: element.component ? [element.component] : [], conditions: [], diagnostics: [] };
  const matches = [element.component, ...element.directives].filter((id): id is string => !!id).filter(id => {
    const declaration = catalog.declarations.get(id);
    if (!declaration) return catalog.external.get(id)?.exportAs.includes(binding.value) ?? false;
    const expression = getProperty(context.toolchain.typescript, declaration.metadata, 'exportAs');
    const value = expression && new StaticEvaluator(context.toolchain.typescript, context.checker).evaluate(expression);
    return value?.known && typeof value.value === 'string' && value.value.split(',').map(part => part.trim()).includes(binding.value);
  });
  return { name: '', kind: matches.length ? 'reference' : 'unknown', origin: `exportAs:${binding.value}`,
    symbol: null, targetIds: matches, conditions: [],
    diagnostics: matches.length === 1 ? [] : [matches.length ? 'Ambiguous exportAs reference' : 'Unresolved exportAs reference'] };
}
function queryOf(context: AnalysisContext, index: TemplateIndex, element: IndexedElement, member: ts.Symbol): QueryResolution | null {
  const t = context.toolchain.typescript;
  const node = member.valueDeclaration;
  if (!node || !t.isPropertyDeclaration(node) || !node.initializer || !t.isCallExpression(node.initializer)) return null;
  const call = node.initializer;
  const expression = call.expression;
  const callee = t.isPropertyAccessExpression(expression) ? expression.expression : expression;
  if (!t.isIdentifier(callee)) return null;
  let symbol = context.checker.getSymbolAtLocation(callee);
  if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
  const name = symbol?.getName();
  if (!['viewChild', 'contentChild', 'viewChildren', 'contentChildren'].includes(name ?? '') ||
    !symbol?.declarations?.some(part => slash(part.getSourceFile().fileName).includes('/node_modules/@angular/core/'))) return null;
  const kind = name as QueryResolution['kind'];
  const required = t.isPropertyAccessExpression(expression) && expression.name.text === 'required';
  const selector = call.arguments[0];
  const read = call.arguments[1] && t.isObjectLiteralExpression(call.arguments[1])
    ? getProperty(t, call.arguments[1], 'read')?.getText() ?? null : null;
  const visible = kind.startsWith('view') ? index.byOwner.get(element.owner.id) ?? [] :
    index.elements.filter(candidate => {
      for (let parent = candidate.parent; parent; parent = parent.parent)
        if (parent.component === element.owner.id) return true;
      return false;
    });
  let candidates: IndexedElement[] = [];
  if (selector && t.isStringLiteralLike(selector)) {
    const token = selector.text;
    candidates = visible.filter(candidate => candidate.node.references.some(ref => ref.name === token));
  } else if (selector) {
    const declaration = classAt(context, selector);
    const id = declaration && idForClass(context, declaration);
    if (id) candidates = visible.filter(candidate => candidate.component === id || candidate.directives.includes(id));
  }
  const targetIds = candidates.flatMap(candidate => [candidate.component, ...candidate.directives]
    .filter((id): id is string => !!id));
  const conditions = [kind.startsWith('content') ? 'projected content query scope and insertion must be checked' :
    'view query depends on active child view'];
  if (!required) conditions.push('query may be undefined before creation or when no match exists');
  else conditions.push('required query can fail if no matching view is created');
  if (candidates.length !== 1 && !kind.endsWith('Children')) conditions.push('query instance is not uniquely identified');
  if (read) conditions.push(`read token ${read} changes the returned instance`);
  return { member: member.getName(), kind, targetIds: [...new Set(targetIds)], read,
    occurrences: candidates.map(candidate => candidate.span), conditions,
    diagnostics: targetIds.length ? [] : ['No query instance was proved by the template occurrence'] };
}

export function resolveTemplateExpressions(element: IndexedElement, context: AnalysisContext,
  catalog: Catalog, index: TemplateIndex): ExpressionResolution {
  const ng = context.toolchain.angularCompiler;
  const t = context.toolchain.typescript;
  const references: ExpressionReference[] = [];
  const calls: CallResolution[] = [];
  const queries: QueryResolution[] = [];
  const diagnostics: string[] = [];
  const owner = element.owner;
  const scope = new ScopeResolver(catalog).scopeOf(owner);
  const semantic = context.program.getSemanticDiagnostics(owner.node.getSourceFile());
  const typeDiagnostics = semantic.map(item => t.flattenDiagnosticMessageText(item.messageText, ' '));
  const seenQueries = new Set<string>();
  let eventContext = false;
  const memberRef = (name: string): ExpressionReference => {
    const symbol = classSymbol(context, owner, name);
    if (!symbol) return { name, kind: 'unknown', origin: owner.id, symbol: null, targetIds: [], conditions: [],
      diagnostics: [`Unknown component member ${name}`] };
    const declarations = symbol.declarations ?? [];
    const inaccessible = declarations.some(node => t.canHaveModifiers(node) &&
      (t.getModifiers(node) ?? []).some(modifier => modifier.kind === t.SyntaxKind.PrivateKeyword));
    const memberDiagnostics = inaccessible ? [`Private member ${name} is not template-accessible`] : [];
    const query = queryOf(context, index, element, symbol);
    if (query && !seenQueries.has(name)) { queries.push(query); seenQueries.add(name); }
    return { name, kind: 'member', origin: owner.id, symbol, targetIds: [], conditions: [],
      diagnostics: [...memberDiagnostics, ...typeDiagnostics] };
  };
  const resolve = (name: string, explicitThis = false): ExpressionReference => {
    if (!explicitThis && name === '$event' && eventContext) return { name, kind: 'event', origin: 'listener payload', symbol: null,
      targetIds: [], conditions: [], diagnostics: [] };
    if (!explicitThis && element.lexical.has(name)) {
      const binding = element.lexical.get(name)!;
      if (binding.kind === 'reference') return { ...referenceTarget(context, catalog, binding), name };
      return { name, kind: 'local', origin: `${binding.kind}:${binding.value}`, symbol: null, targetIds: [],
        conditions: binding.kind === 'fragment' ? ['value comes from insertion context'] : [], diagnostics: [] };
    }
    return memberRef(name);
  };
  const visitor = new class extends ng.RecursiveAstVisitor {
    override visitPropertyRead(ast: InstanceType<typeof ng.PropertyRead>, ctx: unknown): unknown {
      if (ast.receiver instanceof ng.ImplicitReceiver || ast.receiver instanceof ng.ThisReceiver) {
        references.push(resolve(ast.name, ast.receiver instanceof ng.ThisReceiver));
      }
      return super.visitPropertyRead(ast, ctx);
    }
    override visitSafePropertyRead(ast: InstanceType<typeof ng.SafePropertyRead>, ctx: unknown): unknown {
      if (ast.receiver instanceof ng.ImplicitReceiver || ast.receiver instanceof ng.ThisReceiver)
        references.push(resolve(ast.name, ast.receiver instanceof ng.ThisReceiver));
      return super.visitSafePropertyRead(ast, ctx);
    }
    override visitPipe(ast: InstanceType<typeof ng.BindingPipe>, ctx: unknown): unknown {
      const pipe = [...scope.ids].map(id => catalog.declarations.get(id) ?? catalog.external.get(id)).filter(item =>
        item?.kind === 'pipe' && item.selector === ast.name);
      references.push({ name: ast.name, kind: 'pipe', origin: owner.id, symbol: null,
        targetIds: pipe.map(item => item!.id), conditions: [], diagnostics: pipe.length === 1 ? [] :
          ['Pipe is absent or ambiguous in the available catalog'] });
      return super.visitPipe(ast, ctx);
    }
    private recordCall(receiver: AST, optional: boolean): void {
      if (receiver instanceof ng.PropertyRead || receiver instanceof ng.SafePropertyRead) {
        const base = receiver.receiver;
        let resolved: ExpressionReference;
        if (base instanceof ng.ImplicitReceiver || base instanceof ng.ThisReceiver)
          resolved = resolve(receiver.name, base instanceof ng.ThisReceiver);
        else if (base instanceof ng.PropertyRead &&
          (base.receiver instanceof ng.ImplicitReceiver || base.receiver instanceof ng.ThisReceiver))
          resolved = resolve(base.name, base.receiver instanceof ng.ThisReceiver);
        else resolved = { name: receiver.name, kind: 'unknown', origin: 'computed or chained receiver',
          symbol: null, targetIds: [], conditions: [], diagnostics: ['Receiver value is unresolved'] };
        let symbol = base instanceof ng.ImplicitReceiver || base instanceof ng.ThisReceiver ? resolved.symbol : null;
        if (!symbol && resolved.kind === 'reference' && resolved.targetIds.length === 1) {
          const instance = catalog.declarations.get(resolved.targetIds[0]!);
          if (instance) symbol = context.checker.getTypeAtLocation(instance.node).getProperty(receiver.name) ?? null;
        }
        const declaration = symbol?.declarations?.[0] ?? null;
        const target = declaration && t.isMethodDeclaration(declaration) && !resolved.diagnostics.some(message => message.startsWith('Private'))
          ? sourceId(context, declaration) : null;
        const conditions = [...resolved.conditions];
        if (optional || receiver instanceof ng.SafePropertyRead) conditions.push('optional receiver may be null or undefined');
        if (resolved.kind === 'reference' && resolved.targetIds.length !== 1) conditions.push('reference instance is not unique');
        if (resolved.kind === 'member' && symbol && declaration && !t.isMethodDeclaration(declaration))
          conditions.push('callee is a function value; assignment origin is not proved');
        if (declaration && t.isMethodDeclaration(declaration) && declaration.modifiers?.some(m => m.kind === t.SyntaxKind.OverrideKeyword))
          conditions.push('override dispatch depends on runtime receiver');
        calls.push({ callee: receiver.name, receiver: resolved, symbol, target,
          status: !target ? 'unresolved' : conditions.length ? 'conditional' : 'resolved',
          conditions, diagnostics: resolved.diagnostics });
      } else {
        calls.push({ callee: receiver instanceof ng.KeyedRead ? '(computed property)' : '(computed call)',
          receiver: { name: '', kind: 'unknown', origin: 'dynamic receiver',
          symbol: null, targetIds: [], conditions: [], diagnostics: [] }, symbol: null, target: null,
          status: 'unresolved', conditions: ['computed, union, any, or function-value call requires value provenance'], diagnostics: [] });
      }
    }
    override visitCall(ast: InstanceType<typeof ng.Call>, ctx: unknown): unknown {
      this.recordCall(ast.receiver, false);
      return super.visitCall(ast, ctx);
    }
    override visitSafeCall(ast: InstanceType<typeof ng.SafeCall>, ctx: unknown): unknown {
      this.recordCall(ast.receiver, true);
      return super.visitSafeCall(ast, ctx);
    }
  }();
  const analyze = (ast: AST): void => { ast.visit(visitor); };
  for (const input of element.node.inputs) analyze(input.value);
  eventContext = true;
  for (const output of element.node.outputs) analyze(output.handler);
  diagnostics.push(...typeDiagnostics);
  return { references, calls, queries, diagnostics };
}
