import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog, Declaration } from '../../index/catalog.js';
import { classMethod } from '../../index/catalog.js';
import { matchIdentifier } from '../../adapters/reactive/capabilities.js';
import type { ReactiveMethodGraph } from '../../adapters/reactive/methods.js';
import { storeLifetime, type SignalStoreCatalog } from '../../adapters/reactive/signal-store.js';
import { importedApi, location } from './reactive.js';
import { httpBranchEffect, resolveUrl, rxjsExport, type HttpBranch, type HttpCatalog, type HttpRequestSite } from './http.js';
import { externalToken, injectionRequestFor, resolveInjection, tokenId, type InjectorLayer } from './di.js';
import type { StoreEffect, StoreGraph } from './store.js';
import type { EventConsumer } from '../../adapters/reactive/events.js';

/** Where the created value is actually subscribed. `none` leaves the request a candidate, not a call. */
export type ConsumptionKind = 'subscribe' | 'promise-consume' | 'promise-result' | 'to-signal' | 'async-pipe' |
  'rx-method' | 'effect-flattening' | 'event-handler' | 'none';
export interface HttpConsumption {
  kind: ConsumptionKind;
  location: string;
  /** What must be registered, created or called before this consumption can run. */
  registration: string[];
  registered: boolean;
  conditions: string[];
  branches: HttpBranch[];
  gaps: string[];
}
export interface HttpRequestFlow {
  request: HttpRequestSite;
  /** `confirmed` needs a subscription and a confirmed registration; everything else stays a candidate. */
  start: 'confirmed' | 'candidate';
  consumption: HttpConsumption;
  /** The call sites passed while following the value out of the wrappers that return it. */
  stages: string[];
  reason: string | null;
}
export interface HttpFlowInputs {
  catalog?: Catalog;
  store?: StoreGraph;
  methods?: ReactiveMethodGraph;
  stores?: SignalStoreCatalog;
}
export type HttpStepKind = 'call' | 'http-create' | 'http-consume' | 'type-use' | 'boundary';
export interface HttpStep { kind: HttpStepKind; source: string; target: string; location: string; path: string[];
  conditions: string[]; detail: string | null; flowIndex?: number }
export interface HttpTrace { steps: HttpStep[]; flows: HttpRequestFlow[]; diagnostics: string[] }

const DEPTH = 64;
const LIMIT = 10000;
const STAGES = 8;
const combiners = new Set(['forkJoin', 'combineLatest', 'zip', 'merge', 'concat', 'race', 'from', 'defer', 'iif']);
const flatteners = new Set(['switchMap', 'mergeMap', 'concatMap', 'exhaustMap', 'catchError', 'expand']);

