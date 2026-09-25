import path from 'node:path';
import { createHash } from 'node:crypto';
import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import { classAt, getProperty, idForClass, unwrap } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { MazeGraph } from '../../adapters/ng-maze/index.js';
import { StaticEvaluator } from '../../workspace/evaluate.js';

export type RouteConditionKind = 'path' | 'path-match' | 'guard' | 'matcher' | 'order' | 'outlet' | 'redirect' | 'providers';
export interface RouteCondition { kind: RouteConditionKind; text: string; span: Span }
export interface RouteOccurrence {
  id: string;
  configId: string;
  rooted: boolean;
  definition: Span;
  /** Import/loader call sites that pull this route in, outermost first (P6-02). */
  loaders: Span[];
  path: string | null;
  pathUnresolved: boolean;
  pattern: string;
  outlet: string | null;
  outletUnresolved: boolean;
  componentId: string | null;
  componentUnresolved: boolean;
  componentless: boolean;
  redirectTo: string | null;
  order: number;
  /** Own conditions plus every ancestor condition, outermost first (P6-04). */
  conditions: RouteCondition[];
  parentId: string | null;
  /** Nearest ancestor occurrence that has a component; componentless routes are skipped (P6-03). */
  hostRouteId: string | null;
  gaps: string[];
}
export interface RouteConfig {
  id: string;
  kind: 'provideRouter' | 'forRoot' | 'forChild' | 'routes-array';
  span: Span;
  bootstrapId: string | null;
  rooted: boolean;
}
export interface BootstrapOccurrence {
  id: string;
  kind: 'application' | 'module';
  entry: string;
  span: Span;
  componentIds: string[];
  moduleId: string | null;
  configIds: string[];
  gaps: string[];
}
export interface RouteGraph {
  occurrences: RouteOccurrence[];
  byId: Map<string, RouteOccurrence>;
  byComponent: Map<string, RouteOccurrence[]>;
  configs: Map<string, RouteConfig>;
  bootstraps: BootstrapOccurrence[];
  bootstrapByComponent: Map<string, BootstrapOccurrence[]>;
  redirects: RouteOccurrence[];
  diagnostics: string[];
  gaps: string[];
}

const MAX_OCCURRENCES = 2_000;
const slash = (value: string): string => value.replaceAll('\\', '/');
const ANGULAR_ROUTER = '/node_modules/@angular/router/';

function spanOf(node: ts.Node): Span {
  const source = node.getSourceFile();
  const start = node.getStart(source);
  const end = node.getEnd();
  const position = source.getLineAndCharacterOfPosition(start);
  return { file: source.fileName, start, end, line: position.line + 1,
    endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1, column: position.character + 1 };
}

function relativeSpan(context: AnalysisContext, span: Span): [string, number, number] {
  return [slash(path.relative(context.workspaceRoot, span.file)), span.start, span.end];
}

function symbolOf(context: AnalysisContext, node: ts.Node): ts.Symbol | undefined {
  const t = context.toolchain.typescript;
  let symbol = context.checker.getSymbolAtLocation(node);
  if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
  return symbol;
}

