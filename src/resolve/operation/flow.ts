import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
import { importedApi, inspectPipe, location, operatorSemantics, type OperatorRecord } from './reactive.js';

export interface OperationStep {
  kind: 'call' | 'state-write' | 'output-emit' | 'reactive-link' | 'subscription' | 'boundary';
  source: string;
  target: string;
  location: string;
  path: string[];
  timing: 'sync' | 'output' | 'async-output' | 'timer' | 'microtask' | 'subscription' | 'change-detection' | 'unknown';
  conditions: string[];
  detail: string | null;
}
export interface SubscriptionRegistration { source: string; location: string; context: string;
  conditions: string[]; operators: OperatorRecord[]; active: boolean }
export interface OperationTrace { steps: OperationStep[]; evidence: string[];
  registrations: SubscriptionRegistration[]; diagnostics: string[] }
interface InternalRegistration extends SubscriptionRegistration { callback: ts.Expression | null; operatorCalls: (ts.CallExpression | null)[] }
const maxDepth = 64;
const maxSteps = 10000;

function receiverName(context: AnalysisContext, node: ts.Expression): string | null {
  const t = context.toolchain.typescript;
  if (t.isPropertyAccessExpression(node) && node.expression.kind === t.SyntaxKind.ThisKeyword) return node.name.text;
  if (t.isIdentifier(node)) return node.text;
  return null;
}
function subscription(context: AnalysisContext, call: ts.CallExpression, place: string): InternalRegistration | null {
  const t = context.toolchain.typescript;
  if (!t.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'subscribe') return null;
  const observableType = context.checker.getTypeAtLocation(call.expression.expression);
  if (!observableType.getSymbol()?.declarations?.some(d => d.getSourceFile().fileName.replaceAll('\\', '/')
    .includes('/node_modules/rxjs/'))) return null;
  let source: ts.Expression = call.expression.expression;
  const operators = t.isCallExpression(source) ? inspectPipe(context, source) : [];
  if (operators.length && t.isCallExpression(source) && t.isPropertyAccessExpression(source.expression)) source = source.expression.expression;
  const name = receiverName(context, source);
  if (!name) return null;
  const text = place === 'constructor' || place === 'ngOnInit' ? place : place === 'field' ? 'field initialization' : place;
  const conditions = [`registration occurs in ${text}; unrelated initialization is not an operation result`,
    'subscription must still be alive when the source emits'];
  if (place !== 'constructor' && place !== 'ngOnInit' && place !== 'field') conditions.push('registration is conditional on the containing call');
  const chain = operators.map(item => item.api?.name);
  if (chain.includes('takeUntilDestroyed')) conditions.push('lifetime ends on DestroyRef destruction');
  else if (chain.includes('take')) conditions.push('lifetime may end at the take limit');
  else conditions.push('unsubscribe or owner destruction is not proven');
  const callback = call.arguments[0] ?? null;
  const operatorCalls = operators.length && t.isCallExpression(call.expression.expression)
    ? call.expression.expression.arguments.map(arg => t.isCallExpression(arg) ? arg : null) : [];
  return { source: name, location: location(context, call), context: text, conditions, operators,
    active: place === 'constructor' || place === 'ngOnInit' || place === 'field', callback, operatorCalls };
}
function registrationIndex(context: AnalysisContext, owner: Declaration): InternalRegistration[] {
  const t = context.toolchain.typescript;
  const output: InternalRegistration[] = [];
  const visit = (node: ts.Node, place: string): void => {
    if (t.isCallExpression(node)) {
      const record = subscription(context, node, place);
      if (record) {
        for (let parent = node.parent; parent && parent !== owner.node; parent = parent.parent) {
          if (t.isIfStatement(parent)) record.conditions.push(`registration requires ${parent.expression.getText()}`);
          if (t.isForStatement(parent) || t.isForOfStatement(parent) || t.isWhileStatement(parent))
            record.conditions.push('registration may repeat in a loop');
        }
        output.push(record);
      }
    }
    t.forEachChild(node, child => visit(child, place));
  };
  for (const member of owner.node.members) {
    const place = t.isConstructorDeclaration(member) ? 'constructor' :
      t.isMethodDeclaration(member) ? member.name.getText() : 'field';
    visit(member, place);
  }
  const hasUnsubscribe = owner.node.members.some(member => member.getText().includes('.unsubscribe('));
  if (hasUnsubscribe) for (const record of output) record.conditions.push('an unsubscribe call exists; its receiver and execution path determine lifetime');
  return output;
}
function ownedMethod(context: AnalysisContext, owner: Declaration, call: ts.CallExpression): ts.MethodDeclaration | null {
  const t = context.toolchain.typescript;
  if (!t.isPropertyAccessExpression(call.expression) || call.expression.expression.kind !== t.SyntaxKind.ThisKeyword) return null;
  const symbol = context.checker.getSymbolAtLocation(call.expression.name);
  const method = symbol?.valueDeclaration;
  return method && t.isMethodDeclaration(method) && method.parent === owner.node ? method : null;
}