function isFunctionLike(t: typeof ts, node: ts.Node): node is ts.FunctionLikeDeclaration {
  return t.isArrowFunction(node) || t.isFunctionExpression(node) || t.isFunctionDeclaration(node) ||
    t.isMethodDeclaration(node) || t.isGetAccessorDeclaration(node);
}
function parenLike(t: typeof ts, node: ts.Node): boolean {
  return t.isParenthesizedExpression(node) || t.isAsExpression(node) || t.isSatisfiesExpression(node) ||
    t.isNonNullExpression(node);
}
function memberCall(t: typeof ts, current: ts.Node): { name: string; call: ts.CallExpression } | null {
  const access = current.parent;
  if (!t.isPropertyAccessExpression(access) || access.expression !== current) return null;
  const call = access.parent;
  return t.isCallExpression(call) && call.expression === access ? { name: access.name.text, call } : null;
}
/** Collects the operators of a `pipe(...)` call, skipping the argument the value itself occupies. */
function pipeArguments(context: AnalysisContext, call: ts.CallExpression, skip: ts.Node | null,
  branches: HttpBranch[], gaps: string[], conditions: string[]): void {
  const t = context.toolchain.typescript;
  for (const argument of call.arguments) {
    if (argument === skip) continue;
    const callee = t.isCallExpression(argument)
      ? (t.isPropertyAccessExpression(argument.expression) ? argument.expression.name : argument.expression) : argument;
    const name = rxjsExport(context, callee);
    // An operator of a registered reactive API (ofType, tapResponse) is known without being an rxjs export.
    if (!name && !matchIdentifier(context, callee) && importedApi(context, callee)?.name !== 'concatLatestFrom') {
      gaps.push(`operator ${callee.getText()} at ${location(context, argument)} is not a resolved rxjs export; the HTTP pipeline past it is unresolved`);
      continue;
    }
    const effect = name ? httpBranchEffect(name) : null;
    const place = location(context, argument);
    if (name === 'filter' && t.isCallExpression(argument) && argument.arguments[0])
      conditions.push(`filter requires ${argument.arguments[0]!.getText()}`);
    if (name && effect && !branches.some(item => item.operator === name && item.location === place))
      branches.push({ operator: name, location: place, effect });
  }
}
/** A member access can carry an instantiated symbol, so identity is compared through the declarations. */
function declarationsAt(context: AnalysisContext, node: ts.Node): readonly ts.Declaration[] {
  const t = context.toolchain.typescript;
  let symbol = context.checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
  return symbol?.declarations ?? [];
}
function referencesOf(context: AnalysisContext, name: ts.Node, scope: ts.Node): ts.Identifier[] {
  const t = context.toolchain.typescript;
  const targets = declarationsAt(context, name);
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (t.isIdentifier(node) && node !== name &&
      declarationsAt(context, node).some(item => targets.includes(item))) found.push(node);
    t.forEachChild(node, visit);
  };
  if (targets.length) visit(scope);
  return found;
}
/** Finds the calls of a resolved declaration, which is how a wrapper hands its Observable to its caller. */
function callSitesOf(context: AnalysisContext, declaration: ts.FunctionLikeDeclaration): ts.CallExpression[] {
  const t = context.toolchain.typescript;
  const found: ts.CallExpression[] = [];
  if (!declaration.name) return found;
  const visit = (node: ts.Node): void => {
    if (t.isCallExpression(node)) {
      const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
      if (declarationsAt(context, callee).includes(declaration)) found.push(node);
    }
    t.forEachChild(node, visit);
  };
  for (const file of context.sourceFiles) {
    const source = context.program.getSourceFile(file);
    if (source) visit(source);
  }
  return found;
}
/** Reads a component template for `field | async`, which is the template's own subscription. */
function asyncPipeFields(context: AnalysisContext, owner: Declaration): { fields: Set<string>; gap: string | null } {
  const ng = context.toolchain.angularCompiler;
  const fields = new Set<string>();
  if (owner.template.kind === 'none') return { fields, gap: null };
  if (!owner.template.text)
    return { fields, gap: `${owner.id}: the external template ${owner.template.file} is not loaded in this catalog` };
  const parsed = ng.parseTemplate(owner.template.text, owner.template.file, { preserveWhitespaces: true });
  if (parsed.errors?.length) return { fields, gap: `${owner.id}: template parse error` };
  const expressions = new class extends ng.RecursiveAstVisitor {
    override visitPipe(ast: InstanceType<typeof ng.BindingPipe>, value: unknown): unknown {
      if (ast.name === 'async' && ast.exp instanceof ng.PropertyRead && ast.exp.receiver instanceof ng.ImplicitReceiver)
        fields.add(ast.exp.name);
      return super.visitPipe(ast, value);
    }
  }();
  const nodes = new class extends ng.TmplAstRecursiveVisitor {
    override visitBoundText(text: InstanceType<typeof ng.TmplAstBoundText>): void { text.value.visit(expressions); }
    override visitBoundAttribute(attribute: InstanceType<typeof ng.TmplAstBoundAttribute>): void {
      attribute.value.visit(expressions);
    }
    override visitBoundEvent(event: InstanceType<typeof ng.TmplAstBoundEvent>): void { event.handler.visit(expressions); }
    override visitIfBlockBranch(block: InstanceType<typeof ng.TmplAstIfBlockBranch>): void {
      block.expression?.visit(expressions);
      super.visitIfBlockBranch(block);
    }
    override visitForLoopBlock(block: InstanceType<typeof ng.TmplAstForLoopBlock>): void {
      block.expression.visit(expressions);
      super.visitForLoopBlock(block);
    }
    override visitSwitchBlock(block: InstanceType<typeof ng.TmplAstSwitchBlock>): void {
      block.expression.visit(expressions);
      super.visitSwitchBlock(block);
    }
    override visitLetDeclaration(declaration: InstanceType<typeof ng.TmplAstLetDeclaration>): void {
      declaration.value.visit(expressions);
    }
  }();
  ng.tmplAstVisitAll(nodes, parsed.nodes);
  return { fields, gap: null };
}