function declarationOf(context: AnalysisContext, node: ts.Node): ts.Declaration | undefined {
  const symbol = symbolOf(context, node);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function fromAngular(context: AnalysisContext, node: ts.Node, packageName: string): boolean {
  return symbolOf(context, node)?.declarations?.some(declaration =>
    slash(declaration.getSourceFile().fileName).includes(`/node_modules/@angular/${packageName}/`)) ?? false;
}

function calleeName(context: AnalysisContext, call: ts.CallExpression): string | null {
  const t = context.toolchain.typescript;
  const callee = call.expression;
  if (t.isIdentifier(callee)) return callee.text;
  if (t.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** `RouterModule.forRoot(routes, …)` / `.forChild(routes)` from the installed @angular/router. */
function routerModuleCall(context: AnalysisContext, node: ts.Expression, method: 'forRoot' | 'forChild'): ts.Expression | undefined {
  const t = context.toolchain.typescript;
  const call = unwrap(t, node);
  if (!t.isCallExpression(call) || !t.isPropertyAccessExpression(call.expression) || call.expression.name.text !== method) return undefined;
  const owner = classAt(context, call.expression.expression);
  if (!owner || owner.name?.text !== 'RouterModule') return undefined;
  if (!slash(owner.getSourceFile().fileName).includes(ANGULAR_ROUTER)) return undefined;
  return call.arguments[0];
}

/** The receiver is the installed @angular/router Router, not an unrelated object with the same method name. */
function isRouterReceiver(context: AnalysisContext, receiver: ts.Expression): boolean {
  const symbol = context.checker.getTypeAtLocation(receiver).getSymbol();
  return symbol?.getName() === 'Router' && (symbol.declarations?.some(declaration =>
    slash(declaration.getSourceFile().fileName).includes(ANGULAR_ROUTER)) ?? false);
}

function isConstVariable(context: AnalysisContext, declaration: ts.Declaration): declaration is ts.VariableDeclaration {
  const t = context.toolchain.typescript;
  return t.isVariableDeclaration(declaration) && t.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & t.NodeFlags.Const) !== 0;
}

function arrayLiteralOf(context: AnalysisContext, expression: ts.Expression,
  active = new Set<ts.Node>()): ts.ArrayLiteralExpression | undefined {
  const t = context.toolchain.typescript;
  const node = unwrap(t, expression);
  if (active.has(node)) return undefined;
  active.add(node);
  if (t.isArrayLiteralExpression(node)) return node;
  if (t.isIdentifier(node) || t.isPropertyAccessExpression(node)) {
    const declaration = declarationOf(context, t.isPropertyAccessExpression(node) ? node.name : node);
    if (declaration && isConstVariable(context, declaration) && declaration.initializer) {
      return arrayLiteralOf(context, declaration.initializer, active);
    }
  }
  return undefined;
}

function moduleDefaultExport(context: AnalysisContext, call: ts.CallExpression): ts.Declaration | undefined {
  const t = context.toolchain.typescript;
  const specifier = call.arguments[0];
  if (!specifier || !t.isStringLiteralLike(specifier)) return undefined;
  const resolved = t.resolveModuleName(specifier.text, call.getSourceFile().fileName,
    context.compilerOptions, t.sys).resolvedModule;
  const source = resolved && context.program.getSourceFile(resolved.resolvedFileName);
  const moduleSymbol = source && context.checker.getSymbolAtLocation(source);
  const exported = moduleSymbol && context.checker.getExportsOfModule(moduleSymbol)
    .find(symbol => symbol.getName() === 'default');
  const target = exported?.flags && exported.flags & t.SymbolFlags.Alias
    ? context.checker.getAliasedSymbol(exported) : exported;
  return target?.valueDeclaration ?? target?.declarations?.[0];
}

/** `() => import('…').then(m => m.X)`, `async () => (await import('…')).X`, `() => X`, `() => import('…')`. */
export function lazyTarget(context: AnalysisContext, expression: ts.Expression, depth = 0): ts.Declaration | undefined {
  const t = context.toolchain.typescript;
  if (depth > 8) return undefined;
  const node = unwrap(t, expression);
  if (t.isArrowFunction(node) || t.isFunctionExpression(node)) {
    if (!t.isBlock(node.body)) return lazyTarget(context, node.body, depth + 1);
    const returned = node.body.statements.find(t.isReturnStatement)?.expression;
    return returned ? lazyTarget(context, returned, depth + 1) : undefined;
  }
  if (t.isAwaitExpression(node)) return lazyTarget(context, node.expression, depth + 1);
  if (t.isCallExpression(node) && node.expression.kind === t.SyntaxKind.ImportKeyword) return moduleDefaultExport(context, node);
  if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'then') {
    const callback = node.arguments[0] && unwrap(t, node.arguments[0]!);
    if (callback && (t.isArrowFunction(callback) || t.isFunctionExpression(callback))) return lazyTarget(context, callback, depth + 1);
    return undefined;
  }
  if (t.isPropertyAccessExpression(node)) return declarationOf(context, node.name);
  if (t.isIdentifier(node)) return declarationOf(context, node);
  return undefined;
}

function componentIdOf(context: AnalysisContext, catalog: Catalog, expression: ts.Expression): string | undefined {
  const declaration = classAt(context, expression);
  const id = declaration && idForClass(context, declaration);
  return id && catalog.declarations.has(id) ? id : undefined;
}

function classIdOf(context: AnalysisContext, declaration: ts.Declaration | undefined): string | undefined {
  const t = context.toolchain.typescript;
  return declaration && t.isClassDeclaration(declaration) ? idForClass(context, declaration) : undefined;
}

function reachableFiles(context: AnalysisContext, entries: readonly string[]): Set<string> {
  const t = context.toolchain.typescript;
  const seen = new Set<string>();
  const queue = entries.map(file => path.resolve(file));
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = context.program.getSourceFile(file);
    if (!source) continue;
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((t.isImportDeclaration(node) || t.isExportDeclaration(node)) && node.moduleSpecifier &&
        t.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (t.isCallExpression(node) && node.expression.kind === t.SyntaxKind.ImportKeyword &&
        node.arguments[0] && t.isStringLiteralLike(node.arguments[0]!)) specifiers.push((node.arguments[0] as ts.StringLiteralLike).text);
      t.forEachChild(node, visit);
    };
    visit(source);
    for (const specifier of specifiers) {
      const resolved = t.resolveModuleName(specifier, file, context.compilerOptions, t.sys).resolvedModule;
      const target = resolved && path.resolve(resolved.resolvedFileName);
      if (target && context.sourceFiles.includes(target)) queue.push(target);
    }
  }
  return seen;
}

