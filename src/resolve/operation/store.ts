import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog, Declaration } from '../../index/catalog.js';
import { getProperty, idForClass, unwrap } from '../../index/catalog.js';
import { location } from './reactive.js';
import { tokenId } from './di.js';
import { importedApi } from './reactive.js';
import { ScopeResolver } from '../scope/index.js';
import { lazyTarget, type BootstrapOccurrence, type RouteGraph, type RouteOccurrence } from '../view/routes.js';

export interface StoreRegistration { kind: 'root' | 'feature' | 'effects'; scope: 'root' | 'route' | 'module';
  key: string | null; target: string | null; source: string; conditions: string[]; status: 'resolved' | 'boundary' }
export interface StoreAction { id: string; type: string | null; source: string }
export interface StoreReducer { id: string; feature: string | null; actions: string[]; source: string;
  registered: boolean; conditions: string[] }
export interface StoreEffect { id: string; owner: string | null; listens: string[]; emits: string[];
  explicitDispatches: string[]; emissionConditions: Record<string,string[]>;
  dispatch: boolean; functional: boolean; registered: boolean; source: string; conditions: string[]; gaps: string[] }
export interface StoreSelector { id: string; dependencies: string[]; source: string }
export interface StoreConsumer { id: string; selector: string; owner: string; kind: 'select' | 'selectSignal' | 'template';
  source: string; active: boolean; conditions: string[] }
export interface StoreComputed { id: string; owner: string; from: string; source: string; active: boolean;
  conditions: string[] }
export interface StoreGraph { registrations: StoreRegistration[]; actions: StoreAction[]; reducers: StoreReducer[];
  effects: StoreEffect[]; selectors: StoreSelector[]; consumers: StoreConsumer[]; computeds: StoreComputed[];
  diagnostics: string[] }
export interface StoreInputs { rootProviders: ts.Expression[]; routeProviders?: ts.Expression[];
  modules?: ts.ClassDeclaration[]; routeModules?: ts.ClassDeclaration[] }