interface WalkState { branches: HttpBranch[]; gaps: string[]; conditions: string[]; stages: string[];
  visited: Set<ts.Node>; stage: number; callPath?: ReadonlySet<string> }
const fork = (state: WalkState): WalkState => ({ branches: [...state.branches], gaps: [...state.gaps],
  conditions: [...state.conditions], stages: [...state.stages], visited: new Set(state.visited),
  stage: state.stage, callPath: state.callPath });
function consume(kind: ConsumptionKind, context: AnalysisContext, node: ts.Node, state: WalkState,
  conditions: string[], registration: string[] = [], registered = true): HttpConsumption {
  return { kind, location: location(context, node), registration, registered,
    conditions: [...state.conditions, ...conditions], branches: [...state.branches], gaps: [...state.gaps] };
}
/** Follows the created value until something subscribes to it, or until the path stops being readable. */
function consumptionOf(context: AnalysisContext, start: ts.Node, state: WalkState,
  inputs: HttpFlowInputs): HttpConsumption {
  const t = context.toolchain.typescript;
  let current: ts.Node = start;
  const stop = (node: ts.Node, reason: string): HttpConsumption => {
    state.gaps.push(reason);
    return consume('none', context, node, state, [], [], false);
  };
  /** A wrapper that returns the value hands the decision to its callers; each caller is one more stage. */
  const throughCallers = (declaration: ts.FunctionLikeDeclaration): HttpConsumption => {
    if (state.stage >= STAGES) return stop(declaration, 'the wrapper chain exceeded the staged resolution limit');
    const callers = callSitesOf(context, declaration).filter(caller =>
      !state.callPath || state.callPath.has(location(context, caller)));
    if (!callers.length)
      return stop(declaration, `the value is returned by ${declaration.name?.getText() ?? 'a function'} and no caller of it was found in the analyzed sources`);
    for (const caller of callers) {
      const next = fork(state);
      next.stage++;
      next.stages.push(location(context, caller));
      const attempt = consumptionOf(context, caller, next, inputs);
      if (attempt.kind !== 'none') { state.stages = next.stages; return attempt; }
      // The reason a caller does not subscribe is part of why this request stays a candidate.
      for (const gap of attempt.gaps) if (!state.gaps.includes(gap)) state.gaps.push(gap);
    }
    return stop(declaration, `no caller of ${declaration.name?.getText() ?? 'the returning function'} subscribes to the value`);
  };
  for (let step = 0; step < DEPTH; step++) {
    if (state.visited.has(current)) return stop(current, 'the value path revisits an expression already followed');
    state.visited.add(current);
    const parent: ts.Node | undefined = current.parent;
    if (!parent) return stop(current, 'the created value leaves the analyzed expression');
    if (parenLike(t, parent)) { current = parent; continue; }
    if (t.isConditionalExpression(parent) && (parent.whenTrue === current || parent.whenFalse === current)) {
      state.conditions.push(parent.whenTrue === current
        ? `if ${parent.condition.getText()}` : `else of ${parent.condition.getText()}`);
      current = parent;
      continue;
    }
    if (t.isAwaitExpression(parent))
      return consume('promise-result', context, parent, state, ['the awaited result continues after the response arrives']);
    const member = memberCall(t, current);
    if (member) {
      if (member.name === 'pipe') {
        pipeArguments(context, member.call, null, state.branches, state.gaps, state.conditions);
        current = member.call;
        continue;
      }
      if (member.name === 'subscribe')
        return consume('subscribe', context, member.call, state,
          ['the subscription starts the request when this call runs',
            'the request ends early if the subscription is closed before the response']);
      if (['then', 'catch', 'finally'].includes(member.name))
        return consume('promise-result', context, member.call, state,
          [`the ${member.name} callback continues after the request settles`]);
      if (member.name === 'toPromise')
        return consume('promise-consume', context, member.call, state, ['toPromise subscribes and resolves on completion']);
      return stop(member.call, `the value flows into ${member.name}(), whose subscription behaviour is not modelled`);
    }
    if (t.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression)) {
      const callee = t.isPropertyAccessExpression(parent.expression) ? parent.expression.name : parent.expression;
      if (t.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'pipe') {
        pipeArguments(context, parent, current, state.branches, state.gaps, state.conditions);
        current = parent;
        continue;
      }
      const rxjs = rxjsExport(context, callee);
      // The standalone `pipe(...)` composes operators the same way the `.pipe` member does.
      if (rxjs === 'pipe') {
        pipeArguments(context, parent, current, state.branches, state.gaps, state.conditions);
        current = parent;
        continue;
      }
      if (rxjs && combiners.has(rxjs)) {
        state.conditions.push(`${rxjs} passes the subscription of its inputs on to its own subscriber`);
        current = parent;
        continue;
      }
      if (rxjs && flatteners.has(rxjs)) {
        state.conditions.push(`${rxjs} subscribes to this source for each notification it receives`);
        const effect = httpBranchEffect(rxjs);
        const place = location(context, parent);
        if (effect && !state.branches.some(item => item.operator === rxjs && item.location === place))
          state.branches.push({ operator: rxjs, location: place, effect });
        current = parent;
        continue;
      }
      if (rxjs === 'firstValueFrom' || rxjs === 'lastValueFrom')
        return consume('promise-consume', context, parent, state,
          [`${rxjs} subscribes when it is called and settles a Promise ${rxjs === 'firstValueFrom' ? 'on the first value' : 'after completion'}`,
            ...(t.isAwaitExpression(parent.parent) ? ['the awaited result continues after the response arrives'] : [])]);
      const matcher = matchIdentifier(context, callee)?.capability.matcherId;
      if (matcher === 'angular/toSignal')
        return consume('to-signal', context, parent, state,
          ['toSignal subscribes when it is created and unsubscribes when its injection context is destroyed'],
          ['the toSignal call site must run in an injection context that is created on the selected path']);
      if (matcher === 'signals/rxMethod') {
        const record = inputs.methods?.methods.find(item => item.id === location(context, parent));
        return consume('rx-method', context, parent, state,
          ['the rxMethod pipeline runs once per call and once per notification of a Signal or Observable argument',
            ...(record?.conditions ?? [])],
          [record ? `rxMethod ${record.name ?? record.id} is ${record.called ? 'called' : 'never called'}`
            : 'no reactive method graph was supplied, so the rxMethod call is unconfirmed'],
          record?.called === true);
      }
      if (matcher === 'ngrx-effects/createEffect') {
        const effect = inputs.store?.effects.find(item => item.source === location(context, parent));
        return consume('effect-flattening', context, parent, state,
          ['the effect source must emit before the flattened request is subscribed', ...(effect?.conditions ?? [])],
          [effect ? `effect at ${effect.source} is ${effect.registered ? 'registered' : 'not registered'}`
            : 'no Store graph was supplied, so the effect registration is unconfirmed'],
          effect?.registered === true);
      }
      if (matcher === 'signals-events/withEventHandlers') {
        const feature = location(context, parent);
        const declaration = [...(inputs.stores?.declarations.values() ?? [])]
          .find(item => item.features.some(part => part.source === feature));
        const lifetime = declaration && inputs.stores ? storeLifetime(inputs.stores, declaration.id) : null;
        return consume('event-handler', context, parent, state,
          ['the handler subscribes when the Store is created and ends when the Store is destroyed',
            ...(lifetime?.conditions ?? [])],
          [lifetime && declaration ? `Store ${declaration.name} is ${lifetime.created ? 'created' : 'declared but never created'}`
            : 'no SignalStore catalog was supplied, so the handler registration is unconfirmed'],
          lifetime?.created === true);
      }
      return stop(parent, `the value is passed to ${callee.getText()}, whose subscription behaviour is not modelled`);
    }
    if (t.isPropertyAssignment(parent) && parent.initializer === current) { current = parent.parent; continue; }
    // An array or a spread only carries the value on to whatever consumes the array.
    if (t.isArrayLiteralExpression(parent) || t.isSpreadElement(parent)) { current = parent; continue; }
    if (t.isReturnStatement(parent) || (isFunctionLike(t, parent) && parent.body === current)) {
      const holder = t.isReturnStatement(parent) ? t.findAncestor(parent, node => isFunctionLike(t, node)) : parent;
      if (!holder) return stop(parent, 'the returning function is unresolved');
      current = holder;
      continue;
    }
    if (isFunctionLike(t, current)) {
      // A handler written as a method of an object literal belongs to that literal, not to a caller.
      if (t.isObjectLiteralExpression(parent)) { current = parent; continue; }
      if (t.isMethodDeclaration(current) || t.isFunctionDeclaration(current) || t.isGetAccessorDeclaration(current))
        return throughCallers(current);
      if ((t.isVariableDeclaration(parent) || t.isPropertyDeclaration(parent)) && parent.initializer === current &&
        isFunctionLike(t, current)) return stop(parent,
          `the value is returned by ${parent.name.getText()}, whose call sites are not followed in this version`);
      return stop(current, 'the function that returns the value is not a followed declaration');
    }
    if (t.isVariableDeclaration(parent) && parent.initializer === current) {
      const scope = t.findAncestor(parent, node => isFunctionLike(t, node) || t.isSourceFile(node));
      for (const use of scope ? referencesOf(context, parent.name, scope) : []) {
        const attempt = consumptionOf(context, use, fork(state), inputs);
        if (attempt.kind !== 'none') return attempt;
        for (const gap of attempt.gaps) if (!state.gaps.includes(gap)) state.gaps.push(gap);
      }
      return stop(parent, `the created value is held in ${parent.name.getText()} and never subscribed in this scope`);
    }
    const assignedField = t.isPropertyDeclaration(parent) && parent.initializer === current ? parent.name
      : t.isBinaryExpression(parent) && parent.right === current &&
        parent.operatorToken.kind === t.SyntaxKind.EqualsToken && t.isPropertyAccessExpression(parent.left)
        ? parent.left.name : null;
    if (assignedField) {
      const owner = t.findAncestor(parent, node => t.isClassDeclaration(node)) as ts.ClassDeclaration | undefined;
      if (!owner) return stop(parent, 'the class that holds the created value is unresolved');
      const name = assignedField.getText();
      const declaration = inputs.catalog?.byNode.get(owner);
      if (declaration) {
        const template = asyncPipeFields(context, declaration);
        if (template.gap) state.gaps.push(template.gap);
        if (template.fields.has(name))
          return consume('async-pipe', context, owner, state,
            ['the async pipe subscribes while the view exists and unsubscribes when the view is destroyed',
              'the view that holds this binding must be created on the selected path'],
            [`${declaration.id} reads ${name} through the async pipe`]);
      } else state.gaps.push(inputs.catalog
        ? `${name} is held by a class that is not a declaration in the catalog, so an async pipe consumer is unconfirmed`
        : `no component catalog was supplied, so an async pipe consumer of ${name} is unconfirmed`);
      for (const use of referencesOf(context, assignedField, owner)) {
        const target = t.isPropertyAccessExpression(use.parent) && use.parent.name === use ? use.parent : use;
        const attempt = consumptionOf(context, target, fork(state), inputs);
        if (attempt.kind !== 'none') return attempt;
        for (const gap of attempt.gaps) if (!state.gaps.includes(gap)) state.gaps.push(gap);
      }
      return stop(parent, `the created value is held in ${name} and no subscriber of it was found`);
    }
    if (t.isExpressionStatement(parent)) return stop(parent, 'the created value is discarded without a subscription');
    return stop(parent, `the created value flows into ${t.SyntaxKind[parent.kind]}, which is not modelled`);
  }
  return stop(current, 'the value path exceeded the consumption depth limit');
}

