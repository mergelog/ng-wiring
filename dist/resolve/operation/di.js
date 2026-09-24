import { getProperty, unwrap } from '../../index/catalog.js';
import { StaticEvaluator } from '../../workspace/evaluate.js';
import { location } from './reactive.js';
const slash = (s) => s.replaceAll('\\', '/');
function symbolOf(context, node) {
    const t = context.toolchain.typescript;
    let symbol = context.checker.getSymbolAtLocation(node);
    if (symbol && (symbol.flags & t.SymbolFlags.Alias))
        symbol = context.checker.getAliasedSymbol(symbol);
    return symbol;
}
export function tokenId(context, node) {
    const t = context.toolchain.typescript;
    const target = t.isPropertyAccessExpression(node) ? node.name : node;
    const symbol = symbolOf(context, target);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!declaration)
        return `unresolved:${node.getText()}`;
    return `${slash(declaration.getSourceFile().fileName)}:${declaration.getStart()}:${symbol?.getName() ?? node.getText()}`;
}
function staticArray(context, input, seen = new Set()) {
    const t = context.toolchain.typescript;
    const node = unwrap(t, input);
    if (seen.has(node))
        return null;
    seen.add(node);
    if (t.isArrayLiteralExpression(node)) {
        const result = [];
        for (const item of node.elements) {
            const nested = t.isSpreadElement(item) ? staticArray(context, item.expression, seen) : [item];
            if (!nested)
                return null;
            result.push(...nested);
        }
        return result;
    }
    if (t.isIdentifier(node) || t.isPropertyAccessExpression(node)) {
        const declaration = symbolOf(context, t.isPropertyAccessExpression(node) ? node.name : node)?.valueDeclaration;
        if (declaration && t.isVariableDeclaration(declaration) && declaration.initializer)
            return staticArray(context, declaration.initializer, seen);
    }
    return [node];
}
function providerOf(context, expression) {
    const t = context.toolchain.typescript;
    const node = unwrap(t, expression);
    if (t.isObjectLiteralExpression(node)) {
        const token = getProperty(t, node, 'provide');
        if (!token)
            return null;
        const multi = getProperty(t, node, 'multi')?.kind === t.SyntaxKind.TrueKeyword;
        const entries = [
            ['class', getProperty(t, node, 'useClass')], ['existing', getProperty(t, node, 'useExisting')],
            ['value', getProperty(t, node, 'useValue')], ['factory', getProperty(t, node, 'useFactory')]
        ];
        const [kind, value] = entries.find(([, entry]) => entry) ?? ['implicit', undefined];
        const valueKnown = kind !== 'value' || !!value && new StaticEvaluator(t, context.checker).evaluate(value).known;
        const status = kind === 'factory' || !value || !valueKnown || tokenId(context, token).startsWith('unresolved:') ? 'boundary' : 'resolved';
        return { token: tokenId(context, token), kind, implementation: value ?
                (kind === 'value' ? value.getText() : tokenId(context, value)) : null,
            source: location(context, node), multi, status,
            reason: kind === 'factory' ? 'provider factory return value is not statically executed' :
                !valueKnown ? 'useValue expression is not statically known' :
                    !value ? 'provider implementation is not statically known' : status === 'boundary' ? 'provider token is unresolved' : null };
    }
    if (t.isCallExpression(node))
        return null;
    const token = tokenId(context, node);
    return { token, kind: 'class', implementation: token, source: location(context, node), multi: false,
        status: token.startsWith('unresolved:') ? 'boundary' : 'resolved', reason: token.startsWith('unresolved:') ? 'class provider is unresolved' : null };
}
function injectableScope(context, id) {
    const t = context.toolchain.typescript;
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (!source)
            continue;
        for (const node of source.statements) {
            if (!t.isClassDeclaration(node) || !node.name || tokenId(context, node.name) !== id)
                continue;
            for (const decorator of t.getDecorators(node) ?? []) {
                if (!t.isCallExpression(decorator.expression))
                    continue;
                const callee = decorator.expression.expression;
                const symbol = symbolOf(context, callee);
                if (symbol?.getName() !== 'Injectable' || !symbol.declarations?.some(part => slash(part.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
                    continue;
                const config = decorator.expression.arguments[0];
                if (config && t.isObjectLiteralExpression(config)) {
                    const value = getProperty(t, config, 'providedIn');
                    if (value && t.isStringLiteralLike(value))
                        return value.text;
                }
            }
        }
    }
    return null;
}
/** Layers are ordered from the injection site outward. An explicit template injector is inserted at the site. */
export function resolveInjection(context, request, layers) {
    const token = tokenId(context, request.token);
    const searched = [];
    const reasons = [];
    const ordered = [...(request.templateInjector ? [request.templateInjector] : []), ...layers]
        .filter(layer => !request.projected || layer.visibleToContent !== false);
    const group = (layer) => ['view', 'component'].includes(layer.kind)
        ? layer.id.replace(/:(view|component)$/, '') : layer.id;
    const siteGroup = ordered[0] ? group(ordered[0]) : '';
    const applicable = request.skipSelf ? ordered.filter(layer => group(layer) !== siteGroup) : ordered;
    const collected = [];
    let found = false;
    for (const layer of applicable) {
        if (request.self && group(layer) !== siteGroup)
            break;
        searched.push(layer.id);
        const layerBindings = [];
        for (const expression of layer.providers) {
            const items = staticArray(context, expression);
            if (!items) {
                reasons.push(`provider list in ${layer.id} cannot be statically expanded`);
                continue;
            }
            for (const item of items) {
                const provider = providerOf(context, item);
                if (!provider || provider.token !== token)
                    continue;
                found = true;
                if (provider.multi)
                    layerBindings.push(provider);
                else {
                    layerBindings.length = 0;
                    layerBindings.push(provider);
                }
            }
        }
        if (layerBindings.some(item => !item.multi)) {
            if (collected.some(item => item.multi))
                reasons.push('mixed multi and single providers across injector layers');
            collected.length = 0;
            collected.push(...layerBindings);
            break;
        }
        collected.push(...layerBindings);
        if (request.host && layer.host)
            break;
    }
    if (!found && !request.self && !request.host) {
        const declaration = symbolOf(context, request.token)?.valueDeclaration;
        const providedIn = declaration && context.toolchain.typescript.isClassDeclaration(declaration)
            ? injectableScope(context, token) : null;
        if (providedIn && ['root', 'platform', 'any'].includes(providedIn)) {
            collected.push({ token, kind: 'implicit', implementation: token, source: location(context, declaration ?? request.token),
                multi: false, status: providedIn === 'root' ? 'resolved' : 'boundary',
                reason: providedIn === 'root' ? null : `providedIn ${providedIn} has context-dependent lifetime` });
            found = true;
        }
    }
    if (collected.some(item => item.multi) && collected.some(item => !item.multi))
        reasons.push('mixed multi and single providers');
    if (!found && !request.optional)
        reasons.push(`no provider for ${token}`);
    if (!found && request.optional)
        reasons.push('optional injection may return null');
    for (const item of collected)
        if (item.reason)
            reasons.push(item.reason);
    for (const item of collected)
        if (item.kind === 'existing' && item.implementation) {
            const alias = item.implementation;
            const seen = new Set([token]);
            let cursor = alias;
            for (let depth = 0; depth < 64; depth++) {
                if (seen.has(cursor)) {
                    item.status = 'boundary';
                    item.reason = 'useExisting provider cycle';
                    break;
                }
                seen.add(cursor);
                let target;
                for (const layer of applicable) {
                    const candidates = layer.providers.flatMap(expression => staticArray(context, expression) ?? [])
                        .map(expression => providerOf(context, expression)).filter((value) => !!value);
                    target = candidates.filter(value => value.token === cursor).at(-1);
                    if (target)
                        break;
                }
                if (!target && injectableScope(context, cursor) === 'root') {
                    item.implementation = cursor;
                    item.status = 'resolved';
                    item.reason = null;
                    break;
                }
                if (!target) {
                    item.status = 'boundary';
                    item.reason = 'useExisting target has no provider in the selected injector';
                    break;
                }
                if (target.kind !== 'existing') {
                    item.implementation = target.implementation;
                    item.status = target.status;
                    item.reason = target.reason;
                    break;
                }
                if (!target.implementation) {
                    item.status = 'boundary';
                    item.reason = 'useExisting target is unresolved';
                    break;
                }
                cursor = target.implementation;
                if (depth === 63) {
                    item.status = 'boundary';
                    item.reason = 'useExisting chain depth limit';
                }
            }
            if (item.reason)
                reasons.push(item.reason);
        }
    return { token, bindings: collected, status: !found ? (request.optional ? 'resolved' : 'missing') :
            reasons.length ? 'boundary' : 'resolved', reasons, searched };
}
/** A view placement may change display ancestry without changing the injector owner. */
export function resolveInjectionAtViewStep(context, request, layers, step) {
    const token = tokenId(context, request.token);
    const ownerFound = layers.some(layer => layer.id === `${step.diOwnerId}:component` ||
        layer.id === `${step.diOwnerId}:view`);
    if (!ownerFound)
        return { token, bindings: [], status: 'boundary', searched: [],
            reasons: [`DI owner ${step.diOwnerId} is absent from the selected injector path`] };
    if (step.diContextOverride && !request.templateInjector)
        return { token, bindings: [], status: 'boundary',
            searched: [], reasons: [`TemplateRef injector override ${step.diContextOverride} is not resolved`] };
    return resolveInjection(context, request, layers);
}
/** Reads the public Angular inject options or constructor parameter decorators. */
export function injectionRequestFor(context, node) {
    const t = context.toolchain.typescript;
    if (t.isCallExpression(node)) {
        const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
        const symbol = symbolOf(context, callee);
        if (symbol?.getName() !== 'inject' || !symbol.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
            return null;
        const token = node.arguments[0];
        if (!token)
            return null;
        const options = node.arguments[1];
        const flag = (name) => !!options && t.isObjectLiteralExpression(options) &&
            getProperty(t, options, name)?.kind === t.SyntaxKind.TrueKeyword;
        return { token, optional: flag('optional'), self: flag('self'), skipSelf: flag('skipSelf'), host: flag('host') };
    }
    let token;
    const flags = { optional: false, self: false, skipSelf: false, host: false };
    for (const decorator of t.getDecorators(node) ?? []) {
        const call = decorator.expression;
        const name = t.isCallExpression(call) ? call.expression : call;
        const symbol = symbolOf(context, name);
        if (!symbol?.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
            continue;
        if (symbol.getName() === 'Inject' && t.isCallExpression(call))
            token = call.arguments[0];
        if (symbol.getName() === 'Optional')
            flags.optional = true;
        if (symbol.getName() === 'Self')
            flags.self = true;
        if (symbol.getName() === 'SkipSelf')
            flags.skipSelf = true;
        if (symbol.getName() === 'Host')
            flags.host = true;
    }
    if (!token && node.type && t.isTypeReferenceNode(node.type))
        token = node.type.typeName;
    return token ? { token, ...flags } : null;
}
export function componentInjectorLayers(owner, parents = [], rootProviders = [], routeProviders = []) {
    const property = (declaration, name) => {
        const item = declaration.metadata.properties.find(p => p.name?.getText() === name);
        return item && 'initializer' in item && item.initializer ? [item.initializer] : [];
    };
    const components = [owner, ...parents].flatMap((item, index) => [
        { id: `${item.id}:view`, kind: 'view', providers: property(item, 'viewProviders'), visibleToContent: false },
        { id: `${item.id}:component`, kind: 'component', providers: property(item, 'providers'), host: index === 0 }
    ]);
    return [...components, { id: 'route', kind: 'route', providers: routeProviders },
        { id: 'root', kind: 'root', providers: rootProviders }];
}