function providerList(context: AnalysisContext, expression: ts.Expression, gaps: string[],
  active = new Set<ts.Node>()): ts.Expression[] {
  const t = context.toolchain.typescript;
  const node = unwrap(t, expression);
  if (active.has(node)) return [];
  active.add(node);
  if (t.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(element => t.isSpreadElement(element)
      ? providerList(context, element.expression, gaps, active) : providerList(context, element, gaps, active));
  }
  if (t.isIdentifier(node) || t.isPropertyAccessExpression(node)) {
    const declaration = declarationOf(context, t.isPropertyAccessExpression(node) ? node.name : node);
    if (declaration && isConstVariable(context, declaration) && declaration.initializer) {
      return providerList(context, declaration.initializer, gaps, active);
    }
  }
  return [node];
}

function configProviders(context: AnalysisContext, expression: ts.Expression, gaps: string[],
  active = new Set<ts.Node>()): ts.Expression[] {
  const t = context.toolchain.typescript;
  const node = unwrap(t, expression);
  if (active.has(node)) return [];
  active.add(node);
  if (t.isObjectLiteralExpression(node)) {
    const providers = getProperty(t, node, 'providers');
    return providers ? providerList(context, providers, gaps) : [];
  }
  if (t.isCallExpression(node) && calleeName(context, node) === 'mergeApplicationConfig') {
    return node.arguments.flatMap(argument => configProviders(context, argument, gaps, active));
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.expression)) {
    const declaration = declarationOf(context, node.expression);
    const body = declaration && (t.isFunctionDeclaration(declaration) || t.isFunctionExpression(declaration) ||
      t.isArrowFunction(declaration)) ? declaration.body :
      declaration && t.isVariableDeclaration(declaration) && declaration.initializer &&
      (t.isFunctionExpression(declaration.initializer) || t.isArrowFunction(declaration.initializer))
        ? declaration.initializer.body : undefined;
    if (body && context.sourceFiles.includes(body.getSourceFile().fileName)) {
      const returned = t.isBlock(body) ? body.statements.filter(t.isReturnStatement) : [];
      const result = t.isBlock(body) ? returned.length === 1 ? returned[0]?.expression : undefined : body;
      if (result) return configProviders(context, result, gaps, active);
    }
  }
  if (t.isIdentifier(node) || t.isPropertyAccessExpression(node)) {
    const declaration = declarationOf(context, t.isPropertyAccessExpression(node) ? node.name : node);
    if (declaration && isConstVariable(context, declaration) && declaration.initializer) {
      return configProviders(context, declaration.initializer, gaps, active);
    }
  }
  gaps.push(`Application config is not statically resolvable at ${spanOf(node).file}:${spanOf(node).line}`);
  return [];
}