const callIndexes = new WeakMap<AnalysisContext, Map<string, ts.CallExpression>>();
export function callIndex(context: AnalysisContext): Map<string, ts.CallExpression> {
  const cached = callIndexes.get(context);
  if (cached) return cached;
  const t = context.toolchain.typescript;
  const index = new Map<string, ts.CallExpression>();
  const visit = (node: ts.Node): void => {
    if (t.isCallExpression(node)) index.set(location(context, node), node);
    t.forEachChild(node, visit);
  };
  for (const file of context.sourceFiles) {
    const source = context.program.getSourceFile(file);
    if (source) visit(source);
  }
  callIndexes.set(context, index);
  return index;
}
/** Follows one request site to the consumer that starts it, through the wrappers that return it. */
export function resolveHttpStart(context: AnalysisContext, site: HttpRequestSite, inputs: HttpFlowInputs = {},
  index = callIndex(context), callPath?: ReadonlySet<string>): HttpRequestFlow {
  const node = index.get(site.id);
  if (!node) return { request: site, start: 'candidate', stages: [],
    consumption: { kind: 'none', location: site.source, registration: [], registered: false, conditions: [],
      branches: [...site.branches], gaps: ['the request call site could not be read again'] },
    reason: 'the request call site could not be read again' };
  const state: WalkState = { branches: [...site.branches], gaps: [], conditions: [], stages: [],
    visited: new Set(), stage: 0, callPath };
  const consumption = consumptionOf(context, node, state, inputs);
  const stages = state.stages;
  // A Promise API starts its request when it is called; reading the result is a separate stage.
  if (site.transport === 'fetch') return { request: site, start: 'confirmed', stages,
    consumption: consumption.kind === 'none'
      ? { ...consumption, registered: true, conditions: [...consumption.conditions, 'the call itself starts the request'] }
      : consumption,
    reason: consumption.kind === 'none' ? 'fetch starts the request when it is called; its result is not read on this path' : null };
  if (consumption.kind === 'none') return { request: site, start: 'candidate', stages, consumption,
    reason: consumption.gaps[0] ?? 'no subscription of the created Observable was found' };
  if (!consumption.registered) return { request: site, start: 'candidate', stages, consumption,
    reason: consumption.registration[0] ?? 'the consumer registration is not confirmed' };
  return { request: site, start: 'confirmed', stages, consumption, reason: null };
}
/** Classifies every catalogued request site; a listing is never by itself the start of a network call. */
export function analyzeHttpFlows(context: AnalysisContext, catalog: HttpCatalog,
  inputs: HttpFlowInputs = {}): HttpRequestFlow[] {
  const index = callIndex(context);
  return catalog.requests.map(site => resolveHttpStart(context, site, inputs, index));
}

