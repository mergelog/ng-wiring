import { unwrap } from '../../index/catalog.js';
import { location } from '../../resolve/operation/reactive.js';
import { matchIdentifier } from './capabilities.js';
const slash = (value) => value.replaceAll('\\', '/');
function symbolOf(context, node) {
    const t = context.toolchain.typescript;
    let found = context.checker.getSymbolAtLocation(node);
    if (found && found.flags & t.SymbolFlags.Alias)
        found = context.checker.getAliasedSymbol(found);
    return found;
}
function ownerOf(context, node) {
    const t = context.toolchain.typescript;
    let cursor = node;
    while (cursor) {
        if (t.isClassDeclaration(cursor) && cursor.name)
            return `${slash(cursor.getSourceFile().fileName)}#${cursor.name.text}`;
        cursor = cursor.parent;
    }
    return null;
}
function declaredName(context, node) {
    const t = context.toolchain.typescript;
    const parent = node.parent;
    for (const candidate of [parent]) {
        if (!candidate)
            continue;
        if ((t.isVariableDeclaration(candidate) || t.isPropertyDeclaration(candidate) ||
            t.isPropertyAssignment(candidate)) && (t.isIdentifier(candidate.name) || t.isStringLiteralLike(candidate.name)))
            return candidate.name.text;
    }
    return null;
}
/** Classifies the call argument; only rxMethod accepts an Observable, and that is not inferred for signalMethod. */
function argumentKind(context, call) {
    const argument = call.arguments[0];
    if (!argument)
        return 'none';
    const type = context.checker.getTypeAtLocation(argument);
    const names = new Set();
    const collect = (candidate) => {
        const symbol = candidate.getSymbol() ?? candidate.aliasSymbol;
        if (symbol)
            names.add(symbol.getName());
        if (candidate.isUnionOrIntersection())
            for (const part of candidate.types)
                collect(part);
    };
    collect(type);
    if (names.has('Observable') || names.has('Subject') || names.has('BehaviorSubject'))
        return 'observable';
    if (['Signal', 'WritableSignal', 'InputSignal', 'ModelSignal', 'DeepSignal'].some(name => names.has(name)))
        return 'signal';
    return 'value';
}
const conditionsFor = {
    'signals/rxMethod': ['the pipeline runs once per call and once per notification of a Signal or Observable argument',
        'a flattening operator decides whether a new call cancels the previous inner subscription',
        'the subscription ends when the owning injector is destroyed'],
    'signals/signalMethod': ['the processing function runs once per call and once per change of a Signal argument',
        'an Observable argument is not supported and is not inferred from rxMethod',
        'the tracking of a Signal argument ends when the owning injector is destroyed'],
};
/** Separates the definition of a reactive method from the calls that start it. */
export function analyzeReactiveMethods(context, stores) {
    const t = context.toolchain.typescript;
    const methods = [];
    const calls = [];
    const diagnostics = [];
    const byDeclaration = new Map();
    const files = context.sourceFiles.map(name => context.program.getSourceFile(name))
        .filter((file) => !!file);
    const walk = (node, visit) => {
        visit(node);
        t.forEachChild(node, child => walk(child, visit));
    };
    const featureSources = new Map();
    for (const record of stores?.declarations.values() ?? [])
        for (const feature of record.features)
            featureSources.set(feature.source, record.id);
    const enclosingStore = (node) => {
        let cursor = node;
        while (cursor) {
            if (t.isCallExpression(cursor)) {
                const found = featureSources.get(location(context, cursor));
                if (found)
                    return found;
            }
            cursor = cursor.parent;
        }
        return null;
    };
    for (const file of files)
        walk(file, node => {
            if (!t.isCallExpression(node))
                return;
            const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
            const matcher = matchIdentifier(context, callee)?.capability.matcherId;
            if (matcher !== 'signals/rxMethod' && matcher !== 'signals/signalMethod')
                return;
            const record = { id: location(context, node), capability: matcher,
                name: declaredName(context, node), storeId: enclosingStore(node), owner: ownerOf(context, node),
                source: location(context, node), conditions: conditionsFor[matcher], called: false };
            methods.push(record);
            const holder = node.parent;
            if (holder && (t.isVariableDeclaration(holder) || t.isPropertyDeclaration(holder) ||
                t.isPropertyAssignment(holder)))
                byDeclaration.set(holder, record);
        });
    const methodFor = (expression) => {
        const target = t.isPropertyAccessExpression(expression) ? expression.name : expression;
        const symbol = symbolOf(context, target);
        for (const declaration of symbol?.declarations ?? []) {
            const found = byDeclaration.get(declaration);
            if (found)
                return found;
        }
        if (!t.isPropertyAccessExpression(expression))
            return null;
        // A generated Store exposes its members through a mapped type; fall back to the member name in that Store.
        const name = expression.name.text;
        const candidates = methods.filter(item => item.name === name);
        return candidates.length === 1 ? candidates[0] ?? null : null;
    };
    for (const file of files)
        walk(file, node => {
            if (!t.isCallExpression(node))
                return;
            const target = unwrap(t, node.expression);
            if (!t.isIdentifier(target) && !t.isPropertyAccessExpression(target))
                return;
            const method = methodFor(target);
            if (!method)
                return;
            method.called = true;
            const argument = argumentKind(context, node);
            const gaps = [];
            if (method.capability === 'signals/signalMethod' && argument === 'observable')
                gaps.push('signalMethod was called with an Observable, which it does not accept');
            if (argument === 'unknown')
                gaps.push('the call argument type is not statically readable');
            calls.push({ id: location(context, node), methodId: method.id, capability: method.capability,
                argument, source: location(context, node),
                conditions: [...method.conditions, ...(argument === 'signal'
                        ? ['the pipeline restarts on each change of the supplied Signal'] : [])], gaps });
            for (const gap of gaps)
                diagnostics.push(`${gap} at ${location(context, node)}`);
        });
    for (const method of methods)
        if (!method.called)
            diagnostics.push(`${method.capability} ${method.name ?? method.id} is defined but never called`);
    return { methods, calls, diagnostics };
}