/** Collects providers only from a selected bootstrap and its selected route ancestry. */
export function storeInputsForSelection(context: AnalysisContext, catalog: Catalog, routes: RouteGraph,
  bootstrap: BootstrapOccurrence, route?: RouteOccurrence): StoreInputs {
  const t = context.toolchain.typescript;
  const rootProviders: ts.Expression[] = [];
  const routeProviders: ts.Expression[] = [];
  const modules: ts.ClassDeclaration[] = [];
  const routeModules: ts.ClassDeclaration[] = [];
  const at = (file: string, start: number): ts.Node | null => {
    const source = context.program.getSourceFile(file);
    if (!source) return null;
    let result: ts.Node | null = null;
    const visit = (node: ts.Node): void => {
      if (node.getStart() === start && (t.isCallExpression(node) || t.isObjectLiteralExpression(node))) result = node;
      if (node.getStart() <= start && node.getEnd() > start) t.forEachChild(node,visit);
    };
    visit(source);
    return result;
  };
  const configProviders = (expression: ts.Expression, active = new Set<ts.Node>()): ts.Expression[] => {
    const node = definition(context,expression);
    if (active.has(node)) return [];
    active.add(node);
    if (t.isObjectLiteralExpression(node)) {
      const list = getProperty(t,node,'providers');
      return list ? [list] : [];
    }
    if (t.isCallExpression(node) && angularApi(context,
      t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression,'mergeApplicationConfig'))
      return node.arguments.flatMap(arg => configProviders(arg,active));
    return [];
  };
  const bootstrapNode = at(bootstrap.span.file,bootstrap.span.start);
  if (bootstrapNode && t.isCallExpression(bootstrapNode) && bootstrap.kind === 'application' && bootstrapNode.arguments[1])
    rootProviders.push(...configProviders(bootstrapNode.arguments[1]));
  if (bootstrap.moduleId) {
    const module = catalog.declarations.get(bootstrap.moduleId);
    if (module) { modules.push(module.node); const providers = getProperty(t,module.metadata,'providers');
      if (providers) rootProviders.push(providers); }
  }
  const chain: RouteOccurrence[] = [];
  const seen = new Set<string>();
  const selectedConfig = route && routes.configs.get(route.configId);
  let cursor = selectedConfig?.bootstrapId === bootstrap.id ? route : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? routes.byId.get(cursor.parentId) : undefined;
  }
  for (const occurrence of chain) {
    const node = at(occurrence.definition.file,occurrence.definition.start);
    if (!node || !t.isObjectLiteralExpression(node)) continue;
    const providers = getProperty(t,node,'providers');
    if (providers) routeProviders.push(providers);
    const loader = getProperty(t,node,'loadChildren');
    const target = loader && lazyTarget(context,loader);
    if (target && t.isClassDeclaration(target)) {
      const id = idForClass(context,target);
      if (id && catalog.declarations.get(id)?.kind === 'module') routeModules.push(target);
    }
  }
  return { rootProviders, routeProviders, modules, routeModules };
}
const slash = (s: string): string => s.replaceAll('\\', '/');
function symbol(context: AnalysisContext, node: ts.Node): ts.Symbol | undefined {
  const t = context.toolchain.typescript;
  let found = context.checker.getSymbolAtLocation(node);
  if (found && found.flags & t.SymbolFlags.Alias) found = context.checker.getAliasedSymbol(found);
  return found;
}
function packageApi(context: AnalysisContext, node: ts.Node, name: string, pkg: 'store' | 'effects'): boolean {
  const found = symbol(context, node);
  return found?.getName() === name && !!found.declarations?.some(d =>
    slash(d.getSourceFile().fileName).includes(`/node_modules/@ngrx/${pkg}/`));
}
function angularApi(context: AnalysisContext, node: ts.Node, name: string): boolean {
  const found = symbol(context,node);
  return found?.getName() === name && !!found.declarations?.some(d =>
    slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/'));
}
function callName(context: AnalysisContext, node: ts.CallExpression, name: string, pkg: 'store' | 'effects'): boolean {
  const t = context.toolchain.typescript;
  const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
  if (packageApi(context, callee, name, pkg)) return true;
  if (!t.isPropertyAccessExpression(node.expression) || node.expression.name.text !== name) return false;
  const owner = symbol(context, node.expression.expression);
  return owner?.getName() === (pkg === 'store' ? 'StoreModule' : 'EffectsModule') &&
    !!owner.declarations?.some(d => slash(d.getSourceFile().fileName).includes(`/node_modules/@ngrx/${pkg}/`));
}
function definition(context: AnalysisContext, expression: ts.Expression): ts.Expression {
  const t = context.toolchain.typescript;
  let node = unwrap(t, expression);
  const visited = new Set<ts.Node>();
  while ((t.isIdentifier(node) || t.isPropertyAccessExpression(node)) && !visited.has(node)) {
    visited.add(node);
    const declaration = symbol(context, t.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
    if (!declaration || !t.isVariableDeclaration(declaration) || !declaration.initializer) break;
    node = unwrap(t, declaration.initializer);
  }
  return node;
}
function array(context: AnalysisContext, expression: ts.Expression): ts.Expression[] | null {
  const t = context.toolchain.typescript;
  const node = definition(context, expression);
  if (!t.isArrayLiteralExpression(node)) return null;
  const result: ts.Expression[] = [];
  for (const element of node.elements) {
    if (t.isSpreadElement(element)) {
      const nested = array(context, element.expression);
      if (!nested) return null;
      result.push(...nested);
    } else result.push(element);
  }
  return result;
}
function stringValue(context: AnalysisContext, expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  const t = context.toolchain.typescript;
  const node = definition(context, expression);
  return t.isStringLiteralLike(node) ? node.text : null;
}
function actionId(context: AnalysisContext, expression: ts.Expression): string {
  const t = context.toolchain.typescript;
  const node = t.isCallExpression(expression) ? expression.expression : expression;
  return tokenId(context, node);
}
function expressions(context: AnalysisContext, node: ts.Node, predicate: (call: ts.CallExpression) => boolean): ts.CallExpression[] {
  const t = context.toolchain.typescript;
  const result: ts.CallExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (t.isCallExpression(child) && predicate(child)) result.push(child);
    t.forEachChild(child, visit);
  };
  visit(node);
  return result;
}
function register(context: AnalysisContext, input: ts.Expression, scope: StoreRegistration['scope'],
  output: StoreRegistration[], diagnostics: string[]): void {
  const t = context.toolchain.typescript;
  const values = array(context, input) ?? [input];
  for (const value of values) {
    const node = definition(context, value);
    if (!t.isCallExpression(node)) {
      if (t.isArrayLiteralExpression(node)) for (const item of node.elements) register(context, item, scope, output, diagnostics);
      continue;
    }
    const root = callName(context, node, 'provideStore', 'store') || callName(context, node, 'forRoot', 'store');
    const feature = callName(context, node, 'provideState', 'store') || callName(context, node, 'forFeature', 'store');
    const effects = callName(context, node, 'provideEffects', 'effects') || callName(context, node, 'forRoot', 'effects') ||
      callName(context, node, 'forFeature', 'effects');
    if (!root && !feature && !effects) {
      if (angularApi(context,t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression,
        'importProvidersFrom'))
        for (const arg of node.arguments) register(context, arg, scope, output, diagnostics);
      continue;
    }
    const kind: StoreRegistration['kind'] = effects ? 'effects' : feature ? 'feature' : 'root';
    if (effects) {
      const args = node.arguments.flatMap(arg => array(context, arg) ?? [arg]);
      for (const arg of args) {
        const resolved = definition(context,arg);
        const targets: ts.Node[] = t.isObjectLiteralExpression(resolved) ? resolved.properties.flatMap((property): ts.Node[] =>
          t.isShorthandPropertyAssignment(property) ? (() => {
            const value = context.checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration;
            return [value && t.isVariableDeclaration(value) ? value.name : property.name];
          })() :
            t.isPropertyAssignment(property) ? [property.initializer] : []) : [arg];
        for (const target of targets) output.push({ kind, scope, key: null, target: tokenId(context, target),
          source: location(context, node), conditions: scope === 'route' ? ['lazy route injector must be active'] : [],
          status: tokenId(context, target).startsWith('unresolved:') ? 'boundary' : 'resolved' });
      }
    } else {
      const first = node.arguments[0];
      const rootMap = root && first ? definition(context,first) : null;
      if (rootMap && t.isObjectLiteralExpression(rootMap)) {
        output.push({ kind:'root', scope, key:null, target:null, source:location(context,node),
          conditions:scope === 'route' ? ['route injector must be active'] : [], status:'resolved' });
        for (const property of rootMap.properties) {
          if (!t.isPropertyAssignment(property)) { diagnostics.push(`Unresolved root reducer at ${location(context,property)}`); continue; }
          const name = t.isIdentifier(property.name) || t.isStringLiteralLike(property.name) ? property.name.text : null;
          output.push({ kind:'feature', scope, key:name, target:tokenId(context,property.initializer),
            source:location(context,property), conditions:scope === 'route' ? ['route injector must be active'] : [],
            status:name ? 'resolved' : 'boundary' });
        }
        continue;
      }
      const key = feature && first ? stringValue(context, first) ??
        (t.isObjectLiteralExpression(definition(context, first)) ?
          stringValue(context, getProperty(t, definition(context, first) as ts.ObjectLiteralExpression, 'name')) : null) : null;
      const target = feature ? node.arguments[1] ?? first : first;
      const id = target ? tokenId(context, target) : null;
      output.push({ kind, scope, key, target: id, source: location(context, node),
        conditions: scope === 'route' ? ['lazy route injector must be active'] : [],
        status: feature && (!key || !target) ? 'boundary' : 'resolved' });
      if (feature && !key) diagnostics.push(`Unresolved feature key at ${location(context, node)}`);
    }
  }
}

/** Catalogues NgRx behavior, then joins it only to the supplied active injector registrations. */
export function analyzeStore(context: AnalysisContext, catalog: Catalog, inputs: StoreInputs): StoreGraph {
  const t = context.toolchain.typescript;
  const registrations: StoreRegistration[] = [];
  const diagnostics: string[] = [];
  for (const expression of inputs.rootProviders) register(context, expression, 'root', registrations, diagnostics);
  for (const expression of inputs.routeProviders ?? []) register(context, expression, 'route', registrations, diagnostics);
  for (const [module,scope] of [...(inputs.modules ?? []).map(item => [item,'module'] as const),
    ...(inputs.routeModules ?? []).map(item => [item,'route'] as const)]) {
    for (const decorator of t.getDecorators(module) ?? []) {
      if (!t.isCallExpression(decorator.expression)) continue;
      const metadata = decorator.expression.arguments[0];
      if (!metadata || !t.isObjectLiteralExpression(metadata)) continue;
      const imports = getProperty(t, metadata, 'imports');
      if (imports) register(context, imports, scope, registrations, diagnostics);
    }
  }
  const actions: StoreAction[] = [];
  const reducers: StoreReducer[] = [];
  const selectors: StoreSelector[] = [];
  const effects: StoreEffect[] = [];
  const consumers: StoreConsumer[] = [];
  const computeds: StoreComputed[] = [];
  const rootActive = registrations.some(reg => reg.kind === 'root' && reg.status === 'resolved');
  const readCache = new Map<string,{reads:Set<string>; asyncReads:Set<string>}>();
  const templateReads = (owner: Declaration): {reads:Set<string>; asyncReads:Set<string>} => {
    const cached = readCache.get(owner.id);
    if (cached) return cached;
    const reads = new Set<string>();
    const asyncReads = new Set<string>();
    if (owner.template.kind === 'none') return {reads,asyncReads};
    const ng = context.toolchain.angularCompiler;
    const parsed = ng.parseTemplate(owner.template.text,owner.template.file);
    const scope = new ScopeResolver(catalog).scopeOf(owner);
    const hasAsync = [...scope.ids].some(id => id.endsWith('#AsyncPipe') &&
      slash(id).includes('/node_modules/@angular/common/'));
    const visitor = new class extends ng.RecursiveAstVisitor {
      override visitPropertyRead(ast: InstanceType<typeof ng.PropertyRead>, value: unknown): unknown {
        reads.add(ast.name);
        return super.visitPropertyRead(ast,value);
      }
      override visitPipe(ast: InstanceType<typeof ng.BindingPipe>, value: unknown): unknown {
        if (hasAsync && ast.name === 'async') {
          const collector = new class extends ng.RecursiveAstVisitor {
            override visitPropertyRead(part: InstanceType<typeof ng.PropertyRead>, inner: unknown): unknown {
              asyncReads.add(part.name);
              return super.visitPropertyRead(part,inner);
            }
          }();
          ast.exp.visit(collector);
        }
        return super.visitPipe(ast,value);
      }
    }();
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (value instanceof ng.AST) { value.visit(visitor); return; }
      if (Array.isArray(value)) { for (const item of value) walk(item); return; }
      for (const [key,item] of Object.entries(value)) if (['children','inputs','outputs','templateAttrs','value','expression'].includes(key)) walk(item);
    };
    walk(parsed.nodes);
    const result = {reads,asyncReads};
    readCache.set(owner.id,result);
    return result;
  };
  for (const fileName of context.sourceFiles) {
    const file = context.program.getSourceFile(fileName);
    if (!file) continue;
    const visit = (node: ts.Node): void => {
      if (t.isVariableDeclaration(node) && node.initializer && t.isCallExpression(node.initializer)) {
        const call = node.initializer;
        if (callName(context, call, 'createAction', 'store'))
          actions.push({ id: tokenId(context, node.name), type: stringValue(context, call.arguments[0]),
            source: location(context, node) });
        if (callName(context, call, 'createSelector', 'store'))
          selectors.push({ id: tokenId(context, node.name), dependencies: call.arguments.slice(0,-1).flatMap(arg => {
            const value = [actionId(context,arg)];
            const body = t.isArrowFunction(arg) || t.isFunctionExpression(arg) ? arg.body : arg;
            if (t.isPropertyAccessExpression(body)) value.push(body.name.text);
            return value;
          }),
            source: location(context,node) });
        if (callName(context, call, 'createFeatureSelector', 'store'))
          selectors.push({ id:tokenId(context,node.name), dependencies:stringValue(context,call.arguments[0]) ?
            [stringValue(context,call.arguments[0])!] : [], source:location(context,node) });
        if (callName(context, call, 'createReducer', 'store')) {
          const handled = call.arguments.slice(1).flatMap(arg => {
            const on = definition(context, arg);
            return t.isCallExpression(on) && callName(context,on,'on','store') ?
              on.arguments.slice(0,-1).map(action => actionId(context, action)) : [];
          });
          const id = tokenId(context,node.name);
          const matches = registrations.filter(reg => reg.kind !== 'effects' && reg.target === id);
          reducers.push({ id, feature: matches.find(reg => reg.kind === 'feature')?.key ?? null,
            actions: handled, source: location(context,node), registered: rootActive && matches.length > 0,
            conditions: [...matches.flatMap(reg => reg.conditions),
              ...(rootActive ? [] : ['root Store is not registered'])] });
        }
      }
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) &&
        ['select','selectSignal'].includes(node.expression.name.text)) {
        const receiver = context.checker.getTypeAtLocation(node.expression.expression).getSymbol();
        if (receiver?.getName() === 'Store' && receiver.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@ngrx/store/'))) {
          const owner = [...catalog.declarations.values()].find(d => d.node.getSourceFile() === node.getSourceFile() &&
            node.getStart() >= d.node.getStart() && node.getEnd() <= d.node.getEnd());
          if (owner && node.arguments[0]) {
            const field = t.isPropertyDeclaration(node.parent) ? node.parent.name.getText() : null;
            const {reads,asyncReads} = templateReads(owner);
            const subscribed = field && expressions(context,owner.node,part =>
              t.isPropertyAccessExpression(part.expression) && part.expression.name.text === 'subscribe' &&
              part.expression.expression.getText().includes(field)).length > 0;
            const active = !!field && (node.expression.name.text === 'selectSignal' ? reads.has(field) :
              asyncReads.has(field) || !!subscribed);
            consumers.push({ id: location(context,node), selector: actionId(context,node.arguments[0]),
            owner: owner.id, kind: node.expression.name.text as 'select' | 'selectSignal', source: location(context,node),
            active, conditions: ['consumer must be instantiated', 'selected projection must change for a new emitted value',
              ...(active ? [] : ['no template read or subscription is confirmed'])] });
          }
        }
      }
      t.forEachChild(node,visit);
    };
    visit(file);
  }
  const actionTypes = new Map<string,string[]>();
  for (const owner of catalog.declarations.values()) {
    if (owner.kind !== 'component') continue;
    const {reads} = templateReads(owner);
    for (const member of owner.node.members) {
      if (!t.isPropertyDeclaration(member) || !member.initializer || !t.isCallExpression(member.initializer)) continue;
      const call = member.initializer;
      const callee = t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
      if (importedApi(context,callee)?.name !== 'computed') continue;
      const name = member.name.getText();
      const from = consumers.filter(item => item.owner === owner.id && item.kind === 'selectSignal').filter(item => {
        const source = owner.node.members.find(field => t.isPropertyDeclaration(field) && field.initializer &&
          location(context,field.initializer) === item.id);
        return source && expressions(context,call,inner => t.isPropertyAccessExpression(inner.expression) &&
          inner.expression.expression.kind === t.SyntaxKind.ThisKeyword &&
          inner.expression.name.text === source.name?.getText()).length > 0;
      });
      for (const consumer of from) {
        const active = reads.has(name);
        computeds.push({ id:location(context,member), owner:owner.id, from:consumer.id,
          source:location(context,call), active,
          conditions:['computed value is evaluated lazily when read',
            'tracked selector signal read must change its projected value',
            ...(active ? [] : ['computed result has no confirmed template consumer'])] });
        if (active) consumer.active = true;
      }
    }
  }
  for (const action of actions) if (action.type) actionTypes.set(action.type,[...(actionTypes.get(action.type) ?? []),action.id]);
  for (const [type, ids] of actionTypes) if (ids.length > 1)
    diagnostics.push(`Action type collision ${JSON.stringify(type)}: ${ids.join(', ')}`);
  const effectCalls = context.sourceFiles.flatMap(fileName => {
    const file = context.program.getSourceFile(fileName);
    return file ? expressions(context,file,call => callName(context,call,'createEffect','effects')) : [];
  });
  for (const call of effectCalls) {
    const parent = call.parent;
    const owner = t.isPropertyDeclaration(parent) && t.isClassDeclaration(parent.parent) ?
      tokenId(context,parent.parent.name ?? parent.parent) : null;
    const functional = !!call.arguments[1] && t.isObjectLiteralExpression(call.arguments[1]) &&
      getProperty(t,call.arguments[1],'functional')?.kind === t.SyntaxKind.TrueKeyword;
    const effectId = t.isPropertyDeclaration(parent) || t.isVariableDeclaration(parent) ? tokenId(context,parent.name) : location(context,call);
    const registered = rootActive && registrations.some(reg => reg.kind === 'effects' &&
      (reg.target === owner || reg.target === effectId));
    const ofTypes = expressions(context,call,part => callName(context,part,'ofType','effects'));
    const listens = ofTypes.flatMap(part => part.arguments.map(arg => {
      const type = stringValue(context,arg);
      return type ? `type:${type}` : actionId(context,arg);
    }));
    const dispatch = !call.arguments[1] || !t.isObjectLiteralExpression(call.arguments[1]) ||
      getProperty(t,call.arguments[1],'dispatch')?.kind !== t.SyntaxKind.FalseKeyword;
    const emitted: string[] = [];
    const explicitDispatches: string[] = [];
    const emissionConditions: Record<string,string[]> = {};
    const gaps: string[] = [];
    const returning = (callback: ts.Expression): ts.Expression[] => {
      if (!t.isArrowFunction(callback) && !t.isFunctionExpression(callback)) return [];
      if (!t.isBlock(callback.body)) return [callback.body];
      return callback.body.statements.filter(t.isReturnStatement)
        .flatMap(statement => statement.expression ? [statement.expression] : []);
    };
    const actionReturns = (value: ts.Expression): string[] => {
      const result = definition(context,value);
      if (t.isConditionalExpression(result)) return [...actionReturns(result.whenTrue),...actionReturns(result.whenFalse)];
      if (!t.isCallExpression(result)) return [];
      const id = actionId(context,result);
      if (actions.some(action => action.id === id)) return [id];
      const callee = t.isPropertyAccessExpression(result.expression) ? result.expression.name : result.expression;
      if (importedApi(context,callee)?.name === 'of') return result.arguments.flatMap(actionReturns);
      return [];
    };
    for (const outer of expressions(context,call,part => {
      const callee = t.isPropertyAccessExpression(part.expression) ? part.expression.name : part.expression;
      const name = importedApi(context,callee)?.name;
      return !!name && ['map','mergeMap','switchMap','concatMap','exhaustMap','catchError'].includes(name);
    })) {
      const callee = t.isPropertyAccessExpression(outer.expression) ? outer.expression.name : outer.expression;
      const name = importedApi(context,callee)?.name;
      for (const callback of outer.arguments) for (const returned of returning(callback))
        for (const id of actionReturns(returned)) {
          emitted.push(id);
          emissionConditions[id] = name === 'catchError' ? ['error notification'] : ['successful source notification'];
        }
    }
    for (const inner of expressions(context,call,part => t.isPropertyAccessExpression(part.expression) &&
      part.expression.name.text === 'dispatch')) {
      const receiver = (inner.expression as ts.PropertyAccessExpression).expression;
      const type = context.checker.getTypeAtLocation(receiver).getSymbol();
      if (type?.getName() !== 'Store' || !type.declarations?.some(d =>
        slash(d.getSourceFile().fileName).includes('/node_modules/@ngrx/store/'))) continue;
      const arg = inner.arguments[0];
      if (arg) explicitDispatches.push(actionId(context,arg));
    }
    if (!ofTypes.length) gaps.push('effect input action is not statically identified');
    if (dispatch && !emitted.length) gaps.push('effect output action is not statically confirmed');
    effects.push({ id:effectId, owner, listens, emits:[...new Set(emitted)], explicitDispatches:[...new Set(explicitDispatches)],
      emissionConditions, dispatch, functional,
      registered, source:location(context,call),
      conditions:[...(registered ? [] : ['effect is not registered in the selected injector']),
        ...(registrations.filter(reg => reg.kind === 'effects' && reg.target === owner).flatMap(reg => reg.conditions)),
        ...(dispatch ? ['returned action is automatically dispatched after emission'] : ['dispatch:false suppresses automatic dispatch'])], gaps });
  }
  return { registrations, actions, reducers, effects, selectors, consumers, computeds, diagnostics };
}
