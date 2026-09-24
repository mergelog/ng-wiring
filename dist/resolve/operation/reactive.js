import { ScopeResolver } from '../scope/index.js';
const slash = (value) => value.replaceAll('\\', '/');
const rxjsOperators = new Set(['map', 'tap', 'filter', 'debounce', 'debounceTime', 'switchMap', 'mergeMap', 'concatMap',
    'exhaustMap', 'withLatestFrom', 'take', 'catchError', 'distinctUntilChanged', 'takeUntilDestroyed']);
const rxjsCreators = new Set(['Subject', 'BehaviorSubject', 'ReplaySubject', 'of', 'from', 'forkJoin', 'timer',
    'firstValueFrom', 'lastValueFrom']);
const ngrxOperators = new Set(['concatLatestFrom', 'tapResponse', 'mapResponse']);
const angularApis = new Set(['input', 'model', 'output', 'signal', 'computed', 'effect', 'EventEmitter']);
/** Identifies a package declaration after following import/re-export aliases. */
export function importedApi(context, node) {
    const t = context.toolchain.typescript;
    let symbol = context.checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
        symbol = context.checker.getAliasedSymbol(symbol);
    if (!symbol)
        return null;
    const name = symbol.getName();
    const files = symbol.declarations?.map(part => slash(part.getSourceFile().fileName)) ?? [];
    if (files.some(file => file.includes('/node_modules/@angular/core/')) && angularApis.has(name))
        return { family: 'angular', name };
    if (files.some(file => file.includes('/node_modules/@angular/core/')) && name === 'takeUntilDestroyed')
        return { family: 'angular', name };
    if (files.some(file => file.includes('/node_modules/@ngrx/operators/')) && ngrxOperators.has(name))
        return { family: 'ngrx-operators', name };
    if (files.some(file => file.includes('/node_modules/rxjs/')) && (rxjsOperators.has(name) || rxjsCreators.has(name)))
        return { family: 'rxjs', name };
    return null;
}
const known = {
    map: { timing: 'sync', conditions: ['projection executes for each source notification'], mode: 'projection' },
    tap: { timing: 'sync', conditions: ['side effect executes for each reached notification'], mode: 'side-effect' },
    filter: { timing: 'sync', conditions: ['predicate must accept the value'], mode: 'filter' },
    debounce: { timing: 'timer', conditions: ['duration observable must complete; intervening values cancel earlier values'], mode: 'debounce' },
    debounceTime: { timing: 'timer', conditions: ['duration must elapse; intervening values cancel earlier values'], mode: 'debounce' },
    switchMap: { timing: 'subscription', conditions: ['new outer value cancels the previous inner subscription'], mode: 'latest' },
    mergeMap: { timing: 'subscription', conditions: ['inner subscriptions may overlap'], mode: 'parallel' },
    concatMap: { timing: 'subscription', conditions: ['inner subscriptions are queued in source order'], mode: 'serial' },
    exhaustMap: { timing: 'subscription', conditions: ['new outer values are ignored while an inner subscription is active'], mode: 'exhaust' },
    withLatestFrom: { timing: 'sync', conditions: ['each secondary source must have produced a value; it is a background read'], mode: 'background-read' },
    concatLatestFrom: { timing: 'sync', conditions: ['selector is evaluated on the source notification; its value is a background read'], mode: 'background-read' },
    take: { timing: 'sync', conditions: ['subscription completes after the configured number of notifications'], mode: 'limit' },
    catchError: { timing: 'subscription', conditions: ['replacement source runs only after an error'], mode: 'error-recovery' },
    forkJoin: { timing: 'subscription', conditions: ['all input observables must complete; an empty or failing input can suppress output'], mode: 'join' },
    timer: { timing: 'timer', conditions: ['timer must fire after its configured delay'], mode: 'timer' },
    of: { timing: 'subscription', conditions: ['values are delivered when subscribed'], mode: 'creation' },
    from: { timing: 'subscription', conditions: ['array, iterable, or Promise input is converted on subscription; Promise settles asynchronously'], mode: 'conversion' },
    firstValueFrom: { timing: 'microtask', conditions: ['subscribes and resolves/rejects a Promise on the first value or terminal event'], mode: 'promise-consume' },
    lastValueFrom: { timing: 'microtask', conditions: ['subscribes and resolves/rejects a Promise after completion'], mode: 'promise-consume' },
    distinctUntilChanged: { timing: 'sync', conditions: ['comparison may suppress an unchanged projected value'], mode: 'distinct' },
    tapResponse: { timing: 'sync', conditions: ['next/error handlers follow their corresponding notification'], mode: 'response' },
    mapResponse: { timing: 'sync', conditions: ['next/error mapping follows its corresponding notification'], mode: 'response' },
    takeUntilDestroyed: { timing: 'subscription', conditions: ['subscription ends when the owning DestroyRef is destroyed'], mode: 'lifetime' },
};
export function operatorSemantics(name) { return known[name] ?? null; }
export function inspectPipe(context, call) {
    const t = context.toolchain.typescript;
    if (!t.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'pipe')
        return [];
    const receiverType = context.checker.getTypeAtLocation(call.expression.expression);
    if (!receiverType.getSymbol()?.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/rxjs/')))
        return call.arguments.map(argument => ({ name: argument.getText(), api: null, location: location(context, argument),
            semantics: null, boundary: 'pipe receiver is not a confirmed RxJS Observable' }));
    return call.arguments.map(argument => {
        if (!t.isCallExpression(argument))
            return { name: argument.getText(), api: null, location: location(context, argument),
                semantics: null, boundary: 'operator expression is not a statically identified call' };
        const callee = t.isPropertyAccessExpression(argument.expression) ? argument.expression.name : argument.expression;
        const api = importedApi(context, callee);
        const semantics = api ? operatorSemantics(api.name) : null;
        return { name: callee.getText(), api, location: location(context, argument), semantics,
            boundary: semantics ? null : `unknown operator ${callee.getText()} stops value propagation` };
    });
}
/** AsyncPipe is a template subscription, with view destruction as its lifetime. */
export function inspectAsyncPipe(element, context, catalog) {
    const ng = context.toolchain.angularCompiler;
    const scope = new ScopeResolver(catalog).scopeOf(element.owner);
    const pipeIds = [...scope.ids].filter(id => {
        const item = catalog.declarations.get(id) ?? catalog.external.get(id);
        return item?.kind === 'pipe' && item.selector === 'async' &&
            id.replaceAll('\\', '/').includes('/node_modules/@angular/common/') && id.endsWith('#AsyncPipe');
    });
    const result = [];
    const visitor = new class extends ng.RecursiveAstVisitor {
        visitPipe(ast, contextValue) {
            const expressionSpan = ast.exp.sourceSpan;
            const inlineExpression = element.owner.template.kind === 'inline'
                ? element.owner.template.text.slice(expressionSpan.start, expressionSpan.end) : '';
            if (ast.name === 'async')
                result.push({ expression: inlineExpression || '(template expression)', span: element.span,
                    status: pipeIds.length === 1 ? 'resolved' : 'boundary', pipeId: pipeIds.length === 1 ? pipeIds[0] : null,
                    conditions: pipeIds.length === 1 ? ['subscribes while the containing view exists',
                        'latest value is displayed after a notification and a change-detection boundary',
                        'subscription ends when the view is destroyed or the bound source changes'] :
                        ['async pipe declaration is absent or ambiguous in the owner scope'] });
            return super.visitPipe(ast, contextValue);
        }
    }();
    for (const input of element.node.inputs)
        input.value.visit(visitor);
    for (const child of element.node.children)
        if (child instanceof ng.TmplAstBoundText)
            child.value.visit(visitor);
    return result;
}
export function location(context, node) {
    const file = node.getSourceFile();
    const pos = file.getLineAndCharacterOfPosition(node.getStart());
    return `${slash(file.fileName.slice(context.workspaceRoot.length + 1))}:${pos.line + 1}:${pos.character + 1}`;
}