export interface HttpTraceOptions extends HttpFlowInputs { layers?: InjectorLayer[] }
/** Walks one operation forward and reports only the requests that operation actually reaches. */
function traceHttpFromRoot(context: AnalysisContext, catalog: HttpCatalog,
  root: ts.MethodDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment | null,
  rootName: string, rootOwner: string, options: HttpTraceOptions, entryConditions: string[] = []): HttpTrace {
  const t = context.toolchain.typescript;
  const steps: HttpStep[] = [];
  const diagnostics: string[] = [];
  const flows: HttpRequestFlow[] = [];
  const index = callIndex(context);
  const layers = options.layers ?? [];
  const active = new Set<ts.Node>();
  let expanded = 0;
  const add = (kind: HttpStepKind, source: string, target: string, node: ts.Node, path: string[],
    conditions: string[] = [], detail: string | null = null, flowIndex?: number): void => {
    if (expanded > LIMIT) return;
    steps.push({ kind, source, target, location: location(context, node), path: [...path],
      conditions: [...conditions], detail, flowIndex });
  };
  const classFor = (implementation: string): ts.ClassDeclaration | null => {
    for (const file of context.sourceFiles) {
      const source = context.program.getSourceFile(file);
      if (!source) continue;
      for (const statement of source.statements)
        if (t.isClassDeclaration(statement) && statement.name && tokenId(context, statement.name) === implementation)
          return statement;
    }
    return null;
  };
  const requestsIn = (body: ts.Node): HttpRequestSite[] => catalog.requests.filter(site => {
    const node = index.get(site.id);
    return !!node && node.getSourceFile() === body.getSourceFile() &&
      node.getStart() >= body.getStart() && node.getEnd() <= body.getEnd();
  });
  const visitMethod = (declaration: ts.MethodDeclaration | ts.FunctionDeclaration | ts.PropertyDeclaration |
    ts.PropertyAssignment, receiver: string,
    path: string[], conditions: string[], depth: number, argumentsAtCall: readonly ts.Expression[] = []): void => {
    if (++expanded > LIMIT) {
      if (expanded === LIMIT + 1) diagnostics.push(`HTTP flow reached ${LIMIT} expansion states`);
      return;
    }
    if (depth >= DEPTH) { add('boundary', receiver, 'call stack depth limit', declaration, path, conditions); return; }
    const name = declaration.name?.getText() ?? 'function';
    if (active.has(declaration)) {
      add('boundary', receiver, name, declaration, path, conditions, 'recursive call on the current branch');
      return;
    }
    active.add(declaration);
    const body = t.isPropertyDeclaration(declaration) || t.isPropertyAssignment(declaration)
      ? declaration.initializer : declaration.body;
    if (!body) {
      add('boundary', receiver, name, declaration, path, conditions, 'the callee body is unavailable');
      active.delete(declaration);
      return;
    }
    const parameterValues = new Map<string, ts.Expression>();
    if (!t.isPropertyDeclaration(declaration) && !t.isPropertyAssignment(declaration))
      declaration.parameters.forEach((parameter, position) => {
      if (t.isIdentifier(parameter.name) && argumentsAtCall[position])
        parameterValues.set(parameter.name.text, argumentsAtCall[position]!);
      });
    for (const site of requestsIn(body)) {
      const node = index.get(site.id) ?? declaration;
      const urlArgument = t.isCallExpression(node) && node.arguments[0];
      const boundUrl = urlArgument && t.isIdentifier(urlArgument) ? parameterValues.get(urlArgument.text) : undefined;
      const effective = boundUrl ? { ...site, url: resolveUrl(context, boundUrl) } : site;
      const flow = resolveHttpStart(context, effective, options, index, new Set(path));
      const flowIndex = flows.length;
      flows.push(flow);
      const target = `${effective.method} ${effective.url.text ?? '(unresolved URL)'}`;
      add('http-create', receiver, target, node, path,
        [...conditions, ...effective.conditions, ...flow.consumption.conditions],
        effective.url.status === 'static' ? null : effective.url.reason, flowIndex);
      for (const type of site.types)
        add('type-use', target, type.id, node, path, conditions,
          `${type.role} type read from the ${type.origin.replaceAll('-', ' ')}`, flowIndex);
      if (flow.start === 'confirmed')
        add('http-consume', target, flow.consumption.kind, node, path,
          [...conditions, ...flow.consumption.conditions, ...flow.consumption.registration],
          flow.consumption.branches.map(item => item.effect).join('; ') || 'no branch operator was found on this pipeline', flowIndex);
      else add('boundary', target, 'request candidate', node, path,
        [...conditions, ...flow.consumption.conditions], flow.reason, flowIndex);
      diagnostics.push(...effective.gaps, ...flow.consumption.gaps);
    }
    const visit = (node: ts.Node, localConditions: string[], currentPath: string[] = path): void => {
      if (expanded > LIMIT) return;
      if (t.isIfStatement(node)) {
        visit(node.thenStatement, [...localConditions, `if ${node.expression.getText()}`], currentPath);
        if (node.elseStatement)
          visit(node.elseStatement, [...localConditions, `else of ${node.expression.getText()}`], currentPath);
        return;
      }
      if (t.isTryStatement(node)) {
        visit(node.tryBlock, [...localConditions, 'try block completes without throwing'], currentPath);
        if (node.catchClause) visit(node.catchClause.block,
          [...localConditions, 'exception thrown in try block'], currentPath);
        if (node.finallyBlock) visit(node.finallyBlock, localConditions, currentPath);
        return;
      }
      if (t.isCallExpression(node)) {
        const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        const operator = rxjsExport(context, callee);
        if (operator && ['map', 'mergeMap', 'switchMap', 'concatMap', 'exhaustMap', 'tap', 'catchError']
          .includes(operator)) {
          const notification = operator === 'catchError' ? 'error notification' : 'successful source notification';
          for (const argument of node.arguments) {
            if (t.isArrowFunction(argument) || t.isFunctionExpression(argument))
              visit(argument.body, [...localConditions, notification], currentPath);
          }
          return;
        }
      }
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        const nextPath = [...currentPath, location(context, node)];
        // pipe is the carrier of operator callbacks, not a service call to resolve through DI.
        if (callee.name.text === 'pipe') {
          visit(callee.expression, localConditions, currentPath);
          const pipelinePath = t.isCallExpression(callee.expression)
            ? [...currentPath, location(context, callee.expression)] : currentPath;
          for (const argument of node.arguments) visit(argument, localConditions, pipelinePath);
          return;
        }
        if (callee.expression.kind === t.SyntaxKind.ThisKeyword && t.isClassDeclaration(declaration.parent)) {
          const target = classMethod(context, declaration.parent, callee.name.text);
          if (target) {
            add('call', receiver, callee.name.text, node, nextPath, localConditions);
            visitMethod(target, receiver, nextPath, localConditions, depth + 1, node.arguments);
            return;
          }
        }
        if (t.isPropertyAccessExpression(callee.expression) &&
          callee.expression.expression.kind === t.SyntaxKind.ThisKeyword && t.isClassDeclaration(declaration.parent)) {
          const fieldName = callee.expression.name.text;
          const field = declaration.parent.members.find(item => t.isPropertyDeclaration(item) &&
            item.name.getText() === fieldName);
          const initializer = field && t.isPropertyDeclaration(field) ? field.initializer : undefined;
          const constructor = declaration.parent.members.find(t.isConstructorDeclaration);
          const parameter = constructor?.parameters.find(item => item.name.getText() === fieldName);
          const request = initializer && t.isCallExpression(initializer)
            ? injectionRequestFor(context, initializer) : parameter ? injectionRequestFor(context, parameter) : null;
          if (request) {
            const resolution = resolveInjection(context, request, layers);
            const implementation = resolution.bindings[0]?.implementation;
            if (resolution.status !== 'resolved' || resolution.bindings.length !== 1 || !implementation) {
              add('boundary', receiver, `${fieldName}.${callee.name.text}`, node, nextPath,
                [...localConditions, ...resolution.reasons], externalToken(context, request.token)
                  ? 'the receiver is an external package type, whose implementation this analysis does not traverse'
                  : 'the service receiver is not uniquely resolved by DI');
              return;
            }
            const target = classFor(implementation)?.members.find(item => t.isMethodDeclaration(item) &&
              item.name.getText() === callee.name.text);
            if (target && t.isMethodDeclaration(target)) {
              add('call', receiver, `${fieldName}.${callee.name.text}`, node, nextPath, localConditions);
              visitMethod(target, implementation, nextPath, localConditions, depth + 1, node.arguments);
              return;
            }
            add('boundary', receiver, `${fieldName}.${callee.name.text}`, node, nextPath, localConditions,
              'the resolved service method body is unavailable');
            return;
          }
        }
      }
      if (t.isCallExpression(node) && t.isIdentifier(node.expression)) {
        let symbol = context.checker.getSymbolAtLocation(node.expression);
        if (symbol && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (declaration && context.sourceFiles.includes(declaration.getSourceFile().fileName)) {
          const nextPath = [...currentPath, location(context, node)];
          add('call', receiver, node.expression.text, node, nextPath, localConditions,
            node.arguments.map(argument => argument.getText()).join(', '));
        }
      }
      t.forEachChild(node, child => visit(child, localConditions, currentPath));
    };
    visit(body, conditions);
    active.delete(declaration);
  };
  if (root) visitMethod(root, rootOwner, [location(context, root)], entryConditions, 0);
  else diagnostics.push(`No method or effect ${rootName} in ${rootOwner}`);
  return { steps, flows, diagnostics: [...new Set(diagnostics)] };
}

