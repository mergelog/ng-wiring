import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
import { getProperty, unwrap } from '../../index/catalog.js';
import { location } from './reactive.js';

export type ProviderKind = 'class' | 'existing' | 'value' | 'factory' | 'implicit';
export interface ProviderBinding { token: string; kind: ProviderKind; implementation: string | null;
  source: string; multi: boolean; status: 'resolved' | 'boundary'; reason: string | null }
export interface InjectorLayer { id: string; kind: 'root' | 'route' | 'component' | 'view' | 'template';
  providers: ts.Expression[]; host?: boolean; visibleToContent?: boolean }
export interface InjectionRequest { token: ts.Expression; optional?: boolean; self?: boolean; skipSelf?: boolean;
  host?: boolean; projected?: boolean; templateInjector?: InjectorLayer | null }
export interface InjectionResolution { token: string; bindings: ProviderBinding[]; status: 'resolved' | 'boundary' | 'missing';
  reasons: string[]; searched: string[] }

const slash = (s: string): string => s.replaceAll('\\', '/');
function symbolOf(context: AnalysisContext, node: ts.Node): ts.Symbol | undefined {
  const t = context.toolchain.typescript;
  let symbol = context.checker.getSymbolAtLocation(node);
  if (symbol && (symbol.flags & t.SymbolFlags.Alias)) symbol = context.checker.getAliasedSymbol(symbol);
  return symbol;
}
export function tokenId(context: AnalysisContext, node: ts.Node): string {
  const t = context.toolchain.typescript;
  const target = t.isPropertyAccessExpression(node) ? node.name : node;
  const symbol = symbolOf(context, target);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (!declaration) return `unresolved:${node.getText()}`;
  return `${slash(declaration.getSourceFile().fileName)}:${declaration.getStart()}:${symbol?.getName() ?? node.getText()}`;
}
function staticArray(context: AnalysisContext, input: ts.Expression, seen = new Set<ts.Node>()): ts.Expression[] | null {
  const t = context.toolchain.typescript;
  const node = unwrap(t, input);
  if (seen.has(node)) return null;
  seen.add(node);
  if (t.isArrayLiteralExpression(node)) {
    const result: ts.Expression[] = [];
    for (const item of node.elements) {
      const nested = t.isSpreadElement(item) ? staticArray(context, item.expression, seen) : [item];
      if (!nested) return null;
      result.push(...nested);
    }
    return result;
  }
  if (t.isIdentifier(node) || t.isPropertyAccessExpression(node)) {
    const declaration = symbolOf(context, t.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
    if (declaration && t.isVariableDeclaration(declaration) && declaration.initializer)
      return staticArray(context, declaration.initializer, seen);
  }
  return [node];
}
function providerOf(context: AnalysisContext, expression: ts.Expression): ProviderBinding | null {
  const t = context.toolchain.typescript;
  const node = unwrap(t, expression);
  if (t.isObjectLiteralExpression(node)) {
    const token = getProperty(t, node, 'provide');
    if (!token) return null;
    const multi = getProperty(t, node, 'multi')?.kind === t.SyntaxKind.TrueKeyword;
    const entries: [ProviderKind, ts.Expression | undefined][] = [
      ['class', getProperty(t, node, 'useClass')], ['existing', getProperty(t, node, 'useExisting')],
      ['value', getProperty(t, node, 'useValue')], ['factory', getProperty(t, node, 'useFactory')]];
    const [kind, value] = entries.find(([, entry]) => entry) ?? ['implicit', undefined];
    const status = kind === 'factory' || !value || tokenId(context, token).startsWith('unresolved:') ? 'boundary' : 'resolved';
    return { token: tokenId(context, token), kind, implementation: value ?
      (kind === 'value' ? value.getText() : tokenId(context, value)) : null,
      source: location(context, node), multi, status,
      reason: kind === 'factory' ? 'provider factory return value is not statically executed' :
        !value ? 'provider implementation is not statically known' : status === 'boundary' ? 'provider token is unresolved' : null };
  }
  if (t.isCallExpression(node)) return null;
  const token = tokenId(context, node);
  return { token, kind: 'class', implementation: token, source: location(context, node), multi: false,
    status: token.startsWith('unresolved:') ? 'boundary' : 'resolved', reason: token.startsWith('unresolved:') ? 'class provider is unresolved' : null };
}
/** Layers are ordered from the injection site outward. An explicit template injector is inserted at the site. */
export function resolveInjection(context: AnalysisContext, request: InjectionRequest, layers: InjectorLayer[]): InjectionResolution {
  const token = tokenId(context, request.token);
  const searched: string[] = [];
  const reasons: string[] = [];
  const ordered = [...(request.templateInjector ? [request.templateInjector] : []), ...layers]
    .filter(layer => !request.projected || layer.visibleToContent !== false);
  const applicable = request.skipSelf ? ordered.slice(1) : ordered;
  const collected: ProviderBinding[] = [];
  let found = false;
  for (const [index, layer] of applicable.entries()) {
    if (request.self && index > 0) break;
    searched.push(layer.id);
    const layerBindings: ProviderBinding[] = [];
    for (const expression of layer.providers) {
      const items = staticArray(context, expression);
      if (!items) { reasons.push(`provider list in ${layer.id} cannot be statically expanded`); continue; }
      for (const item of items) {
        const provider = providerOf(context, item);
        if (!provider || provider.token !== token) continue;
        found = true;
        if (provider.multi) layerBindings.push(provider);
        else { layerBindings.length = 0; layerBindings.push(provider); }
      }
    }
    if (layerBindings.some(item => !item.multi)) {
      collected.length = 0;
      collected.push(...layerBindings);
      break;
    }
    collected.push(...layerBindings);
    if (request.host && layer.host) break;
  }
  if (!found && !request.self && !request.host) {
    const declaration = symbolOf(context, request.token)?.valueDeclaration;
    if (declaration && context.toolchain.typescript.isClassDeclaration(declaration)) {
      const t = context.toolchain.typescript;
      for (const decorator of t.getDecorators(declaration) ?? []) {
        if (!t.isCallExpression(decorator.expression)) continue;
        const arg = decorator.expression.arguments[0];
        if (!arg || !t.isObjectLiteralExpression(arg)) continue;
        const providedIn = getProperty(t, arg, 'providedIn');
        if (providedIn && t.isStringLiteralLike(providedIn) && ['root', 'platform', 'any'].includes(providedIn.text)) {
          collected.push({ token, kind: 'implicit', implementation: token, source: location(context, decorator),
            multi: false, status: providedIn.text === 'root' ? 'resolved' : 'boundary',
            reason: providedIn.text === 'root' ? null : `providedIn ${providedIn.text} has context-dependent lifetime` });
          found = true;
        }
      }
    }
  }
  if (collected.some(item => item.multi) && collected.some(item => !item.multi)) reasons.push('mixed multi and single providers');
  if (!found && !request.optional) reasons.push(`no provider for ${token}`);
  if (!found && request.optional) reasons.push('optional injection may return null');
  for (const item of collected) if (item.reason) reasons.push(item.reason);
  for (const item of collected) if (item.kind === 'existing' && item.implementation) {
    const alias = item.implementation;
    const seen = new Set([token]);
    let cursor = alias;
    for (let depth = 0; depth < 64; depth++) {
      if (seen.has(cursor)) { item.status = 'boundary'; item.reason = 'useExisting provider cycle'; break; }
      seen.add(cursor);
      let target: ProviderBinding | undefined;
      for (const layer of applicable) {
        const candidates = layer.providers.flatMap(expression => staticArray(context, expression) ?? [])
          .map(expression => providerOf(context, expression)).filter((value): value is ProviderBinding => !!value);
        target = candidates.filter(value => value.token === cursor).at(-1);
        if (target) break;
      }
      if (!target) { item.status = 'boundary'; item.reason = 'useExisting target has no provider in the selected injector'; break; }
      if (target.kind !== 'existing') { item.implementation = target.implementation; item.status = target.status;
        item.reason = target.reason; break; }
      if (!target.implementation) { item.status = 'boundary'; item.reason = 'useExisting target is unresolved'; break; }
      cursor = target.implementation;
      if (depth === 63) { item.status = 'boundary'; item.reason = 'useExisting chain depth limit'; }
    }
    if (item.reason) reasons.push(item.reason);
  }
  return { token, bindings: collected, status: !found ? (request.optional ? 'resolved' : 'missing') :
    reasons.length ? 'boundary' : 'resolved', reasons, searched };
}

/** Reads the public Angular inject options or constructor parameter decorators. */
export function injectionRequestFor(context: AnalysisContext, node: ts.CallExpression | ts.ParameterDeclaration): InjectionRequest | null {
  const t = context.toolchain.typescript;
  if (t.isCallExpression(node)) {
    const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
    const symbol = symbolOf(context, callee);
    if (symbol?.getName() !== 'inject' || !symbol.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
      return null;
    const token = node.arguments[0];
    if (!token) return null;
    const options = node.arguments[1];
    const flag = (name: string) => !!options && t.isObjectLiteralExpression(options) &&
      getProperty(t, options, name)?.kind === t.SyntaxKind.TrueKeyword;
    return { token, optional: flag('optional'), self: flag('self'), skipSelf: flag('skipSelf'), host: flag('host') };
  }
  let token: ts.Expression | undefined;
  const flags = { optional: false, self: false, skipSelf: false, host: false };
  for (const decorator of t.getDecorators(node) ?? []) {
    const call = decorator.expression;
    const name = t.isCallExpression(call) ? call.expression : call;
    const symbol = symbolOf(context, name);
    if (!symbol?.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/'))) continue;
    if (symbol.getName() === 'Inject' && t.isCallExpression(call)) token = call.arguments[0];
    if (symbol.getName() === 'Optional') flags.optional = true;
    if (symbol.getName() === 'Self') flags.self = true;
    if (symbol.getName() === 'SkipSelf') flags.skipSelf = true;
    if (symbol.getName() === 'Host') flags.host = true;
  }
  if (!token && node.type && t.isTypeReferenceNode(node.type)) token = node.type.typeName as ts.Expression;
  return token ? { token, ...flags } : null;
}

export function componentInjectorLayers(owner: Declaration, parents: Declaration[] = [], rootProviders: ts.Expression[] = [],
  routeProviders: ts.Expression[] = []): InjectorLayer[] {
  const property = (declaration: Declaration, name: string): ts.Expression[] => {
    const item = declaration.metadata.properties.find(p => p.name?.getText() === name);
    return item && 'initializer' in item && item.initializer ? [item.initializer as ts.Expression] : [];
  };
  const components = [owner, ...parents].flatMap((item, index): InjectorLayer[] => [
    { id: `${item.id}:view`, kind: 'view', providers: property(item, 'viewProviders'), visibleToContent: false, host: index === 0 },
    { id: `${item.id}:component`, kind: 'component', providers: property(item, 'providers'), host: index === 0 }]);
  return [...components, { id: 'route', kind: 'route', providers: routeProviders },
    { id: 'root', kind: 'root', providers: rootProviders }];
}
