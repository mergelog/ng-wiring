import type ts from 'typescript';
import type { AnalysisContext } from '../workspace/context.js';
import type { IndexedElement } from '../index/templates.js';
import { unwrap } from '../index/catalog.js';
import { location } from '../resolve/operation/reactive.js';
import { matchIdentifier } from '../adapters/reactive/capabilities.js';

/** One `patchState(store, …)` call: where it is, the member that holds it, and the keys it replaces. */
export interface PatchStateCall { location: string; member: string | null; keys: string[] }

/**
 * §7.6 `patchState` is the SignalStore write. The NgRx trace stops at it because it is an imported
 * function, so the assembly resolves it through the capability registry instead of by its name.
 */
export function findPatchStateCalls(context: AnalysisContext): PatchStateCall[] {
  const t = context.toolchain.typescript;
  const found: PatchStateCall[] = [];
  const memberOf = (node: ts.Node): string | null => {
    for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
      if ((t.isMethodDeclaration(cursor) || t.isPropertyAssignment(cursor) || t.isPropertyDeclaration(cursor)) &&
        (t.isIdentifier(cursor.name) || t.isStringLiteralLike(cursor.name))) return cursor.name.text;
      if (t.isShorthandPropertyAssignment(cursor)) return cursor.name.text;
    }
    return null;
  };
  const keysOf = (call: ts.CallExpression): string[] => {
    const keys: string[] = [];
    for (const argument of call.arguments.slice(1)) {
      const value = unwrap(t, argument);
      if (!t.isObjectLiteralExpression(value)) continue;
      for (const property of value.properties) {
        const name = property.name;
        if (name && (t.isIdentifier(name) || t.isStringLiteralLike(name))) keys.push(name.text);
      }
    }
    return keys;
  };
  for (const file of context.sourceFiles) {
    const source = context.program.getSourceFile(file);
    if (!source) continue;
    const visit = (node: ts.Node): void => {
      if (t.isCallExpression(node) && t.isIdentifier(node.expression) &&
        matchIdentifier(context, node.expression)?.capability.matcherId === 'signals/patchState') {
        found.push({ location: location(context, node), member: memberOf(node), keys: keysOf(node) });
      }
      t.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** A member read written in a template, with the receiver member when it is read through one. */
export interface TemplateRead { member: string; receiver: string | null }

/**
 * §7.3 the reads an element's own template expressions perform. A SignalStore state value is read as
 * `store.key()`, so the receiver member is kept and resolved by the caller against the injected Store.
 */
export function templateReads(element: IndexedElement, context: AnalysisContext): TemplateRead[] {
  const ng = context.toolchain.angularCompiler;
  const reads: TemplateRead[] = [];
  const record = (name: string, receiver: unknown): void => {
    if (receiver instanceof ng.ImplicitReceiver) { reads.push({ member: name, receiver: null }); return; }
    if ((receiver instanceof ng.PropertyRead || receiver instanceof ng.SafePropertyRead) &&
      receiver.receiver instanceof ng.ImplicitReceiver) reads.push({ member: name, receiver: receiver.name });
  };
  const visitor = new class extends ng.RecursiveAstVisitor {
    override visitPropertyRead(ast: InstanceType<typeof ng.PropertyRead>, ctx: unknown): unknown {
      record(ast.name, ast.receiver);
      return super.visitPropertyRead(ast, ctx);
    }
    override visitSafePropertyRead(ast: InstanceType<typeof ng.SafePropertyRead>, ctx: unknown): unknown {
      record(ast.name, ast.receiver);
      return super.visitSafePropertyRead(ast, ctx);
    }
  }();
  for (const input of element.node.inputs) input.value.visit(visitor);
  for (const output of element.node.outputs) output.handler.visit(visitor);
  for (const child of element.node.children) {
    if (child instanceof ng.TmplAstBoundText) child.value.visit(visitor);
  }
  return reads;
}
