import { unwrap } from '../../index/catalog.js';
import { location } from '../../resolve/operation/reactive.js';
import { matchIdentifier } from './capabilities.js';
const slash = (value) => value.replaceAll('\\', '/');
const signalTypeNames = new Set(['Signal', 'WritableSignal', 'InputSignal', 'InputSignalWithTransform',
    'ModelSignal', 'DeepSignal', 'SignalState']);
function symbolOf(context, node) {
    const t = context.toolchain.typescript;
    let found = context.checker.getSymbolAtLocation(node);
    if (found && found.flags & t.SymbolFlags.Alias)
        found = context.checker.getAliasedSymbol(found);
    return found;
}
/** A signal is recognised by its declared type, so a same-named plain function is not mistaken for one. */
function isSignalValue(context, node) {
    const type = context.checker.getTypeAtLocation(node);
    const check = (candidate) => {
        const symbol = candidate.getSymbol() ?? candidate.aliasSymbol;
        if (!symbol)
            return false;
        if (!signalTypeNames.has(symbol.getName()))
            return false;
        return !!symbol.declarations?.some(declaration => {
            const file = slash(declaration.getSourceFile().fileName);
            return file.includes('/node_modules/@angular/core/') || file.includes('/node_modules/@ngrx/signals/');
        });
    };
    if (check(type))
        return true;
    return !!type.isUnionOrIntersection() && type.types.some(check);
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
function nameOf(context, node) {
    const t = context.toolchain.typescript;
    const parent = node.parent;
    if (t.isVariableDeclaration(parent) && t.isIdentifier(parent.name))
        return parent.name.text;
    if (t.isPropertyDeclaration(parent) && t.isIdentifier(parent.name))
        return parent.name.text;
    return null;
}
function objectKeys(context, expression, into) {
    if (!expression)
        return;
    const t = context.toolchain.typescript;
    const node = unwrap(t, expression);
    if (!t.isObjectLiteralExpression(node))
        return;
    for (const property of node.properties) {
        const name = property.name;
        if (name && (t.isIdentifier(name) || t.isStringLiteralLike(name)))
            into.push(name.text);
    }
}
const trackedMatchers = new Set(['angular/computed', 'angular/effect', 'angular/afterRenderEffect',
    'angular/linkedSignal', 'signals/deepComputed', 'signals/withComputed', 'signals/withLinkedState']);
/** A read is tracked only inside a reactive callback, before any await, and outside `untracked`. */
function trackingAt(context, node) {
    const t = context.toolchain.typescript;
    let cursor = node;
    let child = node;
    while (cursor) {
        if (t.isCallExpression(cursor) && cursor.arguments.some(argument => argument === child)) {
            const callee = t.isPropertyAccessExpression(cursor.expression) ? cursor.expression.name : cursor.expression;
            const matcher = matchIdentifier(context, callee)?.capability.matcherId;
            if (matcher === 'angular/untracked')
                return { tracking: 'untracked', reason: null };
            if (matcher && trackedMatchers.has(matcher)) {
                const callback = child;
                if ((t.isArrowFunction(callback) || t.isFunctionExpression(callback)) &&
                    hasAwaitBefore(context, callback, node.getStart()))
                    return { tracking: 'snapshot', reason: 'the read follows an await, outside the tracked region' };
                return { tracking: 'tracked', reason: null };
            }
            if (matcher === 'signals/getState')
                return { tracking: 'snapshot', reason: null };
        }
        child = cursor;
        cursor = cursor.parent;
    }
    return { tracking: 'snapshot', reason: null };
}
function hasAwaitBefore(context, callback, position) {
    const t = context.toolchain.typescript;
    let found = false;
    const visit = (node) => {
        if (found)
            return;
        if (t.isAwaitExpression(node) && node.getEnd() <= position) {
            found = true;
            return;
        }
        t.forEachChild(node, visit);
    };
    visit(callback);
    return found;
}
/** Reads the `equal` option of a derived value; a custom comparison changes when consumers re-run. */
function equalityArgument(context, matcher, call) {
    const t = context.toolchain.typescript;
    const index = matcher === 'angular/linkedSignal' && call.arguments.length === 1 ? 0 : 1;
    const candidates = [call.arguments[index], call.arguments[0]].filter((item) => !!item);
    for (const candidate of candidates) {
        const options = unwrap(t, candidate);
        if (!t.isObjectLiteralExpression(options))
            continue;
        const property = options.properties.find(item => item.name && t.isIdentifier(item.name) && item.name.text === 'equal');
        if (property)
            return property.getText();
    }
    return null;
}
/** Catalogues Angular Signal and SignalState sources, their reads, writes, derived links, and effects. */
export function analyzeSignals(context, files) {
    const t = context.toolchain.typescript;
    const sources = [];
    const reads = [];
    const writes = [];
    const links = [];
    const effects = [];
    const diagnostics = [];
    const byDeclaration = new Map();
    const callsByLocation = new Map();
    const targets = files ?? context.sourceFiles.map(name => context.program.getSourceFile(name))
        .filter((file) => !!file);
    const frameworks = {
        'angular/signal': 'angular-signal', 'angular/input': 'angular-signal',
        'angular/input.required': 'angular-signal', 'angular/model': 'angular-signal',
        'signals/signalState': 'signal-state'
    };
    const walk = (node, visit) => {
        visit(node);
        t.forEachChild(node, child => walk(child, visit));
    };
    for (const file of targets)
        walk(file, node => {
            if (!t.isCallExpression(node))
                return;
            callsByLocation.set(location(context, node), node);
            const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
            const matched = matchIdentifier(context, callee, ['function', 'member']);
            const matcher = matched?.capability.matcherId ??
                (t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'required' &&
                    matchIdentifier(context, node.expression.expression)?.capability.matcherId === 'angular/input'
                    ? 'angular/input.required' : null);
            if (!matcher)
                return;
            const framework = frameworks[matcher];
            if (framework) {
                const name = nameOf(context, node);
                const keys = [];
                if (matcher === 'signals/signalState')
                    objectKeys(context, node.arguments[0], keys);
                const record = { id: location(context, node), capability: matcher,
                    state: { framework, declaration: location(context, node), instance: ownerOf(context, node), key: name },
                    source: location(context, node), keys,
                    conditions: matcher === 'angular/model' ? ['a model signal writes back to its parent binding'] : [] };
                sources.push(record);
                if (node.parent && (t.isVariableDeclaration(node.parent) || t.isPropertyDeclaration(node.parent)))
                    byDeclaration.set(node.parent, record.id);
                return;
            }
            if (matcher === 'angular/effect' || matcher === 'angular/afterRenderEffect' || matcher === 'signals/watchState') {
                const phase = matcher === 'angular/afterRenderEffect' ? 'after-render' :
                    matcher === 'signals/watchState' ? 'state-watcher' : 'change-detection';
                effects.push({ id: location(context, node), framework: matcher === 'signals/watchState' ? 'signal-store' : 'angular-signal',
                    phase, capability: matcher, location: location(context, node),
                    lifetime: ['runs once after creation', ...(matcher === 'signals/watchState'
                            ? ['stops when the owning injector or the supplied config ends']
                            : ['stops when the owning injector is destroyed or the EffectRef is destroyed'])],
                    reads: [], cleanups: [], destroys: [] });
                return;
            }
            if (matcher === 'angular/computed' || matcher === 'angular/linkedSignal' || matcher === 'signals/deepComputed' ||
                matcher === 'angular/toSignal' || matcher === 'angular/toObservable') {
                const name = nameOf(context, node);
                const equalOption = equalityArgument(context, matcher, node);
                const record = { id: location(context, node), capability: matcher, from: null,
                    to: name, location: location(context, node), equal: equalOption,
                    conditions: [...(equalOption ? [`a custom equal function (${equalOption}) decides whether the value changed`] : []),
                        ...matcher === 'angular/computed' || matcher === 'signals/deepComputed'
                            ? ['the value is recomputed lazily when read', 'a tracked dependency must change its compared value']
                            : matcher === 'angular/linkedSignal'
                                ? ['the value is recomputed when its source changes', 'an explicit write also replaces the value']
                                : matcher === 'angular/toSignal'
                                    ? ['the internal subscription starts on creation and ends when the injector is destroyed']
                                    : ['each notification follows a change-detection boundary, not every set']] };
                links.push(record);
                if (node.parent && (t.isVariableDeclaration(node.parent) || t.isPropertyDeclaration(node.parent)))
                    byDeclaration.set(node.parent, record.id);
                return;
            }
        });
    const sourceIdFor = (expression) => {
        const target = t.isPropertyAccessExpression(expression) ? expression.name : expression;
        const declaration = symbolOf(context, target)?.valueDeclaration;
        return declaration ? byDeclaration.get(declaration) ?? null : null;
    };
    for (const file of targets)
        walk(file, node => {
            if (!t.isCallExpression(node))
                return;
            if (t.isPropertyAccessExpression(node.expression)) {
                const member = node.expression.name.text;
                const receiver = node.expression.expression;
                if (['set', 'update'].includes(member) && isSignalValue(context, receiver)) {
                    writes.push({ id: location(context, node), sourceId: sourceIdFor(receiver),
                        capability: `angular/signal.${member}`, keys: [], location: location(context, node),
                        conditions: [...(trackingAt(context, node).tracking === 'untracked'
                                ? ['the write happens inside untracked and still notifies consumers'] : [])] });
                    return;
                }
                if (member === 'asReadonly' && isSignalValue(context, receiver)) {
                    links.push({ id: location(context, node), capability: 'angular/signal.asReadonly',
                        from: sourceIdFor(receiver), to: nameOf(context, node), location: location(context, node),
                        equal: null, conditions: ['the read-only reference exposes the same state'] });
                    return;
                }
            }
            const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
            const matcher = matchIdentifier(context, callee)?.capability.matcherId;
            if (matcher === 'signals/patchState') {
                const keys = [];
                const gaps = [];
                for (const updater of node.arguments.slice(1)) {
                    const value = unwrap(t, updater);
                    if (t.isObjectLiteralExpression(value))
                        objectKeys(context, value, keys);
                    else if (t.isArrowFunction(value) || t.isFunctionExpression(value)) {
                        const produced = t.isBlock(value.body)
                            ? value.body.statements.filter(t.isReturnStatement).flatMap(item => item.expression ? [item.expression] : [])
                            : [value.body];
                        for (const item of produced) {
                            const inner = unwrap(t, item);
                            if (t.isObjectLiteralExpression(inner))
                                objectKeys(context, inner, keys);
                            else
                                gaps.push('a state updater result is not a statically readable object');
                        }
                    }
                    else
                        gaps.push('a patchState argument is not statically readable');
                }
                const target = node.arguments[0];
                writes.push({ id: location(context, node), sourceId: target ? sourceIdFor(target) : null,
                    capability: 'signals/patchState', keys: [...new Set(keys)], location: location(context, node),
                    conditions: ['the updaters are applied in argument order', ...gaps] });
                for (const gap of gaps)
                    diagnostics.push(`${gap} at ${location(context, node)}`);
                return;
            }
            if (matcher === 'signals/getState' && node.arguments[0]) {
                reads.push({ id: location(context, node), sourceId: sourceIdFor(node.arguments[0]),
                    expression: node.getText(), tracking: 'snapshot',
                    reason: 'getState reads the whole state without creating a dependency on one key',
                    location: location(context, node) });
                return;
            }
            if (node.arguments.length === 0 && isSignalValue(context, node.expression)) {
                const { tracking, reason } = trackingAt(context, node);
                reads.push({ id: location(context, node), sourceId: sourceIdFor(node.expression),
                    expression: node.expression.getText(), tracking, reason, location: location(context, node) });
            }
        });
    const destroyed = new Map();
    for (const node of callsByLocation.values()) {
        if (!t.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'destroy')
            continue;
        const target = node.expression.expression;
        const receiverType = context.checker.getTypeAtLocation(target).getSymbol();
        if (receiverType?.getName() !== 'EffectRef')
            continue;
        const declaration = symbolOf(context, t.isPropertyAccessExpression(target) ? target.name : target)?.valueDeclaration;
        if (declaration)
            destroyed.set(declaration, [...(destroyed.get(declaration) ?? []), location(context, node)]);
    }
    // Only the tracked reads inside the callback become the effect's re-execution dependencies.
    for (const effect of effects) {
        const node = callsByLocation.get(effect.location);
        if (!node)
            continue;
        effect.reads = reads.filter(read => {
            if (read.tracking !== 'tracked')
                return false;
            const target = callsByLocation.get(read.location);
            return !!target && target.getStart() >= node.getStart() && target.getEnd() <= node.getEnd();
        }).map(read => read.id);
        const callback = node.arguments[0];
        const parameter = (t.isArrowFunction(callback ?? node) || t.isFunctionExpression(callback ?? node)) &&
            callback && (t.isArrowFunction(callback) || t.isFunctionExpression(callback))
            ? callback.parameters[0]?.name : undefined;
        if (parameter && t.isIdentifier(parameter))
            walk(node, child => {
                if (t.isCallExpression(child) && t.isIdentifier(child.expression) && child.expression.text === parameter.text)
                    effect.cleanups.push(location(context, child));
            });
        const holder = node.parent && (t.isVariableDeclaration(node.parent) || t.isPropertyDeclaration(node.parent))
            ? node.parent : null;
        if (!holder)
            continue;
        effect.destroys.push(...(destroyed.get(holder) ?? []));
    }
    return { sources, reads, writes, links, effects, diagnostics };
}