export function traceHttpFromMethod(context: AnalysisContext, catalog: HttpCatalog, owner: Declaration,
  methodName: string, options: HttpTraceOptions = {}): HttpTrace {
  return traceHttpFromRoot(context, catalog, classMethod(context, owner.node, methodName),
    methodName, owner.id, options);
}

/** Only an effect reached by the selected Action is entered; other registered effects stay outside this trace. */
export function traceHttpFromEffect(context: AnalysisContext, catalog: HttpCatalog, effect: StoreEffect,
  options: HttpTraceOptions = {}, conditions: string[] = []): HttpTrace {
  const t = context.toolchain.typescript;
  const source = context.sourceFiles.map(file => context.program.getSourceFile(file)).find(file =>
    file && effect.source.startsWith(`${file.fileName.slice(context.workspaceRoot.length + 1).replaceAll('\\', '/')}:`));
  let root: ts.PropertyDeclaration | null = null;
  if (source) {
    const visit = (node: ts.Node): void => {
      if (root) return;
      if (t.isPropertyDeclaration(node) && node.initializer && t.isCallExpression(node.initializer) &&
        location(context, node.initializer) === effect.source) { root = node; return; }
      t.forEachChild(node, visit);
    };
    visit(source);
  }
  return traceHttpFromRoot(context, catalog, root, effect.id, effect.owner ?? effect.id, options, conditions);
}

/** Follows only the handler pipeline that received the selected SignalStore event. */
export function traceHttpFromEventConsumer(context: AnalysisContext, catalog: HttpCatalog,
  consumer: EventConsumer, options: HttpTraceOptions = {}, conditions: string[] = []): HttpTrace {
  const t = context.toolchain.typescript;
  const call = callIndex(context).get(consumer.source);
  const root = call ? t.findAncestor(call, t.isPropertyAssignment) ?? null : null;
  return traceHttpFromRoot(context, catalog, root, consumer.id,
    consumer.storeId ?? consumer.owner ?? consumer.id, options, conditions);
}
