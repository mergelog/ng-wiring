import { unwrap } from '../index/catalog.js';
import { location } from '../resolve/operation/reactive.js';
import { matchIdentifier } from '../adapters/reactive/capabilities.js';
/**
 * §7.6 `patchState` is the SignalStore write. The NgRx trace stops at it because it is an imported
 * function, so the assembly resolves it through the capability registry instead of by its name.
 */
export function findPatchStateCalls(context) {
    const t = context.toolchain.typescript;
    const found = [];
    const memberOf = (node) => {
        for (let cursor = node.parent; cursor; cursor = cursor.parent) {
            if ((t.isMethodDeclaration(cursor) || t.isPropertyAssignment(cursor) || t.isPropertyDeclaration(cursor)) &&
                (t.isIdentifier(cursor.name) || t.isStringLiteralLike(cursor.name)))
                return cursor.name.text;
            if (t.isShorthandPropertyAssignment(cursor))
                return cursor.name.text;
        }
        return null;
    };
    const objectKeys = (node, into) => {
        const value = unwrap(t, node);
        if (!t.isObjectLiteralExpression(value))
            return;
        for (const property of value.properties) {
            const name = property.name;
            if (name && (t.isIdentifier(name) || t.isStringLiteralLike(name)))
                into.push(name.text);
        }
    };
    /** Each updater in argument order: a partial object, or a function returning one. */
    const keysOf = (call) => {
        const keys = [];
        for (const argument of call.arguments.slice(1)) {
            const value = unwrap(t, argument);
            if (t.isArrowFunction(value) || t.isFunctionExpression(value)) {
                const produced = t.isBlock(value.body)
                    ? value.body.statements.filter(t.isReturnStatement).flatMap(item => item.expression ? [item.expression] : [])
                    : [value.body];
                for (const item of produced)
                    objectKeys(item, keys);
                continue;
            }
            objectKeys(value, keys);
        }
        return [...new Set(keys)];
    };
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (!source)
            continue;
        const visit = (node) => {
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
/**
 * §7.3 the reads an element's own template expressions perform. A SignalStore state value is read as
 * `store.key()`, so the receiver member is kept and resolved by the caller against the injected Store.
 */
export function templateReads(element, context) {
    const ng = context.toolchain.angularCompiler;
    const reads = [];
    const record = (name, receiver) => {
        if (receiver instanceof ng.ImplicitReceiver) {
            reads.push({ member: name, receiver: null });
            return;
        }
        if ((receiver instanceof ng.PropertyRead || receiver instanceof ng.SafePropertyRead) &&
            receiver.receiver instanceof ng.ImplicitReceiver)
            reads.push({ member: name, receiver: receiver.name });
    };
    const visitor = new class extends ng.RecursiveAstVisitor {
        visitPropertyRead(ast, ctx) {
            record(ast.name, ast.receiver);
            return super.visitPropertyRead(ast, ctx);
        }
        visitSafePropertyRead(ast, ctx) {
            record(ast.name, ast.receiver);
            return super.visitSafePropertyRead(ast, ctx);
        }
    }();
    for (const input of element.node.inputs)
        input.value.visit(visitor);
    for (const output of element.node.outputs)
        output.handler.visit(visitor);
    for (const child of element.node.children) {
        if (child instanceof ng.TmplAstBoundText)
            child.value.visit(visitor);
    }
    return reads;
}
