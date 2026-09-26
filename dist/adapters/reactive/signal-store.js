import { getProperty, unwrap } from '../../index/catalog.js';
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
/** Follows a name to the expression it was declared with, so an alias never hides the call. */
function definition(context, expression) {
    const t = context.toolchain.typescript;
    let node = unwrap(t, expression);
    const visited = new Set();
    while ((t.isIdentifier(node) || t.isPropertyAccessExpression(node)) && !visited.has(node)) {
        visited.add(node);
        const declaration = symbolOf(context, t.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
        if (!declaration || !t.isVariableDeclaration(declaration) || !declaration.initializer)
            break;
        node = unwrap(t, declaration.initializer);
    }
    return node;
}
function calleeOf(context, call) {
    const t = context.toolchain.typescript;
    return t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
}
function matchedCapability(context, call) {
    return matchIdentifier(context, calleeOf(context, call))?.capability ?? null;
}
/** Reads the object a feature factory produces, whether written inline or returned from a function. */
function producedObject(context, expression) {
    if (!expression)
        return null;
    const t = context.toolchain.typescript;
    const node = definition(context, expression);
    if (t.isObjectLiteralExpression(node))
        return node;
    if (!t.isArrowFunction(node) && !t.isFunctionExpression(node))
        return null;
    if (!t.isBlock(node.body)) {
        const body = unwrap(t, node.body);
        return t.isObjectLiteralExpression(body) ? body : null;
    }
    const returned = node.body.statements.find(t.isReturnStatement)?.expression;
    return returned ? producedObject(context, returned) : null;
}
function memberNames(context, object, gaps, label) {
    const t = context.toolchain.typescript;
    if (!object) {
        gaps.push(`${label} members are not a statically readable object`);
        return [];
    }
    const names = [];
    for (const property of object.properties) {
        if (t.isSpreadAssignment(property)) {
            gaps.push(`${label} spreads ${property.expression.getText()}; its member names are not enumerated`);
            continue;
        }
        const name = property.name;
        if (!name || (!t.isIdentifier(name) && !t.isStringLiteralLike(name))) {
            gaps.push(`${label} has a computed member name at ${location(context, property)}`);
            continue;
        }
        names.push(name.text);
    }
    return names;
}
/** A feature reached through a factory call is expanded from the function it returns. The call itself is
 *  still returned when no known feature is behind it, so the caller can name the unknown callee. */
function featureCall(context, expression, depth) {
    const t = context.toolchain.typescript;
    const node = definition(context, expression);
    if (!t.isCallExpression(node))
        return null;
    if (matchedCapability(context, node) || depth >= 16)
        return node;
    const declaration = symbolOf(context, calleeOf(context, node))?.valueDeclaration;
    if (!declaration)
        return node;
    const body = t.isFunctionDeclaration(declaration) || t.isArrowFunction(declaration) ||
        t.isFunctionExpression(declaration) ? declaration.body :
        t.isVariableDeclaration(declaration) && declaration.initializer &&
            (t.isArrowFunction(declaration.initializer) || t.isFunctionExpression(declaration.initializer))
            ? declaration.initializer.body : undefined;
    const returned = body && (t.isBlock(body) ? body.statements.find(t.isReturnStatement)?.expression : body);
    return (returned && featureCall(context, returned, depth + 1)) ?? node;
}
function addMembers(collector, names, kind, index, capability, source, dependencies = new Map()) {
    for (const name of names) {
        const previous = collector.members.filter(item => item.name === name).at(-1);
        collector.members.push({ name, kind, featureIndex: index, capability, source,
            dependencies: [...(dependencies.get(name) ?? [])],
            shadows: previous ? `${previous.capability}#${previous.name}@${previous.source}` : null });
    }
}
/** Finds Store keys read by a feature's derived member, preserving only reads through that factory's Store. */
function derivedDependencies(context, expression, object) {
    const t = context.toolchain.typescript;
    const callback = expression && definition(context, expression);
    if (!callback || (!t.isArrowFunction(callback) && !t.isFunctionExpression(callback)))
        return new Map();
    const parameter = callback.parameters[0]?.name;
    const receiverNames = new Set();
    if (parameter && t.isIdentifier(parameter))
        receiverNames.add(parameter.text);
    if (parameter && t.isObjectBindingPattern(parameter))
        for (const element of parameter.elements) {
            const source = element.propertyName ?? element.name;
            if (t.isIdentifier(source))
                receiverNames.add(source.text);
        }
    const result = new Map();
    for (const property of object?.properties ?? []) {
        if (!t.isPropertyAssignment(property) || !property.name ||
            (!t.isIdentifier(property.name) && !t.isStringLiteralLike(property.name)))
            continue;
        const name = property.name.text;
        const keys = new Set();
        const visit = (node) => {
            if (t.isPropertyAccessExpression(node) && t.isIdentifier(node.expression) &&
                receiverNames.has(node.expression.text))
                keys.add(node.name.text);
            t.forEachChild(node, visit);
        };
        visit(property.initializer);
        result.set(name, [...keys]);
    }
    return result;
}
/** Expands the argument list in declaration order; a later feature shadows an earlier member of the same name. */
function collectFeatures(context, args, collector, depth) {
    const t = context.toolchain.typescript;
    for (const argument of args) {
        const index = collector.features.length;
        const call = featureCall(context, argument, 0);
        if (!call) {
            collector.features.push({ index, capability: null, label: argument.getText(),
                source: location(context, argument), status: 'boundary',
                reason: 'feature expression is not a statically identified call' });
            collector.gaps.push(`unidentified feature at ${location(context, argument)} may add or replace members`);
            continue;
        }
        const capability = matchedCapability(context, call);
        const source = location(context, call);
        if (!capability) {
            collector.features.push({ index, capability: null, label: calleeOf(context, call).getText(), source,
                status: 'boundary', reason: 'feature is not a registered SignalStore API' });
            collector.gaps.push(`unknown feature ${calleeOf(context, call).getText()} at ${source} may add or replace members`);
            continue;
        }
        if (capability.support === 'unsupported') {
            collector.features.push({ index, capability: capability.matcherId, label: capability.export ?? '', source,
                status: 'boundary', reason: capability.note });
            collector.gaps.push(`unsupported feature ${capability.matcherId} at ${source}`);
            continue;
        }
        const push = (status = 'resolved', reason = null) => {
            collector.features.push({ index, capability: capability.matcherId, label: capability.export ?? '', source,
                status, reason });
        };
        switch (capability.matcherId) {
            case 'signals/signalStoreFeature': {
                push();
                if (depth >= 16) {
                    collector.gaps.push(`feature composition depth limit at ${source}`);
                    break;
                }
                collectFeatures(context, call.arguments, collector, depth + 1);
                break;
            }
            case 'signals/withFeature': {
                const inner = call.arguments[0] ? producedFeature(context, call.arguments[0]) : null;
                const resolved = inner && featureCall(context, inner, 0);
                if (!inner || !resolved || !matchedCapability(context, resolved)) {
                    push('boundary', 'withFeature factory result is not a statically identified feature');
                    collector.gaps.push(`withFeature at ${source} may add or replace members`);
                    break;
                }
                push();
                if (depth >= 16) {
                    collector.gaps.push(`feature composition depth limit at ${source}`);
                    break;
                }
                collectFeatures(context, [inner], collector, depth + 1);
                break;
            }
            case 'signals/withState': {
                push();
                const keys = memberNames(context, producedObject(context, call.arguments[0]), collector.gaps, 'withState');
                collector.stateKeys.push(...keys);
                addMembers(collector, keys, 'state', index, capability.matcherId, source);
                break;
            }
            case 'signals/withLinkedState': {
                push();
                const object = producedObject(context, call.arguments[0]);
                const keys = memberNames(context, object, collector.gaps, 'withLinkedState');
                collector.stateKeys.push(...keys);
                addMembers(collector, keys, 'linked-state', index, capability.matcherId, source, derivedDependencies(context, call.arguments[0], object));
                break;
            }
            case 'signals/withComputed': {
                push();
                const object = producedObject(context, call.arguments[0]);
                addMembers(collector, memberNames(context, object, collector.gaps, 'withComputed'), 'computed', index, capability.matcherId, source, derivedDependencies(context, call.arguments[0], object));
                break;
            }
            case 'signals/withProps':
                push();
                addMembers(collector, memberNames(context, producedObject(context, call.arguments[0]), collector.gaps, 'withProps'), 'prop', index, capability.matcherId, source);
                break;
            case 'signals/withMethods':
                push();
                addMembers(collector, memberNames(context, producedObject(context, call.arguments[0]), collector.gaps, 'withMethods'), 'method', index, capability.matcherId, source);
                break;
            case 'signals/withHooks': {
                push();
                const object = producedObject(context, call.arguments[0]);
                for (const name of ['onInit', 'onDestroy']) {
                    const property = object?.properties.find(item => item.name && t.isIdentifier(item.name) &&
                        item.name.text === name);
                    if (property)
                        collector.hooks.push({ kind: name, source: location(context, property), featureIndex: index });
                }
                if (!object)
                    collector.gaps.push(`withHooks at ${source} has no statically readable hook object`);
                break;
            }
            case 'signals-events/withReducer':
            case 'signals-events/withEventHandlers': {
                push();
                addMembers(collector, capability.matcherId === 'signals-events/withEventHandlers'
                    ? memberNames(context, producedObject(context, call.arguments[0]), collector.gaps, 'withEventHandlers')
                    : [], 'handler', index, capability.matcherId, source);
                break;
            }
            default:
                push('boundary', `${capability.matcherId} is registered but has no feature expansion`);
                collector.gaps.push(`feature ${capability.matcherId} at ${source} is not expanded into members`);
        }
    }
}
/** `withFeature(store => someFeature(...))` hides the feature behind a factory over the Store built so far. */
function producedFeature(context, expression) {
    const t = context.toolchain.typescript;
    const node = definition(context, expression);
    if (!t.isArrowFunction(node) && !t.isFunctionExpression(node))
        return node;
    if (!t.isBlock(node.body))
        return unwrap(t, node.body);
    return node.body.statements.find(t.isReturnStatement)?.expression ?? null;
}
function storeId(context, node, name) {
    return `${slash(node.getSourceFile().fileName)}:${node.getStart()}:${name}@${context.id}`;
}
function build(context, call, anchor, name, kind) {
    const collector = { features: [], members: [], stateKeys: [], hooks: [], gaps: [] };
    collectFeatures(context, call.arguments, collector, 0);
    const partial = collector.features.some(item => item.status === 'boundary');
    return { id: storeId(context, anchor, name), name, kind, source: location(context, call),
        features: collector.features, members: collector.members, stateKeys: [...new Set(collector.stateKeys)],
        hooks: collector.hooks, status: partial ? 'partial' : 'resolved', gaps: collector.gaps };
}
/** Finds generated Store classes, then the sites that actually construct them. */
export function catalogSignalStores(context) {
    const t = context.toolchain.typescript;
    const declarations = new Map();
    const byNode = new Map();
    const diagnostics = [];
    const isSignalStore = (expression) => {
        const node = definition(context, expression);
        if (!t.isCallExpression(node))
            return null;
        return matchedCapability(context, node)?.matcherId === 'signals/signalStore' ? node : null;
    };
    for (const fileName of context.sourceFiles) {
        const file = context.program.getSourceFile(fileName);
        if (!file)
            continue;
        const visit = (node) => {
            if (t.isVariableDeclaration(node) && node.initializer && t.isIdentifier(node.name)) {
                const call = isSignalStore(node.initializer);
                if (call) {
                    const record = build(context, call, node.name, node.name.text, 'variable');
                    declarations.set(record.id, record);
                    byNode.set(node, record.id);
                }
            }
            if (t.isClassDeclaration(node) && node.name) {
                for (const clause of node.heritageClauses ?? []) {
                    if (clause.token !== t.SyntaxKind.ExtendsKeyword)
                        continue;
                    for (const type of clause.types) {
                        const call = isSignalStore(type.expression);
                        if (!call)
                            continue;
                        const record = build(context, call, node.name, node.name.text, 'class-extends');
                        declarations.set(record.id, record);
                        byNode.set(node, record.id);
                    }
                }
            }
            t.forEachChild(node, visit);
        };
        visit(file);
    }
    const declarationFor = (expression) => {
        const t2 = context.toolchain.typescript;
        const node = unwrap(t2, expression);
        const target = t2.isPropertyAccessExpression(node) ? node.name : node;
        const declaration = symbolOf(context, target)?.valueDeclaration;
        return declaration ? byNode.get(declaration) ?? null : null;
    };
    const instances = [];
    const ownerOf = (node) => {
        let cursor = node;
        while (cursor) {
            if (t.isClassDeclaration(cursor) && cursor.name)
                return `${slash(cursor.getSourceFile().fileName)}#${cursor.name.text}`;
            cursor = cursor.parent;
        }
        return null;
    };
    const providerTargets = new Set();
    for (const fileName of context.sourceFiles) {
        const file = context.program.getSourceFile(fileName);
        if (!file)
            continue;
        const visit = (node) => {
            if (t.isCallExpression(node)) {
                const callee = calleeOf(context, node);
                const symbol = symbolOf(context, callee);
                if (symbol?.getName() === 'inject' && symbol.declarations?.some(part => slash(part.getSourceFile().fileName).includes('/node_modules/@angular/core/'))) {
                    const token = node.arguments[0];
                    const declarationId = token && declarationFor(token);
                    if (declarationId)
                        instances.push({ id: location(context, node), declarationId, kind: 'inject',
                            owner: ownerOf(node), source: location(context, node), created: true,
                            conditions: ['the injector that provides this Store must be active'] });
                }
            }
            if (t.isNewExpression(node)) {
                const declarationId = declarationFor(node.expression);
                if (declarationId)
                    instances.push({ id: location(context, node), declarationId, kind: 'new',
                        owner: ownerOf(node), source: location(context, node), created: true, conditions: [] });
            }
            if (t.isPropertyAssignment(node) && t.isIdentifier(node.name) &&
                ['providers', 'viewProviders'].includes(node.name.text)) {
                const list = unwrap(t, node.initializer);
                if (t.isArrayLiteralExpression(list))
                    for (const element of list.elements) {
                        const target = t.isObjectLiteralExpression(element)
                            ? getProperty(t, element, 'useClass') ?? getProperty(t, element, 'provide') : element;
                        const declarationId = target && declarationFor(target);
                        if (!declarationId)
                            continue;
                        providerTargets.add(declarationId);
                        instances.push({ id: location(context, element), declarationId, kind: 'provider', owner: ownerOf(node),
                            source: location(context, element), created: false,
                            conditions: ['a provider registers the Store; inject or new must run before it exists'] });
                    }
            }
            t.forEachChild(node, visit);
        };
        visit(file);
    }
    for (const declarationId of providerTargets)
        if (!instances.some(item => item.declarationId === declarationId && item.created))
            diagnostics.push(`Store ${declarations.get(declarationId)?.name ?? declarationId} is provided but no inject or new was found`);
    for (const record of declarations.values())
        if (record.status === 'partial')
            diagnostics.push(`Store ${record.name} has ${record.gaps.length} unresolved feature range(s)`);
    return { declarations, instances, diagnostics };
}
/** Maps a destructured signal or a captured Store name back to the instance or Store it came from. */
export function resolveStoreReference(context, catalog, node) {
    const t = context.toolchain.typescript;
    const declaration = symbolOf(context, node)?.valueDeclaration;
    if (!declaration)
        return null;
    const fromExpression = (expression, member) => {
        const instance = catalog.instances.find(item => item.source === location(context, expression));
        if (instance)
            return { kind: 'instance', declarationId: instance.declarationId, instanceId: instance.id,
                member, source: location(context, expression) };
        if (t.isIdentifier(expression) || t.isPropertyAccessExpression(expression)) {
            const target = symbolOf(context, t.isPropertyAccessExpression(expression) ? expression.name : expression);
            const next = target?.valueDeclaration;
            if (next && next !== declaration)
                return resolveMember(next, member);
        }
        return null;
    };
    const resolveMember = (target, member) => {
        if ((t.isVariableDeclaration(target) || t.isPropertyDeclaration(target)) && target.initializer)
            return fromExpression(target.initializer, member);
        if (t.isBindingElement(target)) {
            const name = target.propertyName ?? target.name;
            const field = t.isIdentifier(name) || t.isStringLiteralLike(name) ? name.text : null;
            const parent = target.parent.parent;
            if (t.isVariableDeclaration(parent) && parent.initializer)
                return fromExpression(parent.initializer, field ?? member);
            if (t.isParameter(parent))
                return fromParameter(parent, field ?? member);
        }
        if (t.isParameter(target))
            return fromParameter(target, member);
        return null;
    };
    /** The first parameter of a feature factory is the Store under construction, not a separate value. */
    const fromParameter = (parameter, member) => {
        const owner = parameter.parent;
        if (!t.isArrowFunction(owner) && !t.isFunctionExpression(owner))
            return null;
        if (owner.parameters[0] !== parameter)
            return null;
        let cursor = owner.parent;
        while (cursor && !t.isCallExpression(cursor))
            cursor = cursor.parent;
        if (!cursor || !t.isCallExpression(cursor))
            return null;
        const featureSource = location(context, cursor);
        for (const record of catalog.declarations.values())
            if (record.features.some(item => item.source === featureSource))
                return { kind: 'construction-context', declarationId: record.id, instanceId: null, member,
                    source: featureSource };
        return null;
    };
    return resolveMember(declaration, null);
}
/** onInit is a start condition and onDestroy an end condition; neither is a result of a UI operation. */
export function storeLifetime(catalog, declarationId, instanceId = null) {
    const record = catalog.declarations.get(declarationId);
    const instances = catalog.instances.filter(item => item.declarationId === declarationId &&
        (!instanceId || item.id === instanceId));
    const created = instances.some(item => item.created);
    return { declarationId, instanceId, created,
        start: (record?.hooks ?? []).filter(item => item.kind === 'onInit').map(item => `onInit at ${item.source}`),
        end: (record?.hooks ?? []).filter(item => item.kind === 'onDestroy').map(item => `onDestroy at ${item.source}`),
        conditions: [...new Set([...instances.flatMap(item => item.conditions),
                ...(created ? [] : ['no confirmed inject or new for this Store in the selected injector'])])] };
}
