// This interprets a deliberately small AST subset. It never executes analyzed code.
export class StaticEvaluator {
    tsApi;
    checker;
    maxExpansions;
    maxDepth;
    expansions = 0;
    active = new Set();
    constructor(tsApi, checker, maxExpansions = 10_000, maxDepth = 64) {
        this.tsApi = tsApi;
        this.checker = checker;
        this.maxExpansions = maxExpansions;
        this.maxDepth = maxDepth;
    }
    evaluate(node) {
        this.expansions = 0;
        this.active.clear();
        return this.visit(node, 0);
    }
    unknown(reason) { return { known: false, reason }; }
    visit(node, depth) {
        const t = this.tsApi;
        if (++this.expansions > this.maxExpansions)
            return this.unknown('Static evaluation expansion limit');
        if (depth > this.maxDepth)
            return this.unknown('Static evaluation depth limit');
        if (this.active.has(node))
            return this.unknown('Static evaluation cycle');
        this.active.add(node);
        try {
            if (t.isParenthesizedExpression(node) || t.isAsExpression(node) || t.isSatisfiesExpression(node) || t.isNonNullExpression(node)) {
                return this.visit(node.expression, depth + 1);
            }
            if (t.isStringLiteralLike(node) || t.isNoSubstitutionTemplateLiteral(node))
                return { known: true, value: node.text };
            if (t.isNumericLiteral(node))
                return { known: true, value: Number(node.text) };
            if (node.kind === t.SyntaxKind.TrueKeyword)
                return { known: true, value: true };
            if (node.kind === t.SyntaxKind.FalseKeyword)
                return { known: true, value: false };
            if (node.kind === t.SyntaxKind.NullKeyword)
                return { known: true, value: null };
            if (t.isPrefixUnaryExpression(node) && [t.SyntaxKind.PlusToken, t.SyntaxKind.MinusToken].includes(node.operator)) {
                const result = this.visit(node.operand, depth + 1);
                return result.known && typeof result.value === 'number'
                    ? { known: true, value: node.operator === t.SyntaxKind.MinusToken ? -result.value : result.value }
                    : this.unknown('Non-numeric unary expression');
            }
            if (t.isIdentifier(node)) {
                let symbol = this.checker.getSymbolAtLocation(node);
                if (!symbol)
                    return this.unknown(`Unresolved identifier ${node.text}`);
                if (symbol.flags & t.SymbolFlags.Alias)
                    symbol = this.checker.getAliasedSymbol(symbol);
                const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
                if (declaration && t.isVariableDeclaration(declaration) && declaration.initializer) {
                    const list = declaration.parent;
                    if (!t.isVariableDeclarationList(list) || !(list.flags & t.NodeFlags.Const))
                        return this.unknown(`Mutable identifier ${node.text}`);
                    return this.visit(declaration.initializer, depth + 1);
                }
                return this.unknown(`Unsupported identifier declaration ${node.text}`);
            }
            if (t.isArrayLiteralExpression(node)) {
                const values = [];
                for (const item of node.elements) {
                    const value = this.visit(t.isSpreadElement(item) ? item.expression : item, depth + 1);
                    if (!value.known)
                        return value;
                    if (t.isSpreadElement(item)) {
                        if (!Array.isArray(value.value))
                            return this.unknown('Array spread is not an array');
                        values.push(...value.value);
                    }
                    else
                        values.push(value.value);
                }
                return { known: true, value: values };
            }
            if (t.isObjectLiteralExpression(node)) {
                const value = {};
                for (const property of node.properties) {
                    if (t.isSpreadAssignment(property)) {
                        const spread = this.visit(property.expression, depth + 1);
                        if (!spread.known || !spread.value || typeof spread.value !== 'object' || Array.isArray(spread.value))
                            return this.unknown('Unknown object spread');
                        Object.assign(value, spread.value);
                    }
                    else if (t.isPropertyAssignment(property)) {
                        const key = t.isIdentifier(property.name) || t.isStringLiteral(property.name) || t.isNumericLiteral(property.name)
                            ? property.name.text : undefined;
                        if (key === undefined)
                            return this.unknown('Computed object property');
                        const member = this.visit(property.initializer, depth + 1);
                        if (!member.known)
                            return member;
                        value[key] = member.value;
                    }
                    else if (t.isShorthandPropertyAssignment(property)) {
                        const member = this.visit(property.name, depth + 1);
                        if (!member.known)
                            return member;
                        value[property.name.text] = member.value;
                    }
                    else
                        return this.unknown('Getter, method or accessor is not evaluated');
                }
                return { known: true, value };
            }
            if (t.isPropertyAccessExpression(node) || t.isElementAccessExpression(node)) {
                const owner = this.visit(node.expression, depth + 1);
                if (!owner.known || owner.value === null || typeof owner.value !== 'object')
                    return this.unknown('Unknown property owner');
                const key = t.isPropertyAccessExpression(node) ? node.name.text :
                    node.argumentExpression && this.visit(node.argumentExpression, depth + 1);
                const name = typeof key === 'string' ? key : key && key.known ? String(key.value) : undefined;
                if (name === undefined || !(name in owner.value))
                    return this.unknown(`Unknown property ${name ?? ''}`);
                return { known: true, value: owner.value[name] };
            }
            if (t.isConditionalExpression(node)) {
                const condition = this.visit(node.condition, depth + 1);
                if (!condition.known || typeof condition.value !== 'boolean')
                    return this.unknown('Unknown conditional test');
                return this.visit(condition.value ? node.whenTrue : node.whenFalse, depth + 1);
            }
            if (t.isCallExpression(node) && node.arguments.length === 0 && t.isIdentifier(node.expression)) {
                let symbol = this.checker.getSymbolAtLocation(node.expression);
                if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
                    symbol = this.checker.getAliasedSymbol(symbol);
                const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
                const functionNode = declaration && t.isVariableDeclaration(declaration) && declaration.initializer
                    ? declaration.initializer : declaration;
                if (functionNode && (t.isArrowFunction(functionNode) || t.isFunctionExpression(functionNode) || t.isFunctionDeclaration(functionNode)) &&
                    functionNode.parameters.length === 0 && functionNode.body) {
                    const body = functionNode.body;
                    if (!t.isBlock(body))
                        return this.visit(body, depth + 1);
                    if (body.statements.length === 1 && t.isReturnStatement(body.statements[0]) && body.statements[0].expression) {
                        return this.visit(body.statements[0].expression, depth + 1);
                    }
                }
                return this.unknown('Call is not a single-expression static function');
            }
            // Calls, new, getters, providers and loaders are never run or presumed pure.
            return this.unknown(`Unsupported expression ${t.SyntaxKind[node.kind]}`);
        }
        finally {
            this.active.delete(node);
        }
    }
}