/** Bounded, forward-only trace from one confirmed component method call. */
export function traceOperation(context: AnalysisContext, owner: Declaration, methodName: string): OperationTrace {
  const t = context.toolchain.typescript;
  const steps: OperationStep[] = [];
  const diagnostics: string[] = [];
  const registrations = registrationIndex(context, owner);
  const root = owner.node.members.find(member => t.isMethodDeclaration(member) && member.name.getText() === methodName);
  if (!root || !t.isMethodDeclaration(root)) return { steps, evidence: [], registrations,
    diagnostics: [`No method ${methodName} in ${owner.id}`] };
  const active = new Set<ts.Node>();
  const add = (kind: OperationStep['kind'], source: string, target: string, node: ts.Node, path: string[],
    timing: OperationStep['timing'], conditions: string[] = [], detail: string | null = null): void => {
    if (steps.length >= maxSteps) return;
    steps.push({ kind, source, target, location: location(context, node), path: [...path], timing,
      conditions: [...conditions], detail });
  };
  const visit = (node: ts.Node, path: string[], depth: number, conditions: string[]): void => {
    if (steps.length >= maxSteps) return;
    if (depth >= maxDepth) { add('boundary', methodName, 'depth limit', node, path, 'unknown', conditions); return; }
    if (t.isIfStatement(node)) {
      visit(node.thenStatement, path, depth, [...conditions, `if ${node.expression.getText()}`]);
      if (node.elseStatement) visit(node.elseStatement, path, depth, [...conditions, `else of ${node.expression.getText()}`]);
      return;
    }
    if (t.isConditionalExpression(node)) {
      visit(node.whenTrue, path, depth, [...conditions, `if ${node.condition.getText()}`]);
      visit(node.whenFalse, path, depth, [...conditions, `else of ${node.condition.getText()}`]);
      return;
    }
    if (t.isForStatement(node) || t.isForOfStatement(node) || t.isForInStatement(node) ||
      t.isWhileStatement(node) || t.isDoStatement(node)) {
      visit(node.statement, path, depth, [...conditions, 'loop body may execute zero or multiple times']);
      return;
    }
    if (t.isBinaryExpression(node) && node.operatorToken.kind >= t.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= t.SyntaxKind.LastAssignment) {
      add('state-write', methodName, node.left.getText(), node, path, 'sync', conditions, node.right.getText());
    }
    if (t.isCallExpression(node)) {
      const callSite = location(context, node);
      const nextPath = [...path, callSite];
      const method = ownedMethod(context, owner, node);
      if (method) {
        add('call', methodName, method.name.getText(), node, nextPath, 'sync', conditions);
        if (active.has(method)) add('boundary', methodName, method.name.getText(), node, nextPath, 'unknown',
          [...conditions, 'recursive call on the current branch']);
        else if (method.body) {
          active.add(method);
          visit(method.body, nextPath, depth + 1, conditions);
          active.delete(method);
        }
        for (const arg of node.arguments) visit(arg, nextPath, depth + 1, conditions);
        return;
      }
      const expr = node.expression;
      if (t.isPropertyAccessExpression(expr)) {
        const action = expr.name.text;
        const target = receiverName(context, expr.expression) ?? expr.expression.getText();
        if (action === 'emit') {
          const type = context.checker.getTypeAtLocation(expr.expression);
          const angularEmitter = !!type.getSymbol()?.declarations?.some(d => d.getSourceFile().fileName.replaceAll('\\','/')
            .includes('/node_modules/@angular/core/'));
          if ([...owner.outputs.values()].includes(target)) {
            const field = owner.node.members.find(member => t.isPropertyDeclaration(member) && member.name.getText() === target);
            const initializer = field && t.isPropertyDeclaration(field) ? field.initializer : null;
            const asyncEmitter = !!initializer && t.isNewExpression(initializer) && t.isIdentifier(initializer.expression) &&
              importedApi(context, initializer.expression)?.name === 'EventEmitter' &&
              initializer.arguments?.[0]?.kind === t.SyntaxKind.TrueKeyword;
            add('output-emit', methodName, target, node, nextPath, asyncEmitter ? 'async-output' : 'output',
              [...conditions, ...(asyncEmitter ? ['EventEmitter(true) schedules delivery asynchronously'] : [])],
              node.arguments[0]?.getText() ?? null);
            return;
          }
          if (angularEmitter) {
            add('boundary', methodName, target, node, nextPath, 'unknown', conditions,
              'EventEmitter instance is not an exposed component output');
            return;
          }
        }
        if (action === 'set' || action === 'update') {
          const symbol = context.checker.getSymbolAtLocation(expr.name);
          const isSignal = !!symbol?.declarations?.some(d => d.getSourceFile().fileName.replaceAll('\\','/').includes('/node_modules/@angular/core/'));
          if (isSignal) { add('state-write', methodName, target, node, nextPath, 'sync', conditions,
            `${action}(${node.arguments[0]?.getText() ?? ''})`); return; }
        }
        if (action === 'next') {
          const receiver = context.checker.getTypeAtLocation(expr.expression);
          const isSubject = receiver.getSymbol()?.declarations?.some(d => d.getSourceFile().fileName.replaceAll('\\','/').includes('/node_modules/rxjs/'));
          if (isSubject) {
            add('state-write', methodName, target, node, nextPath, 'sync', conditions,
              `Subject.next(${node.arguments[0]?.getText() ?? ''})`);
            for (const registration of registrations.filter(item => item.source === target && item.active)) {
              const registrationPath = [...nextPath, registration.location];
              const baseConditions = [...conditions, ...registration.conditions];
              add('subscription', target, registration.context, node, registrationPath, 'subscription', baseConditions);
              let stopped = false;
              let timing: OperationStep['timing'] = 'subscription';
              const pipelineConditions = [...baseConditions];
              for (const [index, operator] of registration.operators.entries()) {
                if (operator.boundary || !operator.semantics) {
                  add('boundary', target, operator.name, node, [...registrationPath, operator.location], 'unknown',
                    baseConditions, operator.boundary);
                  stopped = true; break;
                }
                timing = operator.semantics.timing;
                pipelineConditions.push(...operator.semantics.conditions);
                add('reactive-link', target, operator.name, node, [...registrationPath, operator.location], timing,
                  pipelineConditions, operator.semantics.mode);
                const callbackArgs = registration.operatorCalls[index]?.arguments ?? [];
                for (const [callbackIndex, callback] of callbackArgs.entries()) {
                  const callbackConditions = [...pipelineConditions];
                  if (['tapResponse', 'mapResponse'].includes(operator.api?.name ?? ''))
                    callbackConditions.push(callbackIndex === 0 ? 'success/next notification' : 'error notification');
                  if (t.isArrowFunction(callback) || t.isFunctionExpression(callback))
                    visit(callback.body, [...registrationPath, operator.location], depth + 1, callbackConditions);
                  else if (t.isObjectLiteralExpression(callback)) for (const property of callback.properties) {
                    if (!t.isPropertyAssignment(property)) continue;
                    const body = property.initializer;
                    if (t.isArrowFunction(body) || t.isFunctionExpression(body))
                      visit(body.body, [...registrationPath, operator.location], depth + 1,
                        [...callbackConditions, `${property.name.getText()} notification`]);
                  }
                }
              }
              if (!stopped && registration.callback && (t.isArrowFunction(registration.callback) || t.isFunctionExpression(registration.callback)))
                visit(registration.callback.body, registrationPath, depth + 1, pipelineConditions);
            }
            return;
          }
        }
      }
      const callee = t.isPropertyAccessExpression(expr) ? expr.name : expr;
      const api = importedApi(context, callee);
      if (api && ['computed', 'effect'].includes(api.name)) {
        add('reactive-link', methodName, api.name, node, nextPath,
          api.name === 'effect' ? 'change-detection' : 'sync',
          [...conditions, api.name === 'effect' ? 'effect callback runs on initial registration and tracked dependency changes' :
            'computed body is evaluated lazily when read and dependencies change']);
        return;
      }
      if (api && ['firstValueFrom', 'lastValueFrom', 'of', 'from', 'forkJoin', 'timer'].includes(api.name)) {
        const semantic = operatorSemantics(api.name)!;
        add('reactive-link', methodName, api.name, node, nextPath, semantic.timing, [...conditions, ...semantic.conditions]);
      }
      if (!api && t.isPropertyAccessExpression(expr) && expr.expression.kind === t.SyntaxKind.ThisKeyword)
        add('boundary', methodName, expr.name.text, node, nextPath, 'unknown', conditions,
          'member call is inherited, dynamic, or outside the local operation scope');
    }
    t.forEachChild(node, child => visit(child, path, depth, conditions));
  };
  active.add(root);
  if (root.body) visit(root.body, [location(context, root)], 0, []);
  if (steps.length >= maxSteps) diagnostics.push(`Operation trace reached ${maxSteps} steps`);
  return { steps, evidence: [...new Set(steps.map(step => step.location))],
    registrations: registrations.map(({callback: _callback, operatorCalls: _operatorCalls, ...record}) => record), diagnostics };
}
