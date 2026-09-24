import { getProperty } from '../../index/catalog.js';
function importSymbol(context, name, pkg) {
    const t = context.toolchain.typescript;
    let symbol = context.checker.getSymbolAtLocation(name);
    if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
        symbol = context.checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.some(d => d.getSourceFile().fileName.replaceAll('\\', '/').includes(`/node_modules/${pkg}/`))
        ? symbol.getName() : null;
}
function memberNode(context, declaration, name) {
    const symbol = context.checker.getTypeAtLocation(declaration.node).getProperty(name);
    return symbol?.valueDeclaration && context.toolchain.typescript.isClassElement(symbol.valueDeclaration)
        ? symbol.valueDeclaration : null;
}
function details(context, declaration, member) {
    const t = context.toolchain.typescript;
    const node = declaration && memberNode(context, declaration, member);
    if (!node)
        return { model: false, defaultValue: null, required: false, transform: null, asyncOutput: false };
    const field = t.isPropertyDeclaration(node) ? node : null;
    const init = field?.initializer;
    if (init && t.isNewExpression(init) && t.isIdentifier(init.expression) &&
        importSymbol(context, init.expression, '@angular/core') === 'EventEmitter')
        return { model: false, defaultValue: null, required: false, transform: null,
            asyncOutput: init.arguments?.[0]?.kind === t.SyntaxKind.TrueKeyword };
    if (init && t.isCallExpression(init)) {
        const callee = init.expression;
        const base = t.isPropertyAccessExpression(callee) ? callee.expression : callee;
        const api = t.isIdentifier(base) ? importSymbol(context, base, '@angular/core') : null;
        if (api === 'input' || api === 'model' || api === 'output' || api === 'EventEmitter') {
            const options = init.arguments.find(t.isObjectLiteralExpression);
            return { model: api === 'model',
                defaultValue: (api === 'input' || api === 'model') &&
                    !(t.isPropertyAccessExpression(callee) && callee.name.text === 'required')
                    ? init.arguments[0]?.getText() ?? null : null,
                required: t.isPropertyAccessExpression(callee) && callee.name.text === 'required',
                transform: options ? getProperty(t, options, 'transform')?.getText() ?? null : null,
                asyncOutput: api === 'EventEmitter' && init.arguments[0]?.kind === t.SyntaxKind.TrueKeyword };
        }
    }
    const inputDecorator = (t.canHaveDecorators(node) ? t.getDecorators(node) ?? [] : []).find(d => t.isCallExpression(d.expression) &&
        t.isIdentifier(d.expression.expression) && importSymbol(context, d.expression.expression, '@angular/core') === 'Input');
    const decoratorOptions = inputDecorator && t.isCallExpression(inputDecorator.expression) ? inputDecorator.expression.arguments[0] : null;
    return { model: false, defaultValue: init?.getText() ?? null, required: false,
        transform: decoratorOptions && t.isObjectLiteralExpression(decoratorOptions) ? getProperty(t, decoratorOptions, 'transform')?.getText() ?? null : null,
        asyncOutput: false };
}
function mutationConditions(context, declaration, member) {
    const t = context.toolchain.typescript;
    const result = [];
    const visit = (node) => {
        if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setInput')
            result.push('ComponentRef.setInput may change this input on an imperative creation path');
        if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.EqualsToken &&
            t.isPropertyAccessExpression(node.left) && node.left.name.text === member)
            result.push('imperative assignment may change this member');
        t.forEachChild(node, visit);
    };
    for (const part of declaration.node.members)
        visit(part);
    return [...new Set(result)];
}
function pipeNames(context, ast) {
    const ng = context.toolchain.angularCompiler;
    const names = [];
    const visitor = new class extends ng.RecursiveAstVisitor {
        visitPipe(node, contextValue) {
            names.push(node.name);
            return super.visitPipe(node, contextValue);
        }
    }();
    ast.visit(visitor);
    return names;
}
function formAccessor(element) {
    const classes = element.directives.map(id => ({ id, name: id.slice(id.lastIndexOf('#') + 1),
        official: id.replaceAll('\\', '/').includes('/node_modules/@angular/forms/') }));
    const known = new Set(['DefaultValueAccessor', 'CheckboxControlValueAccessor', 'RadioControlValueAccessor',
        'NumberValueAccessor', 'RangeValueAccessor', 'SelectControlValueAccessor', 'SelectMultipleControlValueAccessor']);
    const candidates = classes.filter(item => item.official && known.has(item.name));
    const custom = classes.filter(item => /ValueAccessor$/.test(item.name) && !(item.official && known.has(item.name)));
    if (candidates.length === 1 && !custom.length)
        return { target: candidates[0].id,
            reason: 'forms directive must select this accessor on this host' };
    return { target: null, reason: custom.length ? 'custom ControlValueAccessor requires provider resolution' :
            candidates.length > 1 ? 'multiple possible ControlValueAccessor directives' :
                'ControlValueAccessor selection is unresolved' };
}
/** Resolves only inputs/outputs exposed at this exact template occurrence. */
export function resolveElementBindings(element, context, catalog) {
    const relations = [];
    const diagnostics = [];
    const usedInputs = new Set();
    const ng = context.toolchain.angularCompiler;
    for (const [alias, targets] of element.appliedInputs) {
        const bound = element.node.inputs.find(input => input.name === alias);
        const attribute = element.staticAttributes.get(alias);
        const hasAttribute = element.staticAttributes.has(alias);
        if (bound || hasAttribute)
            usedInputs.add(alias);
        for (const target of targets) {
            const dot = target.lastIndexOf('.');
            const targetId = target.slice(0, dot), member = target.slice(dot + 1);
            const declaration = catalog.declarations.get(targetId);
            const info = details(context, declaration, member);
            const conditions = element.controlFlow.map(frame => frame.condition);
            const mutates = declaration ? mutationConditions(context, declaration, member) : [];
            if (bound || hasAttribute) {
                const twoWay = !!bound && bound.type === ng.BindingType.TwoWay;
                if (info.transform)
                    conditions.push(`input transform ${info.transform} must be evaluated`);
                for (const pipe of bound ? pipeNames(context, bound.value) : [])
                    conditions.push(`pipe ${pipe} must be resolved in the owner scope before value propagation`);
                conditions.push(...mutates);
                if (!element.component && element.gaps.some(g => g.includes('Ambiguous component')))
                    conditions.push('component target is ambiguous');
                relations.push({ kind: 'input-binding', alias, member, targetId,
                    expression: bound ? element.boundExpressions.get(alias) ?? '' : attribute,
                    source: twoWay ? 'two-way' : bound ? 'property' : 'attribute',
                    span: bound ? element.boundSpans.get(alias) ?? element.span : element.span,
                    conditions, diagnostics: info.transform ? ['Transform result is not treated as identity'] : [] });
                if (declaration && memberNode(context, declaration, 'ngOnChanges'))
                    relations.push({ kind: 'input-change', alias, member: 'ngOnChanges',
                        targetId, expression: member, source: bound ? 'property' : 'attribute',
                        span: bound ? element.boundSpans.get(alias) ?? element.span : element.span,
                        conditions: [...conditions, 'runs at a change-detection boundary when Angular records an input change'], diagnostics: [] });
                if (twoWay && !info.model && !element.appliedOutputs.has(`${alias}Change`))
                    diagnostics.push(`Two-way binding ${alias} has no confirmed ${alias}Change output`);
            }
            else if (info.defaultValue !== null && !info.required) {
                relations.push({ kind: 'input-binding', alias, member, targetId, expression: info.defaultValue,
                    source: 'default', span: element.span,
                    conditions: [...conditions, 'default applies only at this occurrence while no parent value is supplied',
                        'imperative creation, providers, and later assignment may override this value', ...mutates], diagnostics: [] });
            }
        }
    }
    for (const output of element.node.outputs) {
        const targets = element.appliedOutputs.get(output.name) ?? [];
        for (const target of targets) {
            const dot = target.lastIndexOf('.');
            const targetId = target.slice(0, dot), member = target.slice(dot + 1);
            const declaration = catalog.declarations.get(targetId);
            const info = details(context, declaration, member);
            relations.push({ kind: 'output-subscription', alias: output.name, member, targetId,
                expression: element.eventHandlers[element.node.outputs.indexOf(output)] ?? '', source: output.name.endsWith('Change') &&
                    element.node.inputs.some(input => `${input.name}Change` === output.name && input.type === ng.BindingType.TwoWay) ? 'two-way' : 'event',
                span: element.eventSpans[element.node.outputs.indexOf(output)] ?? element.span,
                conditions: [...element.controlFlow.map(frame => frame.condition),
                    'handler runs only if this output instance emits', ...(info.asyncOutput ? ['EventEmitter(true) delivers asynchronously'] : [])],
                diagnostics: [] });
        }
    }
    const formAliases = new Set([...usedInputs, ...element.node.inputs.map(input => input.name),
        ...element.staticAttributes.keys()].filter(alias => ['ngModel', 'formControl', 'formControlName'].includes(alias)));
    for (const alias of formAliases) {
        const accessor = formAccessor(element);
        relations.push({ kind: 'form-accessor', alias, member: null, targetId: accessor.target,
            expression: element.boundExpressions.get(alias) ?? element.staticAttributes.get(alias) ?? '', source: 'form',
            span: element.boundSpans.get(alias) ?? element.span,
            conditions: ['forms directive registration and value accessor writeValue/registerOnChange are separate paths', accessor.reason],
            diagnostics: accessor.target ? [] : ['Form accessor is unresolved'] });
    }
    return { relations, diagnostics };
}
