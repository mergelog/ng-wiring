import { getProperty, unwrap } from '../../index/catalog.js';
import { StaticEvaluator } from '../../workspace/evaluate.js';
import { moduleIdForFile } from '../../adapters/reactive/capabilities.js';
import { location } from './reactive.js';
const HTTP_MODULE = '@angular/common/http';
const slash = (value) => value.replaceAll('\\', '/');
const methodByMember = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
    delete: 'DELETE', head: 'HEAD', options: 'OPTIONS', jsonp: 'JSONP' };
const bodyMembers = new Set(['post', 'put', 'patch']);
/** What each operator can do to the network call count, the target, or the lifetime of the request. */
const branchEffects = {
    retry: 'retry repeats the request after an error, so the network call count is not fixed',
    retryWhen: 'the retry source decides whether the request is repeated',
    share: 'share lets one network call serve the subscribers that are already attached',
    shareReplay: 'shareReplay can serve a later subscriber from the replayed value without a new network call',
    catchError: 'the error branch replaces the failed response with another source',
    takeUntil: 'the notifier can cancel the subscription and the in-flight request',
    takeUntilDestroyed: 'destruction of the owning injector cancels the in-flight request',
    timeout: 'a timeout cancels the in-flight request',
    switchMap: 'a new outer value cancels the previous in-flight request',
    exhaustMap: 'a new outer value is ignored while a request is in flight',
    concatMap: 'requests are queued in source order',
    mergeMap: 'requests may overlap',
    first: 'the subscription completes on the first value, which unsubscribes the request',
    take: 'the subscription completes at the take limit, which unsubscribes the request',
};
export function httpBranchEffect(operator) { return branchEffects[operator] ?? null; }
/** Operators whose effect on a request is modelled; anything else stops the pipeline reading. */
const transparentOperators = new Set(['map', 'tap', 'filter', 'finalize', 'distinctUntilChanged', 'debounceTime',
    'debounce', 'withLatestFrom', 'concatLatestFrom', 'tapResponse', 'mapResponse', 'startWith', 'defaultIfEmpty']);