/** Root route arrays a provider list contributes: provideRouter and importProvidersFrom(RouterModule.forRoot). */
function rootRoutesFromProviders(context: AnalysisContext, providers: readonly ts.Expression[]): ts.Expression[] {
  const t = context.toolchain.typescript;
  const found: ts.Expression[] = [];
  for (const provider of providers) {
    if (!t.isCallExpression(provider)) continue;
    const name = calleeName(context, provider);
    if (name === 'provideRouter' && provider.arguments[0] &&
      fromAngular(context, t.isPropertyAccessExpression(provider.expression) ? provider.expression.name : provider.expression, 'router')) {
      found.push(provider.arguments[0]!);
    }
    if (name === 'importProvidersFrom') {
      for (const argument of provider.arguments) {
        const routes = routerModuleCall(context, argument, 'forRoot');
        if (routes) found.push(routes);
      }
    }
  }
  return found;
}

function moduleRootRoutes(context: AnalysisContext, catalog: Catalog, moduleId: string,
  gaps: string[], active = new Set<string>()): ts.Expression[] {
  if (active.has(moduleId)) return [];
  active.add(moduleId);
  const t = context.toolchain.typescript;
  const declaration = catalog.declarations.get(moduleId);
  if (!declaration) { gaps.push(`NgModule ${moduleId} is outside the analysis context`); return []; }
  const found: ts.Expression[] = [];
  const imports = getProperty(t, declaration.metadata, 'imports');
  if (imports) {
    const list = unwrap(t, imports);
    const elements = t.isArrayLiteralExpression(list) ? list.elements : [];
    for (const element of elements) {
      const routes = routerModuleCall(context, element, 'forRoot');
      if (routes) { found.push(routes); continue; }
      const imported = classAt(context, element);
      const importedId = imported && idForClass(context, imported);
      if (importedId && catalog.declarations.get(importedId)?.kind === 'module') {
        found.push(...moduleRootRoutes(context, catalog, importedId, gaps, active));
      }
    }
  }
  const providers = getProperty(t, declaration.metadata, 'providers');
  if (providers) found.push(...rootRoutesFromProviders(context, providerList(context, providers, gaps)));
  return found;
}

interface FoundBootstrap { bootstrap: BootstrapOccurrence; rootRoutes: ts.Expression[] }

