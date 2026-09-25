import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
import type { Catalog } from '../../index/catalog.js';
import { classAt, classMethod, idForClass, unwrap } from '../../index/catalog.js';
import type { IndexedElement } from '../../index/templates.js';
import { resolveElementBindings } from './bindings.js';
import { importedApi, location } from './reactive.js';
import { traceOperation } from './flow.js';
import { injectionRequestFor, resolveInjection, tokenId, type InjectorLayer } from './di.js';
import type { StoreAction, StoreGraph } from './store.js';

export type StoreStepKind = 'call' | 'output-emit' | 'output-subscription' | 'action-dispatch' | 'action-consume' | 'state-write' | 'state-read' |
  'reactive-link' | 'boundary';
export interface StoreStep { kind: StoreStepKind; source: string; target: string; location: string;
  path: string[]; conditions: string[]; detail: string | null }
export interface StoreTrace { steps: StoreStep[]; diagnostics: string[]; backgroundReads: string[] }
export interface StoreTraceOptions { outputElement?: IndexedElement; catalog?: Catalog;
  parentLayers?: InjectorLayer[]; changedInput?: string; rootArguments?: readonly ts.Expression[] }
const LIMIT = 10000;
const DEPTH = 64;
const slash = (s: string): string => s.replaceAll('\\', '/');
function storeReceiver(context: AnalysisContext, receiver: ts.Expression): boolean {
  const type = context.checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol();
  return symbol?.getName() === 'Store' && !!symbol.declarations?.some(d =>
    slash(d.getSourceFile().fileName).includes('/node_modules/@ngrx/store/'));
}
function keyFor(context: AnalysisContext, node: ts.Node, callSite: ts.Node, receiver: string, event: string,
  args: readonly ts.Expression[]): string {
  const t = context.toolchain.typescript;
  const symbol = context.checker.getSymbolAtLocation(node);
  const source = symbol?.valueDeclaration ?? symbol?.declarations?.[0] ?? node;
  const abstractArgs = args.map(arg => t.isStringLiteralLike(arg) || t.isNumericLiteral(arg) ? arg.text :
    t.isCallExpression(arg) ? `call:${arg.expression.getText()}` : arg.kind === t.SyntaxKind.TrueKeyword ? 'true' :
      arg.kind === t.SyntaxKind.FalseKeyword ? 'false' : '?').join(',');
  return `${location(context,source)}|${location(context,callSite)}|${receiver}|${context.id}|${event}|${abstractArgs}`;
}
function matchesAction(action: StoreAction, candidate: StoreAction): boolean {
  return !!action.type && action.type === candidate.type;
}
/** Traverses a chosen method and its confirmed DI callees, then registered NgRx transitions. */
export function traceStoreDispatch(context: AnalysisContext, graph: StoreGraph, owner: Declaration,
  methodName: string, layers: InjectorLayer[] = [], options: StoreTraceOptions = {}): StoreTrace {
  const t = context.toolchain.typescript;
  type Known = string | number | boolean | null;
  const unknown = Symbol('unknown');
  const valueOf = (node: ts.Expression, known: ReadonlyMap<string, Known>): Known | typeof unknown => {
    const part = unwrap(t, node);
    if (part.kind === t.SyntaxKind.NullKeyword) return null;
    if (part.kind === t.SyntaxKind.TrueKeyword) return true;
    if (part.kind === t.SyntaxKind.FalseKeyword) return false;
    if (t.isStringLiteralLike(part)) return part.text;
    if (t.isNumericLiteral(part)) return Number(part.text);
    if (t.isIdentifier(part)) return known.has(part.text) ? known.get(part.text)! : unknown;
    if (t.isPrefixUnaryExpression(part) && part.operator === t.SyntaxKind.ExclamationToken) {
      const inner = valueOf(part.operand, known);
      return inner === unknown ? unknown : !inner;
    }
    if (t.isBinaryExpression(part)) {
      const left = valueOf(part.left, known), right = valueOf(part.right, known);
      if (part.operatorToken.kind === t.SyntaxKind.AmpersandAmpersandToken) {
        if (left === false || right === false) return false;
        return left === unknown || right === unknown ? unknown : Boolean(left && right);
      }
      if (part.operatorToken.kind === t.SyntaxKind.BarBarToken) {
        if (left === true || right === true) return true;
        return left === unknown || right === unknown ? unknown : Boolean(left || right);
      }
      if (left === unknown || right === unknown) return unknown;
      if (part.operatorToken.kind === t.SyntaxKind.EqualsEqualsEqualsToken) return left === right;
      if (part.operatorToken.kind === t.SyntaxKind.ExclamationEqualsEqualsToken) return left !== right;
    }
    if (t.isConditionalExpression(part)) {
      const condition = valueOf(part.condition, known);
      return condition === unknown ? unknown : valueOf(condition ? part.whenTrue : part.whenFalse, known);
    }
    return unknown;
  };
  const steps: StoreStep[] = [];
  const diagnostics: string[] = [];
  const backgroundReads: string[] = [];
  const active = new Set<string>();
  const memo = new Map<string, StoreStep[]>();
  let expanded = 0;
  let limitReported = false;
  const enter = (node: ts.Node, path: string[]): boolean => {
    expanded++;
    if (expanded <= LIMIT) return true;
    if (!limitReported) {
      limitReported = true;
      steps.push({ kind:'boundary', source:methodName, target:'expansion state limit',
        location:location(context,node), path:[...path], conditions:[], detail:`stopped after ${LIMIT} expansion states` });
      diagnostics.push(`Store flow reached ${LIMIT} expansion states`);
    }
    return false;
  };
  const add = (kind: StoreStepKind, source: string, target: string, node: ts.Node, path: string[],
    conditions: string[] = [], detail: string | null = null): void => {
    if (expanded > LIMIT) return;
    steps.push({ kind, source, target, location: location(context,node), path: [...path],
      conditions: [...conditions], detail });
  };
  const actionFor = (expression: ts.Expression): StoreAction | undefined => {
    const callee = t.isCallExpression(expression) ? expression.expression : expression;
    const id = tokenId(context,callee);
    return graph.actions.find(action => action.id === id);
  };
  const selectorDependsOn = (selectorId: string, feature: string, seen = new Set<string>()): boolean => {
    if (seen.has(selectorId)) return false;
    seen.add(selectorId);
    const selector = graph.selectors.find(item => item.id === selectorId);
    return !!selector && selector.dependencies.some(dependency => dependency === feature ||
      dependency.endsWith(`.${feature}`) || selectorDependsOn(dependency,feature,seen));
  };
  const stateFromAction = (action: StoreAction, source: string, node: ts.Node, path: string[],
    conditions: string[], depth: number): void => {
    if (!enter(node,path)) return;
    if (depth >= DEPTH) { add('boundary',source,'call stack depth limit',node,path,conditions); return; }
    const key = `action:${action.type ?? action.id}|${context.id}|${owner.id}|${methodName}`;
    if (active.has(key)) { add('boundary',source,action.id,node,path,conditions,'action dispatch cycle'); return; }
    active.add(key);
    const peers = graph.actions.filter(peer => matchesAction(action,peer));
    if (peers.length > 1) diagnostics.push(`Action type collision ${JSON.stringify(action.type)} has ${peers.length} creator candidates`);
    const ids = new Set(peers.length ? peers.map(peer => peer.id) : [action.id]);
    for (const reducer of graph.reducers.filter(item => item.registered && item.actions.some(id => ids.has(id)))) {
      const nextConditions = [...conditions,...reducer.conditions];
      add('action-consume',action.id,reducer.id,node,path,nextConditions,'registered reducer handles the action type');
      add('state-write',reducer.id,reducer.feature ?? reducer.id,node,path,nextConditions,
        'reducer result may update its state slice');
      for (const selector of graph.selectors) {
        const feature = reducer.feature;
        const dependent = !!feature && selectorDependsOn(selector.id,feature);
        if (!dependent) continue;
        add('state-read',feature,selector.id,node,path,
          [...nextConditions,'selector projection is evaluated only when consumed'],
          'a changed state slice does not guarantee a changed selector value');
        for (const consumer of graph.consumers.filter(item => item.selector === selector.id && item.active)) {
          add('reactive-link',selector.id,consumer.id,node,path,
            [...nextConditions,...consumer.conditions],`${consumer.kind} consumer in ${consumer.owner}`);
          for (const computed of graph.computeds.filter(item => item.from === consumer.id && item.active))
            add('reactive-link',consumer.id,computed.id,node,path,
              [...nextConditions,...computed.conditions],`computed template consumer in ${computed.owner}`);
        }
      }
    }
    for (const effect of graph.effects.filter(item => item.registered && item.listens.some(id =>
      ids.has(id) || id === `type:${action.type}`))) {
      const effectConditions = [...conditions,...effect.conditions,
        'ofType matches the runtime action type', 'effect source must be subscribed and alive'];
      add('action-consume',action.id,effect.id,node,path,effectConditions,'registered effect receives this action');
      const effectNode = context.sourceFiles.map(file => context.program.getSourceFile(file))
        .filter((file): file is ts.SourceFile => !!file).flatMap(file => {
          const calls: ts.CallExpression[] = [];
          const visit = (part: ts.Node): void => {
            if (t.isCallExpression(part) && location(context,part) === effect.source) calls.push(part);
            t.forEachChild(part,visit);
          };
          visit(file);
          return calls;
        })[0];
      if (effectNode) {
        const visitReads = (part: ts.Node): void => {
          if (t.isCallExpression(part)) {
            const callee = t.isPropertyAccessExpression(part.expression) ? part.expression.name : part.expression;
            const name = importedApi(context,callee)?.name;
            if (name === 'withLatestFrom' || name === 'concatLatestFrom') {
              for (const arg of part.arguments) {
                const selectorCall = t.isCallExpression(arg) && t.isPropertyAccessExpression(arg.expression) &&
                  ['select','selectSignal'].includes(arg.expression.name.text) &&
                  storeReceiver(context,arg.expression.expression) ? arg : null;
                const selectorId = selectorCall?.arguments[0] && tokenId(context,selectorCall.arguments[0]);
                const selector = graph.selectors.find(item => item.id === selectorId);
                const sourceNode = t.isPropertyAccessExpression(arg) ? arg.name :
                  t.isIdentifier(arg) ? arg : null;
                const symbol = sourceNode && context.checker.getSymbolAtLocation(sourceNode);
                const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
                const direct = declaration && context.sourceFiles.includes(declaration.getSourceFile().fileName)
                  ? `; direct source declared at ${location(context,declaration)}` : '';
                backgroundReads.push(`${location(context,arg)}: ${arg.getText()}${selector ?
                  `; direct selector ${selector.id} declared at ${selector.source}` : direct}`);
              }
            }
          }
          t.forEachChild(part,visitReads);
        };
        visitReads(effectNode);
      }
      if (effect.dispatch) for (const emitted of effect.emits) {
        const next = graph.actions.find(item => item.id === emitted);
        const emittedConditions = [...effectConditions,...(effect.emissionConditions[emitted] ?? [])];
        if (!next) { add('boundary',effect.id,emitted,node,path,emittedConditions,'effect output creator is unknown'); continue; }
        add('action-dispatch',effect.id,next.id,node,[...path,effect.source],emittedConditions,
          'effect returned an action and automatic dispatch is enabled');
        stateFromAction(next,effect.id,node,[...path,effect.source],emittedConditions,depth+1);
      }
      for (const emitted of effect.explicitDispatches) {
        const next = graph.actions.find(item => item.id === emitted);
        if (!next) { add('boundary',effect.id,emitted,node,path,effectConditions,'explicit dispatch action is unresolved'); continue; }
        add('action-dispatch',effect.id,next.id,node,[...path,effect.source],
          [...effectConditions,'effect callback branch containing Store.dispatch must run'],
          'explicit Store.dispatch inside the effect');
        stateFromAction(next,effect.id,node,[...path,effect.source],effectConditions,depth+1);
      }
      for (const gap of effect.gaps) add('boundary',effect.id,gap,node,path,effectConditions,gap);
    }
    active.delete(key);
  };
  const classFor = (implementation: string): ts.ClassDeclaration | null => {
    for (const file of context.sourceFiles) {
      const source = context.program.getSourceFile(file);
      if (!source) continue;
      for (const statement of source.statements)
        if (t.isClassDeclaration(statement) && statement.name && tokenId(context,statement.name) === implementation) return statement;
    }
    return null;
  };
  const signalStoreMethod = (implementation: string, name: string): ts.MethodDeclaration | null => {
    const signalApi = (call: ts.CallExpression, api: string): boolean => {
      const callee = t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
      let symbol = context.checker.getSymbolAtLocation(callee);
      if (symbol && symbol.flags & t.SymbolFlags.Alias) symbol = context.checker.getAliasedSymbol(symbol);
      return symbol?.getName() === api && !!symbol.declarations?.some(d =>
        slash(d.getSourceFile().fileName).includes('/node_modules/@ngrx/signals/'));
    };
    for (const file of context.sourceFiles) {
      const source = context.program.getSourceFile(file);
      if (!source) continue;
      for (const statement of source.statements) {
        if (!t.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (tokenId(context,declaration.name) !== implementation || !declaration.initializer ||
            !t.isCallExpression(declaration.initializer) || !signalApi(declaration.initializer,'signalStore')) continue;
          for (const feature of declaration.initializer.arguments) {
            if (!t.isCallExpression(feature) || !signalApi(feature,'withMethods')) continue;
            const factory = feature.arguments[0];
            if (!factory || (!t.isArrowFunction(factory) && !t.isFunctionExpression(factory))) continue;
            const returned = t.isBlock(factory.body) ?
              factory.body.statements.find(t.isReturnStatement)?.expression : factory.body;
            const object = returned && unwrap(t,returned);
            if (!object || !t.isObjectLiteralExpression(object)) continue;
            const method = object.properties.find(property => t.isMethodDeclaration(property) &&
              property.name.getText() === name);
            if (method && t.isMethodDeclaration(method)) return method;
          }
        }
      }
    }
    return null;
  };
  const visitMethod = (method: ts.MethodDeclaration, receiver: string, path: string[],
    conditions: string[], depth: number, callSite: ts.Node, args: readonly ts.Expression[],
    currentLayers: InjectorLayer[] = layers): void => {
    if (!enter(callSite,path)) return;
    if (depth >= DEPTH) { add('boundary',receiver,'call stack depth limit',method,path,conditions); return; }
    const key = keyFor(context,method.name,callSite,receiver,methodName,args);
    if (active.has(key)) { add('boundary',receiver,method.name.getText(),method,path,conditions,'recursive call on current branch'); return; }
    const cached = memo.get(key);
    if (cached) {
      for (const item of cached) {
        if (!enter(callSite,path)) break;
        steps.push({...item,path:[...path,...item.path],conditions:[...conditions,...item.conditions]});
      }
      return;
    }
    active.add(key);
    const before = steps.length;
    const known = new Map<string, Known>();
    method.parameters.forEach((parameter, index) => {
      if (!t.isIdentifier(parameter.name) || !args[index]) return;
      const value = valueOf(args[index]!, known);
      if (value !== unknown) known.set(parameter.name.text, value);
    });
    const visit = (node: ts.Node, localConditions: string[], level: number): void => {
      if (!enter(node,path)) return;
      if (level >= DEPTH) { add('boundary',receiver,'call stack depth limit',node,path,localConditions); return; }
      if (t.isIfStatement(node)) {
        if (method.name.getText() === 'ngOnChanges' && options.changedInput) {
          const changed = /\bchanges\?\.([A-Za-z_$][\w$]*)/.exec(node.expression.getText())?.[1];
          if (changed && changed !== options.changedInput) {
            if (node.elseStatement) visit(node.elseStatement, localConditions, level);
            return;
          }
        }
        const branch = valueOf(node.expression, known);
        if (branch === true) { visit(node.thenStatement, localConditions, level); return; }
        if (branch === false) {
          if (node.elseStatement) visit(node.elseStatement, localConditions, level);
          return;
        }
        visit(node.thenStatement,[...localConditions,`if ${node.expression.getText()}`],level);
        if (node.elseStatement) visit(node.elseStatement,[...localConditions,`else of ${node.expression.getText()}`],level);
        return;
      }
      if (t.isVariableDeclaration(node) && t.isIdentifier(node.name) && node.initializer) {
        const value = valueOf(node.initializer, known);
        if (value !== unknown) known.set(node.name.text, value);
      }
      if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.EqualsToken &&
        t.isPropertyAccessExpression(node.left) && node.left.expression.kind === t.SyntaxKind.ThisKeyword) {
        add('state-write', receiver, node.left.name.text, node, path, localConditions, node.right.getText());
      }
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        const nextPath = [...path,location(context,node)];
        if (callee.name.text === 'dispatch' && storeReceiver(context,callee.expression)) {
          let actionExpression: ts.Expression | undefined = node.arguments[0];
          if (actionExpression && (t.isArrowFunction(actionExpression) || t.isFunctionExpression(actionExpression))) {
            const body = actionExpression.body;
            actionExpression = t.isBlock(body) ? body.statements.find(t.isReturnStatement)?.expression : body;
          }
          const action = actionExpression && actionFor(actionExpression);
          if (!action) add('boundary',receiver,'dynamic action',node,nextPath,localConditions,
            'Store.dispatch argument has no statically identified action creator');
          else {
            add('action-dispatch',receiver,action.id,node,nextPath,localConditions,
              `action type ${JSON.stringify(action.type)}`);
            if (action.type) stateFromAction(action,receiver,node,nextPath,localConditions,level+1);
            else add('boundary',action.id,'dynamic action type',node,nextPath,localConditions,
              'action type is not a static string');
          }
          return;
        }
        const receiverType = context.checker.getTypeAtLocation(callee.expression).getSymbol();
        const receiverFiles = receiverType?.declarations?.map(part => slash(part.getSourceFile().fileName)) ?? [];
        if (callee.name.text === 'next' && receiverFiles.some(file => file.includes('/node_modules/rxjs/'))) {
          add('state-write',receiver,callee.expression.getText(),node,nextPath,localConditions,
            'Subject.next; downstream callbacks require a live subscription');
          return;
        }
        if (callee.name.text === 'emit' && receiverFiles.some(file => file.includes('/node_modules/@angular/core/'))) {
          const argument = node.arguments[0] && valueOf(node.arguments[0], known);
          add('output-emit',receiver,callee.expression.getText(),node,nextPath,localConditions,
            argument !== undefined && argument !== unknown ?
              argument === null ? 'null' : JSON.stringify(argument) : node.arguments[0]?.getText() ?? null);
          return;
        }
        if (t.isCallExpression(callee.expression) && t.isPropertyAccessExpression(callee.expression.expression) &&
          callee.expression.expression.expression.kind === t.SyntaxKind.ThisKeyword) {
          const fieldName = callee.expression.expression.name.text;
          const declaration = method.parent;
          const field = t.isClassDeclaration(declaration) ? declaration.members.find(member =>
            t.isPropertyDeclaration(member) && member.name.getText() === fieldName) : null;
          const initializer = field && t.isPropertyDeclaration(field) ? field.initializer : null;
          if (initializer && t.isCallExpression(initializer) && t.isIdentifier(initializer.expression) &&
            ['viewChild', 'viewChildren'].includes(initializer.expression.text) && initializer.arguments[0]) {
            const targetClass = classAt(context, initializer.arguments[0]);
            const target = targetClass?.members.find(member => t.isMethodDeclaration(member) &&
              member.name.getText() === callee.name.text);
            const targetId = targetClass && idForClass(context, targetClass);
            if (target && t.isMethodDeclaration(target) && targetId) {
              add('call', receiver, `${targetId}.${callee.name.text}`, node, nextPath, localConditions,
                `viewChild ${fieldName} must resolve to its declared component instance`);
              visitMethod(target, targetId, nextPath,
                [...localConditions, `viewChild ${fieldName} must resolve to its declared component instance`],
                level + 1, node, node.arguments, currentLayers);
              return;
            }
          }
        }
        if (callee.expression.kind === t.SyntaxKind.ThisKeyword) {
          const declaration = method.parent;
          const target = t.isClassDeclaration(declaration) ? classMethod(context, declaration, callee.name.text) : null;
          if (target) {
            add('call',receiver,callee.name.text,node,nextPath,localConditions);
            visitMethod(target,receiver,nextPath,localConditions,level+1,node,node.arguments,currentLayers);
            return;
          }
        }
        if (t.isPropertyAccessExpression(callee.expression) && callee.expression.expression.kind === t.SyntaxKind.ThisKeyword) {
          const fieldName = callee.expression.name.text;
          const declaration = method.parent;
          const field = t.isClassDeclaration(declaration) ? declaration.members.find(member =>
            t.isPropertyDeclaration(member) && member.name.getText() === fieldName) : null;
          if (field && t.isPropertyDeclaration(field) && field.initializer && t.isCallExpression(field.initializer)) {
            const request = injectionRequestFor(context,field.initializer);
            if (request) {
              const result = resolveInjection(context,request,currentLayers);
              if (result.status !== 'resolved' || result.bindings.length !== 1 || !result.bindings[0]?.implementation) {
                add('boundary',receiver,fieldName,node,nextPath,[...localConditions,...result.reasons],
                  'service receiver is not uniquely resolved by DI'); return;
              }
              const implementation = result.bindings[0].implementation;
              const klass = classFor(implementation);
              const target = klass?.members.find(member => t.isMethodDeclaration(member) && member.name.getText() === callee.name.text)
                ?? signalStoreMethod(implementation,callee.name.text);
              if (target && t.isMethodDeclaration(target)) {
                add('call',receiver,`${fieldName}.${callee.name.text}`,node,nextPath,localConditions);
                visitMethod(target,implementation,nextPath,localConditions,level+1,node,node.arguments,currentLayers); return;
              }
              add('boundary',receiver,`${fieldName}.${callee.name.text}`,node,nextPath,localConditions,
                'resolved service method body is unavailable'); return;
            }
          }
        }
        add('boundary',receiver,callee.getText(),node,nextPath,localConditions,
          'member call has no confirmed local or DI-resolved implementation');
        return;
      }
      if (t.isCallExpression(node) && t.isIdentifier(node.expression)) {
        const symbol = context.checker.getSymbolAtLocation(node.expression);
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        const nextPath = [...path,location(context,node)];
        if (declaration && t.isFunctionDeclaration(declaration) && declaration.body &&
          context.sourceFiles.includes(declaration.getSourceFile().fileName)) {
          const key = keyFor(context,declaration.name ?? declaration,node,receiver,methodName,node.arguments);
          add('call',receiver,declaration.name?.text ?? 'function',node,nextPath,localConditions);
          if (active.has(key)) add('boundary',receiver,declaration.name?.text ?? 'function',node,nextPath,
            localConditions,'recursive function call on current branch');
          else if (level >= DEPTH) add('boundary',receiver,'call stack depth limit',node,nextPath,localConditions);
          else {
            active.add(key);
            visit(declaration.body,localConditions,level+1);
            active.delete(key);
          }
          return;
        }
        add('boundary',receiver,node.expression.text,node,nextPath,localConditions,
          'function body is unresolved or outside the analysis context');
        return;
      }
      t.forEachChild(node,child => visit(child,localConditions,level));
    };
    if (method.body) visit(method.body,conditions,depth);
    else add('boundary',receiver,method.name.getText(),method,path,conditions,'method body is unavailable');
    memo.set(key,steps.slice(before).map(item => ({...item,path:item.path.slice(path.length),
      conditions:item.conditions.slice(conditions.length)})));
    active.delete(key);
  };
  const root = classMethod(context, owner.node, methodName);
  if (root) visitMethod(root,owner.id,[location(context,root)],[],0,root,
    options.rootArguments ?? []);
  else diagnostics.push(`No method ${methodName} in ${owner.id}`);
  if (root && !limitReported) {
    const operation = traceOperation(context,owner,methodName);
    const registered = new Set(operation.registrations.map(item => item.location));
    const calls = new Map<string,ts.CallExpression>();
    const scan = (node: ts.Node): void => {
      if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'dispatch' && storeReceiver(context,node.expression.expression))
        calls.set(location(context,node),node);
      t.forEachChild(node,scan);
    };
    scan(owner.node);
    if (root.parent !== owner.node) scan(root);
    for (const step of operation.steps.filter(item => item.kind === 'action-dispatch' &&
      item.path.some(place => registered.has(place)))) {
      const call = calls.get(step.location);
      const arg = call?.arguments[0];
      const action = arg && actionFor(arg);
      if (!call || !action) {
        if (call) add('boundary',owner.id,'dynamic action',call,step.path,step.conditions,
          'subscription callback dispatch has no statically identified action');
        continue;
      }
      add('action-dispatch',owner.id,action.id,call,step.path,step.conditions,
        'dispatch reached through a confirmed live subscription');
      if (action.type) stateFromAction(action,owner.id,call,step.path,step.conditions,0);
    }
    if (options.outputElement && options.catalog) {
      const element = options.outputElement;
      const bindings = resolveElementBindings(element,context,options.catalog);
      const ng = context.toolchain.angularCompiler;
      const emittedBySite = new Map<string, { target: string; location: string; path: string[];
        conditions: string[]; detail: string | null }>();
      for (const item of operation.steps.filter(item => item.kind === 'output-emit'))
        emittedBySite.set(item.location, item);
      // The direct method traversal knows literal call arguments (for example findNext(true));
      // use that specialization over the unspecialized callback trace at the same emit site.
      for (const item of steps.filter(item => item.kind === 'output-emit' && item.source === owner.id))
        emittedBySite.set(item.location, { ...item, target: item.target.replace(/^this\./, '') });
      for (const emitted of emittedBySite.values()) {
        for (const relation of bindings.relations.filter(item => item.kind === 'output-subscription' &&
          item.targetId === owner.id && item.member === emitted.target)) {
          const handler = element.node.outputs.find(output => output.name === relation.alias)?.handler;
          if (!handler) continue;
          const methods: string[] = [];
          const visitor = new class extends ng.RecursiveAstVisitor {
            override visitCall(ast: InstanceType<typeof ng.Call>, value: unknown): unknown {
              if (ast.receiver instanceof ng.PropertyRead && ast.receiver.receiver instanceof ng.ImplicitReceiver)
                methods.push(ast.receiver.name);
              return super.visitCall(ast,value);
            }
          }();
          handler.visit(visitor);
          for (const name of methods) {
            const parentMethod = classMethod(context, element.owner.node, name);
            if (!parentMethod) {
              add('boundary',owner.id,name,root,emitted.path,
                [...emitted.conditions,...relation.conditions],'output handler method is unresolved');
              continue;
            }
            const conditions = [...emitted.conditions,...relation.conditions];
            add('output-subscription',`${owner.id}.${emitted.target}`,`${element.owner.id}.${name}`,
              parentMethod, emitted.path, conditions, 'component output reaches the selected template subscription');
            const argumentSource = emitted.detail ? t.createSourceFile('__ngwi_emit.ts',
              `(${emitted.detail});`, t.ScriptTarget.Latest, true) : null;
            const argumentStatement = argumentSource?.statements[0];
            const argument = argumentStatement && t.isExpressionStatement(argumentStatement)
              ? [unwrap(t, argumentStatement.expression)] : [];
            visitMethod(parentMethod,element.owner.id,[...emitted.path,location(context,parentMethod)],conditions,1,
              parentMethod,argument,options.parentLayers ?? []);
          }
        }
      }
    }
    diagnostics.push(...operation.diagnostics);
  }
  return { steps, diagnostics:[...new Set(diagnostics)], backgroundReads:[...new Set(backgroundReads)] };
}