function symbolOf(context, node) {
    const t = context.toolchain.typescript;
    let found = context.checker.getSymbolAtLocation(node);
    if (found && found.flags & t.SymbolFlags.Alias)
        found = context.checker.getAliasedSymbol(found);
    return found;
}
function moduleOf(context, symbol) {
    for (const declaration of symbol?.declarations ?? []) {
        const module = moduleIdForFile(context, declaration.getSourceFile().fileName);
        if (module)
            return module;
    }
    return null;
}
/** Names the export only when it really comes from rxjs, so a same-named local helper never matches. */
export function rxjsExport(context, node) {
    const symbol = symbolOf(context, node);
    const module = moduleOf(context, symbol);
    return symbol && module && (module === 'rxjs' || module.startsWith('rxjs/')) ? symbol.getName() : null;
}
/** The `@angular/common/http` entry point re-exports from shared chunks of `@angular/common`; both identify it. */
function fromHttpPackage(context, symbol) {
    const module = moduleOf(context, symbol);
    return module === HTTP_MODULE || module === '@angular/common';
}
export function httpApiExport(context, node) {
    const symbol = symbolOf(context, node);
    return symbol && fromHttpPackage(context, symbol) ? symbol.getName() : null;
}
/** The receiver must be a declared `HttpClient`; a method named `get` on anything else is not a request. */
function httpClientReceiver(context, receiver) {
    const symbol = context.checker.getTypeAtLocation(receiver).getSymbol();
    return symbol?.getName() === 'HttpClient' && fromHttpPackage(context, symbol);
}
function isGlobalFetch(context, node) {
    const t = context.toolchain.typescript;
    if (t.isPropertyAccessExpression(node)) {
        const owner = node.expression;
        return node.name.text === 'fetch' && t.isIdentifier(owner) && ['window', 'globalThis', 'self'].includes(owner.text);
    }
    if (!t.isIdentifier(node) || node.text !== 'fetch')
        return false;
    const declarations = symbolOf(context, node)?.declarations ?? [];
    // A local or imported `fetch` is not the platform API and is not read as one.
    return declarations.every(declaration => declaration.getSourceFile().isDeclarationFile &&
        !context.sourceFiles.includes(declaration.getSourceFile().fileName));
}
function relativeFile(context, file) {
    const root = `${slash(context.workspaceRoot)}/`;
    const name = slash(file);
    return name.startsWith(root) ? name.slice(root.length) : name;
}
function enclosing(context, node) {
    const t = context.toolchain.typescript;
    let member = null;
    let owner = null;
    for (let cursor = node.parent; cursor; cursor = cursor.parent) {
        if (!member) {
            if (t.isMethodDeclaration(cursor) || t.isFunctionDeclaration(cursor) || t.isGetAccessorDeclaration(cursor))
                member = cursor.name?.getText() ?? null;
            else if ((t.isPropertyDeclaration(cursor) || t.isVariableDeclaration(cursor) || t.isPropertyAssignment(cursor)) &&
                cursor.name)
                member = cursor.name.getText();
        }
        if (t.isClassDeclaration(cursor) && cursor.name) {
            owner = `${relativeFile(context, cursor.getSourceFile().fileName)}#${cursor.name.text}`;
            break;
        }
    }
    return { owner, member };
}
/** Keeps the static parts of a URL even when an interpolation or a variable cannot be resolved. */
export function resolveUrl(context, expression) {
    const t = context.toolchain.typescript;
    if (!expression)
        return { status: 'unresolved', text: null, segments: [],
            reason: 'the call has no URL argument in the resolved overload' };
    const segments = [];
    const unresolved = [];
    let depth = 0;
    const literal = (text) => { if (text)
        segments.push({ kind: 'literal', text }); };
    const walk = (input) => {
        if (depth++ > 64) {
            unresolved.push('URL expression depth limit');
            return;
        }
        const node = unwrap(t, input);
        if (t.isStringLiteralLike(node)) {
            literal(node.text);
            return;
        }
        if (t.isTemplateExpression(node)) {
            literal(node.head.text);
            for (const span of node.templateSpans) {
                segments.push({ kind: 'expression', text: span.expression.getText() });
                unresolved.push(span.expression.getText());
                literal(span.literal.text);
            }
            return;
        }
        if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.PlusToken) {
            walk(node.left);
            walk(node.right);
            return;
        }
        const evaluated = new StaticEvaluator(t, context.checker).evaluate(node);
        if (evaluated.known && typeof evaluated.value === 'string') {
            literal(evaluated.value);
            return;
        }
        segments.push({ kind: 'expression', text: node.getText() });
        unresolved.push(node.getText());
    };
    walk(expression);
    const text = segments.map(part => part.kind === 'literal' ? part.text : `\${${part.text}}`).join('');
    if (!unresolved.length)
        return { status: 'static', text, segments, reason: null };
    const anyLiteral = segments.some(part => part.kind === 'literal');
    return { status: anyLiteral ? 'partial' : 'unresolved', text: anyLiteral ? text : null, segments,
        reason: `URL expression ${unresolved.map(part => JSON.stringify(part)).join(', ')} is not statically known` };
}
function declaredInWorkspace(context, declaration) {
    const file = slash(declaration.getSourceFile().fileName);
    return !file.includes('/node_modules/') && file.startsWith(`${slash(context.workspaceRoot)}/`);
}
/** Collects the named types a value actually carried, including generic arguments; imports are never listed. */
export function collectTypes(context, type, role, origin, into, depth = 0) {
    const t = context.toolchain.typescript;
    if (depth > 8)
        return;
    if (type.isUnionOrIntersection()) {
        for (const part of type.types)
            collectTypes(context, part, role, origin, into, depth + 1);
        return;
    }
    for (const symbol of [type.aliasSymbol, type.getSymbol()]) {
        const declaration = symbol?.declarations?.find(item => t.isInterfaceDeclaration(item) ||
            t.isTypeAliasDeclaration(item) || t.isClassDeclaration(item) || t.isEnumDeclaration(item));
        if (!symbol || !declaration || !declaredInWorkspace(context, declaration))
            continue;
        const id = `${relativeFile(context, declaration.getSourceFile().fileName)}#${symbol.getName()}`;
        if (!into.has(`${id}|${role}`))
            into.set(`${id}|${role}`, { id, name: symbol.getName(), role, origin, source: location(context, declaration) });
    }
    const args = [...(type.aliasTypeArguments ?? []),
        ...context.checker.getTypeArguments(type)];
    for (const argument of args)
        collectTypes(context, argument, role, origin, into, depth + 1);
}
function observeOption(context, options) {
    const t = context.toolchain.typescript;
    if (!options)
        return null;
    const node = unwrap(t, options);
    if (!t.isObjectLiteralExpression(node))
        return null;
    const value = getProperty(t, node, 'observe');
    return value && t.isStringLiteralLike(value) ? value.text : null;
}
/** Reads the operators applied to the created Observable in the same expression. */
function pipeBranches(context, call, branches, gaps) {
    const t = context.toolchain.typescript;
    let cursor = call;
    while (t.isPropertyAccessExpression(cursor.parent) && cursor.parent.expression === cursor &&
        t.isCallExpression(cursor.parent.parent) && cursor.parent.parent.expression === cursor.parent) {
        const member = cursor.parent.name.text;
        const outer = cursor.parent.parent;
        if (member !== 'pipe')
            break;
        for (const argument of outer.arguments) {
            if (!t.isCallExpression(argument)) {
                gaps.push(`pipe argument ${argument.getText()} at ${location(context, argument)} is not a statically identified operator`);
                continue;
            }
            const callee = t.isPropertyAccessExpression(argument.expression) ? argument.expression.name : argument.expression;
            const name = rxjsExport(context, callee);
            if (!name) {
                gaps.push(`operator ${callee.getText()} at ${location(context, argument)} is not a resolved rxjs export; the HTTP pipeline past it is unresolved`);
                continue;
            }
            const effect = branchEffects[name];
            if (effect)
                branches.push({ operator: name, location: location(context, argument), effect });
            else if (!transparentOperators.has(name))
                gaps.push(`operator ${name} at ${location(context, argument)} has no modelled effect on the request`);
        }
        cursor = outer;
    }
}
/** Reads one `HttpClient` member call or one `fetch` call into a request site. */
export function requestSiteAt(context, call) {
    const t = context.toolchain.typescript;
    const conditions = ['the number of network calls is not proven here; interceptors, caching, retry and sharing can change it'];
    const gaps = [];
    const types = new Map();
    const place = enclosing(context, call);
    const base = { id: location(context, call), source: location(context, call), owner: place.owner,
        member: place.member, branches: [] };
    if (rxjsExport(context, call.expression) === 'fromFetch') {
        const url = resolveUrl(context, call.arguments[0]);
        const init = call.arguments[1] ? unwrap(t, call.arguments[1]) : undefined;
        const methodValue = init && t.isObjectLiteralExpression(init) ? getProperty(t, init, 'method') : undefined;
        const literalMethod = methodValue && t.isStringLiteralLike(methodValue)
            ? methodValue.text.toUpperCase() : null;
        const known = literalMethod && Object.values(methodByMember).includes(literalMethod);
        pipeBranches(context, call, base.branches, gaps);
        return { ...base, transport: 'rxjs-fetch', method: methodValue ? (known ? literalMethod : 'unknown') : 'GET',
            methodReason: methodValue && !known ? 'the fromFetch method option is not a static method name' : null,
            url, observe: null, types: [],
            conditions: [...conditions, 'fromFetch starts the request only when its Observable is subscribed'], gaps };
    }
    if (isGlobalFetch(context, call.expression)) {
        const url = resolveUrl(context, call.arguments[0]);
        const init = call.arguments[1] ? unwrap(t, call.arguments[1]) : undefined;
        const methodValue = init && t.isObjectLiteralExpression(init) ? getProperty(t, init, 'method') : undefined;
        const literalMethod = methodValue && t.isStringLiteralLike(methodValue)
            ? methodValue.text.toUpperCase() : null;
        const known = literalMethod && Object.values(methodByMember).includes(literalMethod);
        if (call.arguments[0])
            collectTypes(context, context.checker.getTypeAtLocation(call.arguments[0]), 'url', 'inferred', types);
        if (init)
            collectTypes(context, context.checker.getTypeAtLocation(init), 'request-body', 'declared', types);
        return { ...base, transport: 'fetch', method: methodValue ? (known ? literalMethod : 'unknown') : 'GET',
            methodReason: methodValue && !known ? 'the fetch method option is not a static method name' : null,
            url, observe: null, types: [...types.values()],
            conditions: [...conditions, 'fetch starts the request when it is called; the response is only available through await or then',
                'the response body type is decided by the json/text call on the result, not by the fetch call'],
            gaps };
    }
    if (!t.isPropertyAccessExpression(call.expression) || !httpClientReceiver(context, call.expression.expression))
        return null;
    const member = call.expression.name.text;
    let method = methodByMember[member] ?? null;
    let methodReason = null;
    let urlArgument = call.arguments[0];
    let bodyArgument = bodyMembers.has(member) ? call.arguments[1] : undefined;
    let optionsArgument = call.arguments[bodyMembers.has(member) ? 2 : 1];
    if (member === 'request') {
        const first = call.arguments[0];
        // `request(method, url, options)` keeps its URL argument even when the method is dynamic.
        const positional = call.arguments.length >= 2;
        const carrier = !positional && first && t.isNewExpression(first) &&
            httpApiExport(context, first.expression) === 'HttpRequest' ? first : null;
        const methodExpression = carrier ? carrier.arguments?.[0] : first;
        const evaluated = methodExpression ? new StaticEvaluator(t, context.checker).evaluate(methodExpression)
            : { known: false, reason: 'missing method argument' };
        if (evaluated.known && typeof evaluated.value === 'string') {
            const upper = evaluated.value.toUpperCase();
            method = Object.values(methodByMember).includes(upper) ? upper : 'unknown';
            if (method === 'unknown')
                methodReason = `request method ${JSON.stringify(evaluated.value)} is not a known HTTP method`;
        }
        else {
            method = 'unknown';
            methodReason = carrier || positional ? 'the request method argument is not a static string'
                : 'the HttpRequest overload carries the method and the URL on the request object';
        }
        urlArgument = positional ? call.arguments[1] : carrier?.arguments?.[1];
        bodyArgument = carrier?.arguments?.[2];
        optionsArgument = positional ? call.arguments[2] : undefined;
    }
    if (!method)
        return null;
    const url = resolveUrl(context, urlArgument);
    const typeArgument = call.typeArguments?.[0];
    if (typeArgument)
        collectTypes(context, context.checker.getTypeFromTypeNode(typeArgument), 'response', 'type-argument', types);
    else {
        const returned = context.checker.getTypeAtLocation(call);
        collectTypes(context, returned, 'response', 'inferred', types);
    }
    if (bodyArgument)
        collectTypes(context, context.checker.getTypeAtLocation(bodyArgument), 'request-body', 'declared', types);
    if (urlArgument)
        collectTypes(context, context.checker.getTypeAtLocation(urlArgument), 'url', 'inferred', types);
    const observe = observeOption(context, optionsArgument);
    if (observe && observe !== 'body')
        conditions.push(`observe: ${JSON.stringify(observe)} delivers the ${observe === 'response' ? 'full response' : 'event stream'} instead of the body`);
    if (url.status !== 'static' && url.reason)
        conditions.push(url.reason);
    if (methodReason)
        gaps.push(`${methodReason} at ${location(context, call)}`);
    // The enclosing signature may widen the value; the request keeps the type argument written at the call.
    const holder = t.findAncestor(call, node => t.isMethodDeclaration(node) || t.isFunctionDeclaration(node) ||
        t.isArrowFunction(node) || t.isFunctionExpression(node));
    const declaredReturn = holder && 'type' in holder ? holder.type : undefined;
    if (typeArgument && declaredReturn && /\bany\b/.test(declaredReturn.getText()))
        conditions.push(`the enclosing declaration returns ${declaredReturn.getText()}; the response type is the ${member}<${typeArgument.getText()}> argument at the call`);
    pipeBranches(context, call, base.branches, gaps);
    return { ...base, transport: 'http-client', method, methodReason, url, observe, types: [...types.values()],
        conditions, gaps };
}
function interceptorsFrom(context, call, environment) {
    const t = context.toolchain.typescript;
    const list = call.arguments[0] ? unwrap(t, call.arguments[0]) : undefined;
    if (!list || !t.isArrayLiteralExpression(list)) {
        environment.gaps.push(`withInterceptors at ${location(context, call)} does not take a statically readable array`);
        return;
    }
    for (const element of list.elements) {
        const symbol = symbolOf(context, t.isPropertyAccessExpression(element) ? element.name : element);
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (!declaration) {
            environment.gaps.push(`interceptor ${element.getText()} at ${location(context, element)} is unresolved`);
            continue;
        }
        environment.interceptors.push({ id: `${relativeFile(context, declaration.getSourceFile().fileName)}#${symbol.getName()}`,
            name: symbol.getName(), kind: 'function', source: location(context, declaration) });
    }
}
/** Registration of the client and of its interceptor chain; without it the HTTP boundary stays unknown. */
export function analyzeHttpEnvironment(context) {
    const t = context.toolchain.typescript;
    const environment = { registered: false, source: null, features: [], interceptors: [],
        conditions: [], gaps: [] };
    const visit = (node) => {
        if (t.isCallExpression(node)) {
            const callee = t.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
            const api = httpApiExport(context, callee);
            if (api === 'provideHttpClient') {
                environment.registered = true;
                environment.source ??= location(context, node);
                for (const feature of node.arguments) {
                    if (!t.isCallExpression(feature)) {
                        environment.gaps.push(`provideHttpClient feature ${feature.getText()} at ${location(context, feature)} is not a statically identified call`);
                        continue;
                    }
                    const name = httpApiExport(context, t.isPropertyAccessExpression(feature.expression)
                        ? feature.expression.name : feature.expression);
                    if (!name) {
                        environment.gaps.push(`provideHttpClient feature ${feature.expression.getText()} at ${location(context, feature)} is not an @angular/common/http feature`);
                        continue;
                    }
                    environment.features.push(name);
                    if (name === 'withInterceptors')
                        interceptorsFrom(context, feature, environment);
                    if (name === 'withInterceptorsFromDi')
                        environment.conditions.push('interceptors provided through HTTP_INTERCEPTORS also run, in their provider order');
                }
            }
        }
        if (t.isObjectLiteralExpression(node)) {
            const token = getProperty(t, node, 'provide');
            const tokenName = token && httpApiExport(context, t.isPropertyAccessExpression(token) ? token.name : token);
            if (tokenName === 'HTTP_INTERCEPTORS') {
                const implementation = getProperty(t, node, 'useClass') ?? getProperty(t, node, 'useExisting');
                const symbol = implementation && symbolOf(context, t.isPropertyAccessExpression(implementation)
                    ? implementation.name : implementation);
                const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
                if (declaration && symbol)
                    environment.interceptors.push({
                        id: `${relativeFile(context, declaration.getSourceFile().fileName)}#${symbol.getName()}`,
                        name: symbol.getName(), kind: 'class', source: location(context, declaration)
                    });
                else
                    environment.gaps.push(`HTTP_INTERCEPTORS provider at ${location(context, node)} has no resolved implementation`);
                if (getProperty(t, node, 'multi')?.kind !== t.SyntaxKind.TrueKeyword)
                    environment.gaps.push(`HTTP_INTERCEPTORS provider at ${location(context, node)} is not multi; it replaces the chain`);
            }
        }
        t.forEachChild(node, visit);
    };
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (source)
            visit(source);
    }
    if (!environment.registered)
        environment.gaps.push('no provideHttpClient registration was found in the analyzed sources; the backend and the interceptor chain are unresolved');
    if (environment.interceptors.length)
        environment.conditions.push(`${environment.interceptors.length} interceptor(s) run around every request and can change its target, its result or its count`);
    return environment;
}
/** Catalogs every request site in the context. Reaching one is decided by the caller, not by this listing. */
export function analyzeHttp(context) {
    const t = context.toolchain.typescript;
    const requests = [];
    const diagnostics = [];
    const visit = (node) => {
        if (t.isCallExpression(node)) {
            const site = requestSiteAt(context, node);
            if (site)
                requests.push(site);
        }
        t.forEachChild(node, visit);
    };
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (source)
            visit(source);
    }
    const environment = analyzeHttpEnvironment(context);
    for (const request of requests) {
        if (request.transport === 'http-client')
            request.conditions.push(...environment.conditions);
        diagnostics.push(...request.gaps);
    }
    diagnostics.push(...environment.gaps);
    return { requests, environment, diagnostics: [...new Set(diagnostics)] };
}