function findBootstraps(context: AnalysisContext, catalog: Catalog): FoundBootstrap[] {
  const t = context.toolchain.typescript;
  const output: FoundBootstrap[] = [];
  for (const entry of context.entry) {
    const files = reachableFiles(context, [entry]);
    const entryPath = slash(path.relative(context.workspaceRoot, path.resolve(entry)));
    for (const file of [...files].sort()) {
      const source = context.program.getSourceFile(file);
      if (!source) continue;
      const visit = (node: ts.Node): void => {
        if (t.isCallExpression(node)) {
          const name = calleeName(context, node);
          const gaps: string[] = [];
          if (name === 'bootstrapApplication' && t.isIdentifier(node.expression) &&
            fromAngular(context, node.expression, 'platform-browser') && node.arguments[0]) {
            const componentId = componentIdOf(context, catalog, node.arguments[0]!);
            if (!componentId) gaps.push('Bootstrap component is not resolvable to a catalogued component');
            const providers = node.arguments[1] ? configProviders(context, node.arguments[1]!, gaps) : [];
            const rootRoutes = rootRoutesFromProviders(context, providers);
            output.push({ rootRoutes, bootstrap: { id: `app:${entryPath}#${spanOf(node).start}`, kind: 'application',
              entry: entryPath, span: spanOf(node), componentIds: componentId ? [componentId] : [], moduleId: null,
              configIds: rootRoutes.map(expression => configIdFor(context, expression)), gaps } });
          }
          if (name === 'bootstrapModule' && t.isPropertyAccessExpression(node.expression) && node.arguments[0]) {
            const moduleClass = classAt(context, node.arguments[0]!);
            const moduleId = moduleClass && idForClass(context, moduleClass);
            const module = moduleId ? catalog.declarations.get(moduleId) : undefined;
            if (module?.kind === 'module') {
              const bootstrapArray = getProperty(t, module.metadata, 'bootstrap');
              const list = bootstrapArray && unwrap(t, bootstrapArray);
              const componentIds: string[] = [];
              if (list && t.isArrayLiteralExpression(list)) {
                for (const element of list.elements) {
                  const id = componentIdOf(context, catalog, element);
                  if (id) componentIds.push(id); else gaps.push(`Unresolved bootstrap entry ${element.getText().slice(0, 60)}`);
                }
              } else gaps.push(`NgModule ${moduleId} has no statically resolvable bootstrap array`);
              const rootRoutes = moduleRootRoutes(context, catalog, moduleId!, gaps);
              output.push({ rootRoutes, bootstrap: { id: `app:${entryPath}#${spanOf(node).start}`, kind: 'module',
                entry: entryPath, span: spanOf(node), componentIds, moduleId: moduleId ?? null,
                configIds: rootRoutes.map(expression => configIdFor(context, expression)), gaps } });
            }
          }
        }
        t.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return output;
}

function configIdFor(context: AnalysisContext, expression: ts.Expression): string {
  const array = arrayLiteralOf(context, expression) ?? expression;
  const [file, start] = relativeSpan(context, spanOf(array));
  return `config:${createHash('sha256').update(`${context.id} ${file} ${start}`).digest('hex').slice(0, 32)}`;
}

function occurrenceIdFor(context: AnalysisContext, definition: Span, loaders: readonly Span[]): string {
  const payload = JSON.stringify({ context: context.id, definition: relativeSpan(context, definition),
    loaders: loaders.map(span => relativeSpan(context, span)) });
  return `route:${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`;
}

function joinPattern(parent: string, segment: string | null, unresolved: boolean): string {
  const part = unresolved ? '(unresolved)' : segment ?? '';
  const base = parent === '/' ? '' : parent;
  if (!part) return base || '/';
  return `${base}/${part}`;
}

interface WalkInput {
  array: ts.ArrayLiteralExpression;
  configId: string;
  rooted: boolean;
  loaders: Span[];
  parent: RouteOccurrence | null;
  chain: ts.ArrayLiteralExpression[];
}

export function buildRouteGraph(context: AnalysisContext, catalog: Catalog, maze?: MazeGraph): RouteGraph {
  const t = context.toolchain.typescript;
  const evaluator = new StaticEvaluator(t, context.checker);
  const occurrences: RouteOccurrence[] = [];
  const configs = new Map<string, RouteConfig>();
  const diagnostics: string[] = [];
  const gaps: string[] = [];
  const visitedArrays = new Set<ts.ArrayLiteralExpression>();

  const stringOf = (object: ts.ObjectLiteralExpression, name: string): { value: string | null; present: boolean } => {
    const property = getProperty(t, object, name);
    if (!property) return { value: null, present: false };
    const result = evaluator.evaluate(property);
    return { value: result.known && typeof result.value === 'string' ? result.value : null, present: true };
  };

  const walk = (input: WalkInput): void => {
    if (input.chain.includes(input.array)) {
      gaps.push(`Route array cycle at ${spanOf(input.array).file}:${spanOf(input.array).line}`);
      return;
    }
    visitedArrays.add(input.array);
    const chain = [...input.chain, input.array];
    const siblings: string[] = [];
    for (const [order, element] of input.array.elements.entries()) {
      if (occurrences.length >= MAX_OCCURRENCES) { gaps.push('Route occurrence limit reached'); return; }
      const route = unwrap(t, element);
      if (!t.isObjectLiteralExpression(route)) {
        gaps.push(`Route entry is not a static object at ${spanOf(route).file}:${spanOf(route).line}`);
        continue;
      }
      const definition = spanOf(route);
      const localGaps: string[] = [];
      const conditions: RouteCondition[] = [...(input.parent?.conditions ?? [])];
      const pathProperty = stringOf(route, 'path');
      const matcher = getProperty(t, route, 'matcher');
      const pathUnresolved = (pathProperty.present && pathProperty.value === null) || (!pathProperty.present && !!matcher);
      if (matcher) conditions.push({ kind: 'matcher', text: `custom matcher ${matcher.getText().slice(0, 80)}`, span: spanOf(matcher) });
      if (pathProperty.present && pathProperty.value === null) localGaps.push('Route path is not statically resolvable');
      const pattern = joinPattern(input.parent?.pattern ?? '/', pathProperty.value, pathUnresolved);
      const pathMatch = stringOf(route, 'pathMatch');
      if (pathMatch.present) {
        conditions.push({ kind: 'path-match', text: `pathMatch=${pathMatch.value ?? 'unresolved'}`, span: definition });
      }
      for (const guard of ['canActivate', 'canActivateChild', 'canMatch', 'canLoad', 'canDeactivate']) {
        const value = getProperty(t, route, guard);
        if (value) conditions.push({ kind: 'guard', text: `${guard} ${value.getText().replace(/\s+/g, ' ').slice(0, 80)}`, span: spanOf(value) });
      }
      const providers = getProperty(t, route, 'providers');
      if (providers) conditions.push({ kind: 'providers', text: 'route providers change the injector for this subtree', span: spanOf(providers) });
      conditions.push({ kind: 'order', text: siblings.length
        ? `declared at index ${order}; preceded by ${siblings.map(item => item || '(empty path)').join(', ')}`
        : `declared at index ${order}; first candidate in its array`, span: definition });
      const outletProperty = stringOf(route, 'outlet');
      if (outletProperty.present) {
        conditions.push({ kind: 'outlet', text: `outlet=${outletProperty.value ?? 'unresolved'}`, span: definition });
      }
      const redirect = stringOf(route, 'redirectTo');
      if (redirect.present) {
        conditions.push({ kind: 'redirect', text: `redirects to ${redirect.value ?? 'unresolved destination'}`, span: definition });
      }
      const componentProperty = getProperty(t, route, 'component');
      const loadComponent = getProperty(t, route, 'loadComponent');
      let componentId: string | null = null;
      let componentUnresolved = false;
      if (componentProperty) {
        componentId = componentIdOf(context, catalog, componentProperty) ?? null;
        if (!componentId) { componentUnresolved = true; localGaps.push('Route component is not a catalogued component'); }
      } else if (loadComponent) {
        componentId = classIdOf(context, lazyTarget(context, loadComponent)) ?? null;
        if (componentId && !catalog.declarations.has(componentId)) componentId = null;
        if (!componentId) { componentUnresolved = true; localGaps.push('loadComponent target is not resolvable'); }
      }
      const occurrence: RouteOccurrence = {
        id: occurrenceIdFor(context, definition, input.loaders),
        configId: input.configId, rooted: input.rooted, definition, loaders: [...input.loaders],
        path: pathProperty.value, pathUnresolved, pattern,
        outlet: outletProperty.value, outletUnresolved: outletProperty.present && outletProperty.value === null,
        componentId, componentUnresolved, componentless: !componentProperty && !loadComponent,
        redirectTo: redirect.present ? redirect.value : null, order, conditions,
        parentId: input.parent?.id ?? null,
        hostRouteId: input.parent ? (input.parent.componentId ? input.parent.id : input.parent.hostRouteId) : null,
        gaps: localGaps,
      };
      occurrences.push(occurrence);
      siblings.push(pathProperty.value ?? '(unresolved)');

      const children = getProperty(t, route, 'children');
      if (children) {
        const array = arrayLiteralOf(context, children);
        if (array) walk({ array, configId: input.configId, rooted: input.rooted, loaders: [...input.loaders, spanOf(children)], parent: occurrence, chain });
        else localGaps.push('children is not a statically resolvable route array');
      }
      const loadChildren = getProperty(t, route, 'loadChildren');
      if (loadChildren) {
        const target = lazyTarget(context, loadChildren);
        const loaders = [...input.loaders, spanOf(loadChildren)];
        let array: ts.ArrayLiteralExpression | undefined;
        if (target && isConstVariable(context, target) && target.initializer) array = arrayLiteralOf(context, target.initializer);
        else if (target && t.isClassDeclaration(target)) {
          const moduleId = idForClass(context, target);
          const module = moduleId ? catalog.declarations.get(moduleId) : undefined;
          const imports = module && getProperty(t, module.metadata, 'imports');
          const list = imports && unwrap(t, imports);
          if (list && t.isArrayLiteralExpression(list)) {
            let forChild = 0;
            for (const item of list.elements) {
              const routes = routerModuleCall(context, item, 'forChild');
              if (!routes) continue;
              forChild++;
              const childArray = arrayLiteralOf(context, routes);
              const childConfig = configIdFor(context, routes);
              configs.set(childConfig, { id: childConfig, kind: 'forChild', span: spanOf(routes), bootstrapId: null, rooted: input.rooted });
              if (childArray) walk({ array: childArray, configId: input.configId, rooted: input.rooted, loaders: [...loaders, spanOf(item)], parent: occurrence, chain });
              else localGaps.push('RouterModule.forChild routes are not statically resolvable');
            }
            if (!forChild) localGaps.push(`Lazy NgModule ${moduleId} declares no RouterModule.forChild routes`);
          } else localGaps.push('Lazy NgModule imports are not statically resolvable');
        }
        if (array) walk({ array, configId: input.configId, rooted: input.rooted, loaders, parent: occurrence, chain });
        else if (!target) localGaps.push('loadChildren target is not resolvable');
      }
    }
  };

  const found = findBootstraps(context, catalog);
  const bootstraps = found.map(item => item.bootstrap);
  if (!context.entry.length) gaps.push('No application entry is known; no root router configuration can be attached to a bootstrap');
  else if (!bootstraps.length) gaps.push('No bootstrapApplication or bootstrapModule call is reachable from the selected entry');
  for (const { bootstrap, rootRoutes } of found) {
    for (const expression of rootRoutes) {
      const id = configIdFor(context, expression);
      const array = arrayLiteralOf(context, expression);
      configs.set(id, { id, kind: bootstrap.kind === 'application' ? 'provideRouter' : 'forRoot',
        span: spanOf(expression), bootstrapId: bootstrap.id, rooted: true });
      if (!array) { gaps.push(`Root route configuration is not a statically resolvable array at ${spanOf(expression).file}:${spanOf(expression).line}`); continue; }
      walk({ array, configId: id, rooted: true, loaders: [bootstrap.span], parent: null, chain: [] });
    }
  }

  // P6-05/P6-10: route arrays with an unknown load origin stay unresolved instead of being attached to a
  // bootstrap, and runtime reconfiguration is recorded as a gap in the reconstructed reachability.
  const registerLoose = (expression: ts.Expression, kind: RouteConfig['kind']): void => {
    const array = arrayLiteralOf(context, expression);
    if (!array || visitedArrays.has(array)) return;
    const id = configIdFor(context, expression);
    if (configs.get(id)?.rooted) return;
    configs.set(id, { id, kind, span: spanOf(expression), bootstrapId: null, rooted: false });
    gaps.push(`Route array at ${slash(path.relative(context.workspaceRoot, spanOf(array).file))}:${spanOf(array).line} is not reachable from a resolved root router configuration`);
    walk({ array, configId: id, rooted: false, loaders: [], parent: null, chain: [] });
  };
  for (const file of context.sourceFiles) {
    const source = context.program.getSourceFile(file);
    if (!source) continue;
    const loose: { expression: ts.Expression; kind: RouteConfig['kind'] }[] = [];
    const visit = (node: ts.Node): void => {
      if (t.isCallExpression(node)) {
        if (t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'resetConfig' &&
          isRouterReceiver(context, node.expression.expression)) {
          gaps.push(`Dynamic route configuration via resetConfig at ${slash(path.relative(context.workspaceRoot, file))}:${spanOf(node).line} is outside the reconstructed reachability`);
        }
        for (const method of ['forRoot', 'forChild'] as const) {
          const routes = routerModuleCall(context, node, method);
          if (routes) loose.push({ expression: routes, kind: method });
        }
        if (calleeName(context, node) === 'provideRouter' && node.arguments[0] &&
          fromAngular(context, t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression, 'router')) {
          loose.push({ expression: node.arguments[0]!, kind: 'provideRouter' });
        }
      }
      if (t.isVariableDeclaration(node) && node.type && node.initializer &&
        /^(?:Routes|Route\[\])$/.test(node.type.getText())) loose.push({ expression: node.initializer, kind: 'routes-array' });
      t.forEachChild(node, visit);
    };
    visit(source);
    for (const item of loose) registerLoose(item.expression, item.kind);
  }

  const byId = new Map(occurrences.map(occurrence => [occurrence.id, occurrence]));
  const byComponent = new Map<string, RouteOccurrence[]>();
  for (const occurrence of occurrences) {
    if (!occurrence.componentId) continue;
    byComponent.set(occurrence.componentId, [...(byComponent.get(occurrence.componentId) ?? []), occurrence]);
  }
  const bootstrapByComponent = new Map<string, BootstrapOccurrence[]>();
  for (const bootstrap of bootstraps) {
    gaps.push(...bootstrap.gaps.map(gap => `${bootstrap.id}: ${gap}`));
    for (const id of bootstrap.componentIds) {
      bootstrapByComponent.set(id, [...(bootstrapByComponent.get(id) ?? []), bootstrap]);
    }
  }
  // ngmaze route rows are cross-checked only; RouteEntry.host is never read as a parent relation (P6-05).
  for (const route of maze?.routes ?? []) {
    const matched = occurrences.some(occurrence => occurrence.componentId === route.target &&
      slash(path.relative(context.workspaceRoot, occurrence.definition.file)) === slash(route.location.file) &&
      occurrence.definition.line <= route.location.line && route.location.line <= occurrence.definition.endLine);
    if (!matched) diagnostics.push(`ngmaze route ${route.path} -> ${route.target} at ${route.location.file}:${route.location.line} was not reconstructed from source`);
  }
  return { occurrences, byId, byComponent, configs, bootstraps, bootstrapByComponent,
    redirects: occurrences.filter(occurrence => occurrence.redirectTo !== null),
    diagnostics: [...new Set(diagnostics)], gaps: [...new Set(gaps)] };
}

export type OutletPlacement =
  | { kind: 'outlet'; element: IndexedElement; hostId: string; conditions: string[] }
  | { kind: 'unresolved'; reason: string };

/** P6-06/P6-07: look for the outlet only inside the nearest display host's own template and child views. */
export function resolveOutletPlacement(context: AnalysisContext, graph: RouteGraph, index: TemplateIndex,
  occurrence: RouteOccurrence): OutletPlacement[] {
  if (!occurrence.rooted) {
    return [{ kind: 'unresolved', reason: `Route ${occurrence.pattern} is not reachable from a resolved root router configuration` }];
  }
  const hostRoute = occurrence.hostRouteId ? graph.byId.get(occurrence.hostRouteId) : undefined;
  let hostIds: string[];
  if (hostRoute?.componentId) hostIds = [hostRoute.componentId];
  else {
    const config = graph.configs.get(occurrence.configId);
    const bootstrap = config?.bootstrapId ? graph.bootstraps.find(item => item.id === config.bootstrapId) : undefined;
    if (!bootstrap) return [{ kind: 'unresolved', reason: `Route ${occurrence.pattern} has no resolved bootstrap host` }];
    if (!bootstrap.componentIds.length) return [{ kind: 'unresolved', reason: `Bootstrap ${bootstrap.id} has no resolved component` }];
    hostIds = bootstrap.componentIds;
  }
  const results: OutletPlacement[] = [];
  for (const hostId of hostIds) {
    const owned = index.byOwner.get(hostId) ?? [];
    const outlets = owned.filter(element => element.tag === 'router-outlet');
    if (!outlets.length) { results.push({ kind: 'unresolved', reason: `${hostId} declares no <router-outlet> for route ${occurrence.pattern}` }); continue; }
    const named = outlets.filter(element => {
      if (element.boundAttributes.includes('name')) return true;
      const name = element.staticAttributes.get('name') ?? null;
      return name === occurrence.outlet;
    });
    if (!named.length) {
      results.push({ kind: 'unresolved', reason: `${hostId} has no ${occurrence.outlet ?? 'primary'} <router-outlet> for route ${occurrence.pattern}` });
      continue;
    }
    if (named.length > 1) {
      results.push({ kind: 'unresolved', reason: `${hostId} has ${named.length} <router-outlet> elements that match ${occurrence.outlet ?? 'primary'}; the placement cannot be narrowed` });
      continue;
    }
    const element = named[0]!;
    if (element.boundAttributes.includes('name')) {
      results.push({ kind: 'unresolved', reason: `<router-outlet [name]> in ${hostId} is bound at runtime; the outlet name cannot be confirmed` });
      continue;
    }
    const conditions: string[] = [];
    let blocked: string | null = null;
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.component) { blocked = `<router-outlet> is projected into ${ancestor.component}; the router context is unresolved`; break; }
      if (ancestor.tag === 'ng-template' && ancestor.references.length) {
        blocked = `<router-outlet> is declared inside TemplateRef #${ancestor.references[0]}; the router context is unresolved`; break;
      }
      if (ancestor.node.constructor.name === 'Template') conditions.push(`embedded view ${ancestor.tag} exists`);
    }
    if (element.repeated) conditions.push('@for iteration exists; individual row is not identified');
    if (blocked) { results.push({ kind: 'unresolved', reason: blocked }); continue; }
    results.push({ kind: 'outlet', element, hostId, conditions });
  }
  return results;
}
