import { getProperty, unwrap } from '../../index/catalog.js';
import { location } from '../../resolve/operation/reactive.js';
import { matchIdentifier, matchMember } from './capabilities.js';
const slash = (value) => value.replaceAll('\\', '/');
function symbolOf(context, node) {
    const t = context.toolchain.typescript;
    let found = context.checker.getSymbolAtLocation(node);
    if (found && found.flags & t.SymbolFlags.Alias)
        found = context.checker.getAliasedSymbol(found);
    return found;
}
function definition(context, expression) {
    const t = context.toolchain.typescript;
    let node = unwrap(t, expression);
    const visited = new Set();
    while ((t.isIdentifier(node) || t.isPropertyAccessExpression(node)) && !visited.has(node)) {
        visited.add(node);
        const declaration = symbolOf(context, t.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
        const initializer = declaration && (t.isVariableDeclaration(declaration) || t.isPropertyDeclaration(declaration))
            ? declaration.initializer : undefined;
        if (!initializer)
            break;
        node = unwrap(t, initializer);
    }
    return node;
}
function calleeOf(context, call) {
    const t = context.toolchain.typescript;
    return t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
}
function matcherOf(context, call) {
    return matchIdentifier(context, calleeOf(context, call))?.capability.matcherId ?? null;
}
function declarationId(context, node) {
    const target = context.toolchain.typescript.isPropertyAccessExpression(node) ? node.name : node;
    const symbol = symbolOf(context, target);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration ? `${slash(declaration.getSourceFile().fileName)}:${declaration.getStart()}:${symbol?.getName() ?? node.getText()}`
        : `unresolved:${node.getText()}`;
}
function stringOf(context, expression) {
    if (!expression)
        return null;
    const node = definition(context, expression);
    return context.toolchain.typescript.isStringLiteralLike(node) ? node.text : null;
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
function scopeOf(context, config) {
    const t = context.toolchain.typescript;
    if (!config)
        return 'self';
    const node = definition(context, config);
    const value = t.isObjectLiteralExpression(node) ? stringOf(context, getProperty(t, node, 'scope')) :
        t.isStringLiteralLike(node) ? node.text :
            t.isCallExpression(node) && matcherOf(context, node) === 'signals-events/toScope'
                ? stringOf(context, node.arguments[0]) : null;
    return value === 'parent' || value === 'global' || value === 'self' ? value : 'self';
}
function walk(context, node, visit) {
    const t = context.toolchain.typescript;
    const step = (child) => { visit(child); t.forEachChild(child, step); };
    step(node);
}
/** `injectDispatch(group)` and `injectDispatch(group)({scope})` both name events from the same group. */
function injectDispatchTarget(context, receiver) {
    const t = context.toolchain.typescript;
    const node = definition(context, receiver);
    if (!t.isCallExpression(node))
        return null;
    if (matcherOf(context, node) === 'signals-events/injectDispatch' && node.arguments[0])
        return { group: node.arguments[0], scope: 'self' };
    const inner = injectDispatchTarget(context, node.expression);
    return inner ? { group: inner.group, scope: scopeOf(context, node.arguments[0]) } : null;
}
function groupMembers(context, group) {
    const t = context.toolchain.typescript;
    const result = new Map();
    const node = definition(context, group);
    if (!t.isCallExpression(node) || matcherOf(context, node) !== 'signals-events/eventGroup')
        return result;
    const config = node.arguments[0] && definition(context, node.arguments[0]);
    if (!config || !t.isObjectLiteralExpression(config))
        return result;
    const source = stringOf(context, getProperty(t, config, 'source'));
    const events = getProperty(t, config, 'events');
    const list = events && definition(context, events);
    if (!list || !t.isObjectLiteralExpression(list))
        return result;
    const groupId = declarationId(context, group);
    for (const property of list.properties) {
        const name = property.name;
        if (!name || (!t.isIdentifier(name) && !t.isStringLiteralLike(name)))
            continue;
        result.set(name.text, { id: `${groupId}#${name.text}`, name: name.text, groupId,
            type: source ? `[${source}] ${name.text}` : null, source: location(context, property) });
    }
    return result;
}
/** Reads the event instances a handler pipeline produces, so a void side effect is not read as redelivery.
 *  A handler that returns the event it received re-sends that same event. */
function emittedEvents(context, pipeline, creators, received = [], subscriptionSource = null) {
    const t = context.toolchain.typescript;
    const projections = new Set(['map', 'mergeMap', 'switchMap', 'concatMap', 'exhaustMap', 'tapResponse', 'mapResponse']);
    const result = [];
    let mapped = null;
    const passThrough = (at, scope) => {
        for (const creator of received)
            result.push({ creatorId: creator?.id ?? null, creatorType: creator?.type ?? null, scope,
                source: location(context, at) });
    };
    const fromValue = (value, scope) => {
        const node = definition(context, value);
        if (t.isArrayLiteralExpression(node)) {
            const configured = node.elements.find(element => {
                const inner = definition(context, element);
                return t.isCallExpression(inner) && matcherOf(context, inner) === 'signals-events/toScope';
            });
            const nextScope = configured ? scopeOf(context, configured) : scope;
            for (const element of node.elements) {
                const inner = definition(context, element);
                if (t.isCallExpression(inner) && matcherOf(context, inner) === 'signals-events/toScope')
                    continue;
                fromValue(element, nextScope);
            }
            return;
        }
        if (t.isConditionalExpression(node)) {
            fromValue(node.whenTrue, scope);
            fromValue(node.whenFalse, scope);
            return;
        }
        if (!t.isCallExpression(node))
            return;
        const id = declarationId(context, node.expression);
        const creator = creators.get(id);
        if (creator) {
            result.push({ creatorId: creator.id, creatorType: creator.type, scope,
                source: location(context, node) });
            return;
        }
        const group = t.isPropertyAccessExpression(node.expression)
            ? groupMembers(context, node.expression.expression).get(node.expression.name.text) : undefined;
        if (group)
            result.push({ creatorId: group.id, creatorType: group.type, scope, source: location(context, node) });
    };
    walk(context, pipeline, child => {
        if (!t.isCallExpression(child))
            return;
        if (matcherOf(context, child) === 'signals-events/mapToScope')
            mapped = scopeOf(context, child.arguments[0]);
    });
    walk(context, pipeline, child => {
        if (!t.isCallExpression(child) || matcherOf(context, child) !== 'signals-events/mapToScope')
            return;
        passThrough(child, scopeOf(context, child.arguments[0]));
    });
    walk(context, pipeline, child => {
        if (!t.isCallExpression(child))
            return;
        const name = calleeOf(context, child).getText();
        if (!projections.has(name))
            return;
        for (const argument of child.arguments) {
            const callback = definition(context, argument);
            if (t.isObjectLiteralExpression(callback)) {
                for (const property of callback.properties)
                    if (t.isPropertyAssignment(property))
                        fromValue(property.initializer, mapped ?? 'self');
                continue;
            }
            if (!t.isArrowFunction(callback) && !t.isFunctionExpression(callback))
                continue;
            const parameter = callback.parameters[0]?.name;
            const isReceived = (value) => t.isIdentifier(value) && !!parameter &&
                t.isIdentifier(parameter) && value.text === parameter.text;
            const produced = t.isBlock(callback.body)
                ? callback.body.statements.filter(t.isReturnStatement).flatMap(item => item.expression ? [item.expression] : [])
                : [callback.body];
            for (const value of produced) {
                if (isReceived(unwrap(t, value)))
                    passThrough(value, mapped ?? 'self');
                else
                    fromValue(value, mapped ?? 'self');
            }
        }
    });
    // An `Events.on(...)` with no operators emits the received events, and those are dispatched again.
    if (pipeline === subscriptionSource && received.length)
        passThrough(pipeline, mapped ?? 'self');
    return result;
}
/** Catalogues the SignalStore event bus: creators, send sites, consumers, and explicit bridges. */
export function analyzeEvents(context, stores) {
    const t = context.toolchain.typescript;
    const creators = new Map();
    const dispatches = [];
    const consumers = [];
    const bridges = [];
    const crossBus = [];
    const dispatcherOwners = new Set();
    const diagnostics = [];
    const files = context.sourceFiles.map(name => context.program.getSourceFile(name))
        .filter((file) => !!file);
    for (const file of files)
        walk(context, file, node => {
            if (!t.isVariableDeclaration(node) || !node.initializer || !t.isIdentifier(node.name))
                return;
            const call = definition(context, node.initializer);
            if (!t.isCallExpression(call))
                return;
            if (matcherOf(context, call) === 'signals-events/event') {
                const id = declarationId(context, node.name);
                creators.set(id, { id, name: node.name.text, groupId: null,
                    type: stringOf(context, call.arguments[0]), source: location(context, node) });
            }
            if (matcherOf(context, call) === 'signals-events/eventGroup')
                for (const member of groupMembers(context, node.name).values())
                    creators.set(member.id, member);
        });
    const creatorFor = (expression) => {
        const node = definition(context, expression);
        if (!t.isCallExpression(node))
            return null;
        const direct = creators.get(declarationId(context, node.expression));
        if (direct)
            return direct;
        if (!t.isPropertyAccessExpression(node.expression))
            return null;
        return groupMembers(context, node.expression.expression).get(node.expression.name.text) ?? null;
    };
    const storeFeatureSources = new Map();
    for (const record of stores.declarations.values())
        for (const feature of record.features)
            storeFeatureSources.set(feature.source, record.id);
    const enclosingStore = (node) => {
        let cursor = node;
        while (cursor) {
            if (t.isCallExpression(cursor)) {
                const found = storeFeatureSources.get(location(context, cursor));
                if (found)
                    return found;
            }
            cursor = cursor.parent;
        }
        return null;
    };
    for (const file of files)
        walk(context, file, node => {
            if (t.isCallExpression(node) && matcherOf(context, node) === 'signals-events/provideDispatcher') {
                const owner = ownerOf(context, node);
                if (owner)
                    dispatcherOwners.add(owner);
                else
                    diagnostics.push(`provideDispatcher at ${location(context, node)} has no resolved owning class`);
            }
            if (!t.isCallExpression(node) || !t.isPropertyAccessExpression(node.expression))
                return;
            const receiver = node.expression.expression;
            const member = node.expression.name.text;
            const direct = matchMember(context, receiver, member);
            if (direct?.capability.matcherId === 'signals-events/Dispatcher.dispatch') {
                const creator = node.arguments[0] ? creatorFor(node.arguments[0]) : null;
                dispatches.push({ id: location(context, node), creatorId: creator?.id ?? null,
                    creatorType: creator?.type ?? null, bus: 'signal-store-event', form: 'direct-event',
                    scope: scopeOf(context, node.arguments[1]), owner: ownerOf(context, node),
                    source: location(context, node), conditions: ['the dispatching injector must be active'],
                    status: creator ? 'resolved' : 'boundary',
                    reason: creator ? null : 'dispatch argument is not a statically identified event creator' });
                return;
            }
            const named = injectDispatchTarget(context, receiver);
            if (!named)
                return;
            const creator = groupMembers(context, named.group).get(member);
            dispatches.push({ id: location(context, node), creatorId: creator?.id ?? null,
                creatorType: creator?.type ?? null, bus: 'signal-store-event', form: 'named-event',
                scope: named.scope, owner: ownerOf(context, node), source: location(context, node),
                conditions: ['the dispatching injector must be active'], status: creator ? 'resolved' : 'boundary',
                reason: creator ? null : `event group has no member ${member}` });
        });
    for (const file of files)
        walk(context, file, node => {
            if (!t.isCallExpression(node))
                return;
            const matcher = matcherOf(context, node);
            if (matcher === 'signals-events/withReducer') {
                const storeId = enclosingStore(node) ?? storeFeatureSources.get(location(context, node)) ?? null;
                for (const argument of node.arguments) {
                    const caseReducer = definition(context, argument);
                    if (!t.isCallExpression(caseReducer) || matcherOf(context, caseReducer) !== 'signals-events/on') {
                        consumers.push({ id: location(context, argument), kind: 'reducer', creatorIds: [], creatorTypes: [],
                            bus: 'signal-store-event', owner: ownerOf(context, node), storeId, writes: [],
                            source: location(context, argument), conditions: [], redelivers: [],
                            gaps: ['case reducer is not a statically identified on(...) call'] });
                        continue;
                    }
                    const handled = caseReducer.arguments.slice(0, -1).map(item => creatorFor(item) ??
                        creators.get(declarationId(context, item)) ??
                        (t.isPropertyAccessExpression(item) ? groupMembers(context, item.expression).get(item.name.text) : null) ?? null);
                    const writes = [];
                    const reducer = caseReducer.arguments.at(-1);
                    const produced = reducer && (t.isArrowFunction(reducer) || t.isFunctionExpression(reducer))
                        ? (t.isBlock(reducer.body) ? reducer.body.statements.filter(t.isReturnStatement)
                            .flatMap(item => item.expression ? [unwrap(t, item.expression)] : []) : [unwrap(t, reducer.body)]) : [];
                    const gaps = [];
                    for (const value of produced) {
                        if (t.isObjectLiteralExpression(value)) {
                            for (const property of value.properties) {
                                const name = property.name;
                                if (name && (t.isIdentifier(name) || t.isStringLiteralLike(name)))
                                    writes.push(name.text);
                                else
                                    gaps.push('reducer result has a member name that is not statically readable');
                            }
                        }
                        else
                            gaps.push('reducer result is a partial state updater whose written keys are not statically readable');
                    }
                    consumers.push({ id: location(context, caseReducer), kind: 'reducer',
                        creatorIds: handled.flatMap(item => item ? [item.id] : []),
                        creatorTypes: handled.flatMap(item => item?.type ? [item.type] : []),
                        bus: 'signal-store-event', owner: ownerOf(context, node), storeId, writes: [...new Set(writes)],
                        source: location(context, caseReducer),
                        conditions: ['the Store instance must exist', 'ReducerEvents receives the event before Events handlers'],
                        redelivers: [], gaps: [...gaps, ...handled.some(item => !item) ? ['an event argument is unresolved'] : []] });
                }
                return;
            }
            if (matcher === 'signals-events/withEventHandlers') {
                const storeId = enclosingStore(node) ?? storeFeatureSources.get(location(context, node)) ?? null;
                collectSubscriptions(node, 'handler', storeId, ['handlers are subscribed when the Store is created',
                    'the Store instance must still be alive']);
                return;
            }
            if (!t.isPropertyAccessExpression(node.expression))
                return;
            const on = matchMember(context, node.expression.expression, node.expression.name.text);
            if (on?.capability.matcherId !== 'signals-events/Events.on' &&
                on?.capability.matcherId !== 'signals-events/ReducerEvents.on')
                return;
            if (enclosingStore(node))
                return;
            collectOne(node, 'subscription', null, ['the subscription must be registered and still alive']);
        });
    function collectSubscriptions(feature, kind, storeId, conditions) {
        walk(context, feature, child => {
            if (!t.isCallExpression(child) || !t.isPropertyAccessExpression(child.expression))
                return;
            const on = matchMember(context, child.expression.expression, child.expression.name.text);
            if (on?.capability.matcherId !== 'signals-events/Events.on' &&
                on?.capability.matcherId !== 'signals-events/ReducerEvents.on')
                return;
            collectOne(child, kind, storeId, conditions);
        });
    }
    function collectOne(call, kind, storeId, conditions) {
        const handled = call.arguments.map(item => creatorFor(item) ?? creators.get(declarationId(context, item)) ??
            (t.isPropertyAccessExpression(item) ? groupMembers(context, item.expression).get(item.name.text) : null) ?? null);
        let pipeline = call;
        let cursor = call.parent;
        while (cursor && t.isPropertyAccessExpression(cursor) && cursor.parent && t.isCallExpression(cursor.parent)) {
            pipeline = cursor.parent;
            cursor = cursor.parent.parent;
        }
        const redelivers = kind === 'subscription' ? [] : emittedEvents(context, pipeline, creators, handled, call);
        const consumer = { id: location(context, call), kind,
            creatorIds: handled.flatMap(item => item ? [item.id] : []),
            creatorTypes: handled.flatMap(item => item?.type ? [item.type] : []),
            bus: 'signal-store-event', owner: ownerOf(context, call), storeId, writes: [],
            source: location(context, call), conditions, redelivers,
            gaps: [...(call.arguments.length === 0 ? ['Events.on() with no argument receives every event'] : []),
                ...(handled.some(item => !item) ? ['an event argument is unresolved'] : [])] };
        consumers.push(consumer);
        walk(context, pipeline, child => {
            if (!t.isCallExpression(child) || !t.isPropertyAccessExpression(child.expression))
                return;
            const bridged = matchMember(context, child.expression.expression, child.expression.name.text);
            if (bridged?.capability.matcherId !== 'ngrx-store/Store.dispatch' &&
                bridged?.capability.matcherId !== 'ngrx-store/Store.next')
                return;
            const argument = child.arguments[0];
            bridges.push({ id: location(context, child), fromConsumer: consumer.id, toBus: 'ngrx-action',
                target: argument ? declarationId(context, t.isCallExpression(argument) ? argument.expression : argument)
                    : 'unresolved', source: location(context, child),
                conditions: ['the handler branch containing the Store call must run'] });
        });
    }
    // A SignalStore event handed to Store.dispatch stays on the action bus; only a bridge connects the two.
    for (const file of files)
        walk(context, file, node => {
            if (!t.isCallExpression(node) || !t.isPropertyAccessExpression(node.expression))
                return;
            const member = matchMember(context, node.expression.expression, node.expression.name.text);
            if (member?.capability.matcherId !== 'ngrx-store/Store.dispatch' &&
                member?.capability.matcherId !== 'ngrx-store/Store.next')
                return;
            const argument = node.arguments[0];
            const creator = argument && creatorFor(argument);
            if (!creator)
                return;
            const place = location(context, node);
            if (bridges.some(item => item.source === place))
                return;
            crossBus.push({ creatorId: creator.id, creatorType: creator.type, owner: ownerOf(context, node), source: place,
                reason: 'sent on the NgRx action bus; no event consumer receives it without an explicit bridge' });
        });
    for (const dispatch of dispatches)
        if (dispatch.status === 'boundary' && dispatch.reason)
            diagnostics.push(`${dispatch.reason} at ${dispatch.source}`);
    for (const send of crossBus)
        diagnostics.push(`${send.creatorType ?? send.creatorId}: ${send.reason} at ${send.source}`);
    return { creators: [...creators.values()], dispatches, consumers, crossBus,
        dispatcherOwners: [...dispatcherOwners], bridges, diagnostics };
}
/** Picks the bus instance the scope names, then matches only consumers listening on that same instance. */
export function resolveEventDelivery(graph, dispatch, ancestry, consumerAncestry = () => null) {
    const providers = ancestry.filter(owner => graph.dispatcherOwners.includes(owner));
    const reasons = [];
    const unresolved = (reason) => ({ busId: 'unknown', parentBusId: 'unknown', status: 'boundary', consumers: [],
        conditions: [...dispatch.conditions], reasons: [reason] });
    if (dispatch.scope !== 'global' && !ancestry.length)
        return unresolved(`${dispatch.scope} scope needs the injector ancestry of ${dispatch.owner ?? 'the dispatch site'}`);
    // `parent` is relative to the injected dispatcher, which is providers[0] or the root one.
    if (dispatch.scope === 'parent' && !providers.length)
        return unresolved('parent scope was requested where the injected dispatcher is already the root one');
    const busId = dispatch.scope === 'global' ? 'root' :
        dispatch.scope === 'self' ? providers[0] ?? 'root' : providers[1] ?? 'root';
    const activeProviderIndex = dispatch.scope === 'self' ? 0 : dispatch.scope === 'parent' ? 1 : providers.length;
    const busOf = (consumer) => {
        const owners = consumerAncestry(consumer);
        if (!owners)
            return null;
        return owners.filter(owner => graph.dispatcherOwners.includes(owner))[0] ?? 'root';
    };
    const matched = [];
    for (const consumer of graph.consumers) {
        if (consumer.bus !== dispatch.bus)
            continue;
        const receivesAll = !consumer.creatorIds.length &&
            consumer.gaps.some(gap => gap.includes('no argument receives every event'));
        const listens = receivesAll || (dispatch.creatorId ? consumer.creatorIds.includes(dispatch.creatorId) :
            !!dispatch.creatorType && consumer.creatorTypes.includes(dispatch.creatorType));
        if (!listens)
            continue;
        const consumerBus = busOf(consumer);
        if (consumerBus === null) {
            reasons.push(`consumer ${consumer.id} has no resolved bus instance`);
            continue;
        }
        if (consumerBus !== busId)
            continue;
        matched.push(consumer);
    }
    if (!matched.length)
        reasons.push('dispatched; no matching consumer was found on this bus');
    return { busId, parentBusId: providers[activeProviderIndex + 1] ?? 'root',
        status: reasons.length ? 'boundary' : 'resolved', consumers: matched,
        conditions: [...dispatch.conditions,
            ...(dispatch.scope === 'self' ? ['the local dispatcher scope must be the one that was provided'] : [])],
        reasons };
}
export function busOfCapability(matcherId) {
    if (matcherId.startsWith('signals-events/'))
        return 'signal-store-event';
    if (matcherId.startsWith('ngrx-store/') || matcherId.startsWith('ngrx-effects/'))
        return 'ngrx-action';
    return null;
}
