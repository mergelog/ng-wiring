import path from 'node:path';
import { StaticEvaluator } from '../workspace/evaluate.js';
const slash = (s) => s.replaceAll('\\', '/');
export function getProperty(tsApi, object, name) {
    const assignment = object.properties.find(p => tsApi.isPropertyAssignment(p) &&
        (tsApi.isIdentifier(p.name) || tsApi.isStringLiteral(p.name)) && p.name.text === name);
    return assignment && tsApi.isPropertyAssignment(assignment) ? assignment.initializer : undefined;
}
export function unwrap(tsApi, node) {
    return tsApi.isAsExpression(node) || tsApi.isSatisfiesExpression(node) || tsApi.isParenthesizedExpression(node)
        ? unwrap(tsApi, node.expression) : node;
}
export function classAt(context, expression) {
    const t = context.toolchain.typescript;
    const node = unwrap(t, expression);
    const symbolNode = t.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = context.checker.getSymbolAtLocation(symbolNode);
    if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
        symbol = context.checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.find(t.isClassDeclaration);
}
export function idForClass(context, declaration) {
    if (!declaration.name)
        return undefined;
    const file = declaration.getSourceFile().fileName;
    return file.includes(`${path.sep}node_modules${path.sep}`)
        ? `external:${slash(file)}#${declaration.name.text}`
        : `${slash(path.relative(context.workspaceRoot, file))}#${declaration.name.text}`;
}
function decorator(context, node) {
    const t = context.toolchain.typescript;
    for (const item of t.getDecorators(node) ?? []) {
        if (!t.isCallExpression(item.expression) || item.expression.arguments.length !== 1)
            continue;
        const callee = item.expression.expression;
        const nameNode = t.isPropertyAccessExpression(callee) ? callee.name : callee;
        if (!t.isIdentifier(nameNode))
            continue;
        let symbol = context.checker.getSymbolAtLocation(nameNode);
        if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
            symbol = context.checker.getAliasedSymbol(symbol);
        const name = symbol?.getName();
        const kind = name === 'Component' ? 'component' : name === 'Directive' ? 'directive' :
            name === 'Pipe' ? 'pipe' : name === 'NgModule' ? 'module' : undefined;
        if (!kind || !symbol?.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
            continue;
        const arg = unwrap(t, item.expression.arguments[0]);
        if (t.isObjectLiteralExpression(arg))
            return { kind, metadata: arg };
    }
    return undefined;
}
function refs(context, expression, gaps, label) {
    if (!expression)
        return [];
    const t = context.toolchain.typescript;
    const visited = new Set();
    const visit = (node) => {
        node = unwrap(t, node);
        if (visited.has(node)) {
            gaps.push(`${label}: circular metadata`);
            return [];
        }
        visited.add(node);
        if (t.isArrayLiteralExpression(node))
            return node.elements.flatMap(element => t.isSpreadElement(element) ? visit(element.expression) : visit(element));
        if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) &&
            ['forRoot', 'forChild'].includes(node.expression.name.text))
            return visit(node.expression.expression);
        if (t.isObjectLiteralExpression(node)) {
            const directive = getProperty(t, node, 'directive');
            if (directive)
                return visit(directive);
        }
        const declaration = classAt(context, node);
        if (declaration?.name)
            return [idForClass(context, declaration)];
        if (t.isIdentifier(node)) {
            let symbol = context.checker.getSymbolAtLocation(node);
            if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
                symbol = context.checker.getAliasedSymbol(symbol);
            const value = symbol?.valueDeclaration;
            if (value && t.isVariableDeclaration(value) && value.initializer &&
                t.isVariableDeclarationList(value.parent) && value.parent.flags & t.NodeFlags.Const)
                return visit(value.initializer);
        }
        gaps.push(`${label}: unresolved ${node.getText().slice(0, 100)}`);
        return [];
    };
    return visit(expression);
}
function aliases(context, expression) {
    const result = new Map();
    const t = context.toolchain.typescript;
    const value = expression && unwrap(t, expression);
    if (!value || !t.isArrayLiteralExpression(value))
        return result;
    for (const item of value.elements) {
        if (!t.isStringLiteralLike(item))
            continue;
        const [member, alias] = item.text.split(':').map(part => part.trim());
        if (member)
            result.set(alias || member, member);
    }
    return result;
}
function memberAliases(context, node, kind, active = new Set()) {
    const result = new Map();
    if (active.has(node))
        return result;
    active.add(node);
    const t = context.toolchain.typescript;
    for (const heritage of node.heritageClauses ?? [])
        if (heritage.token === t.SyntaxKind.ExtendsKeyword) {
            for (const base of heritage.types) {
                const inherited = classAt(context, base.expression);
                if (inherited)
                    for (const [alias, member] of memberAliases(context, inherited, kind, active))
                        result.set(alias, member);
            }
        }
    for (const member of node.members) {
        if (!member.name || !(t.isIdentifier(member.name) || t.isStringLiteral(member.name)))
            continue;
        const name = member.name.text;
        for (const item of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
            if (!t.isCallExpression(item.expression))
                continue;
            const callee = item.expression.expression;
            if (!t.isIdentifier(callee))
                continue;
            let symbol = context.checker.getSymbolAtLocation(callee);
            if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
                symbol = context.checker.getAliasedSymbol(symbol);
            if (symbol?.getName() !== kind || !symbol.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
                continue;
            const argument = item.expression.arguments[0];
            const value = argument && new StaticEvaluator(t, context.checker).evaluate(argument);
            const alias = value?.known && typeof value.value === 'string' ? value.value : name;
            result.set(alias, name);
        }
        if (!t.isPropertyDeclaration(member) || !member.initializer || !t.isCallExpression(member.initializer))
            continue;
        const call = member.initializer;
        const callee = t.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression;
        if (!t.isIdentifier(callee))
            continue;
        let symbol = context.checker.getSymbolAtLocation(callee);
        if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
            symbol = context.checker.getAliasedSymbol(symbol);
        const exportName = symbol?.getName();
        if (kind === 'Input' ? !['input', 'model'].includes(exportName ?? '') : !['output', 'model'].includes(exportName ?? ''))
            continue;
        if (!symbol?.declarations?.some(d => slash(d.getSourceFile().fileName).includes('/node_modules/@angular/core/')))
            continue;
        const options = call.arguments.find(t.isObjectLiteralExpression);
        const aliasExpression = options && getProperty(t, options, 'alias');
        const value = aliasExpression && new StaticEvaluator(t, context.checker).evaluate(aliasExpression);
        result.set(value?.known && typeof value.value === 'string' ? value.value : name, name);
    }
    return result;
}
export async function buildCatalog(context) {
    const t = context.toolchain.typescript;
    const evaluator = new StaticEvaluator(t, context.checker);
    const declarations = new Map();
    const external = new Map();
    const byNode = new Map();
    const gaps = [];
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (!source)
            continue;
        const visit = (node) => {
            if (t.isClassDeclaration(node)) {
                const found = decorator(context, node);
                if (found && node.name) {
                    const id = `${slash(path.relative(context.workspaceRoot, file))}#${node.name.text}`;
                    const localGaps = [];
                    const prop = (name) => getProperty(t, found.metadata, name);
                    if (prop('host'))
                        localGaps.push('Host attributes are outside static template attribute matching');
                    const scanRuntime = (part) => {
                        if (t.isCallExpression(part) && t.isPropertyAccessExpression(part.expression) &&
                            part.expression.name.text === 'setAttribute')
                            localGaps.push('Runtime setAttribute is outside static template attribute matching');
                        t.forEachChild(part, scanRuntime);
                    };
                    scanRuntime(node);
                    const evaluate = (name) => { const value = prop(name); return value ? evaluator.evaluate(value) : undefined; };
                    const selectorValue = evaluate(found.kind === 'pipe' ? 'name' : 'selector');
                    const standaloneValue = evaluate('standalone');
                    const selector = selectorValue?.known && typeof selectorValue.value === 'string' ? selectorValue.value : null;
                    if ((found.kind === 'component' || found.kind === 'directive') && !selector && prop('selector'))
                        localGaps.push('Unresolved selector');
                    const standalone = standaloneValue?.known && typeof standaloneValue.value === 'boolean'
                        ? standaloneValue.value : found.kind !== 'module';
                    const templateUrl = evaluate('templateUrl');
                    const inline = prop('template');
                    let template = { kind: 'none', text: '', file };
                    if (found.kind === 'component' && inline) {
                        const result = evaluator.evaluate(inline);
                        if (result.known && typeof result.value === 'string')
                            template = { kind: 'inline', text: result.value, file,
                                expression: t.isStringLiteralLike(inline) ? inline : undefined };
                        else
                            localGaps.push('Unresolved inline template');
                    }
                    else if (found.kind === 'component' && templateUrl?.known && typeof templateUrl.value === 'string') {
                        template = { kind: 'external', text: '', file: path.resolve(path.dirname(file), templateUrl.value) };
                    }
                    else if (found.kind === 'component' && prop('templateUrl'))
                        localGaps.push('Unresolved templateUrl');
                    const declaration = {
                        id, kind: found.kind, className: node.name.text, node, selector, standalone, metadata: found.metadata,
                        imports: refs(context, prop('imports'), localGaps, 'imports'),
                        declarations: refs(context, prop('declarations'), localGaps, 'declarations'),
                        exports: refs(context, prop('exports'), localGaps, 'exports'),
                        hostDirectives: refs(context, prop('hostDirectives'), localGaps, 'hostDirectives'),
                        hostDirectiveExposures: (() => {
                            const exposed = new Map();
                            const value = prop('hostDirectives');
                            if (!value || !t.isArrayLiteralExpression(value))
                                return exposed;
                            for (const item of value.elements) {
                                if (!t.isObjectLiteralExpression(item))
                                    continue;
                                const directive = getProperty(t, item, 'directive');
                                const id = directive && refs(context, directive, localGaps, 'hostDirectives')[0];
                                if (id)
                                    exposed.set(id, { inputs: aliases(context, getProperty(t, item, 'inputs')),
                                        outputs: aliases(context, getProperty(t, item, 'outputs')) });
                            }
                            return exposed;
                        })(),
                        inputs: new Map([...memberAliases(context, node, 'Input'), ...aliases(context, prop('inputs'))]),
                        outputs: new Map([...memberAliases(context, node, 'Output'), ...aliases(context, prop('outputs'))]),
                        template, gaps: localGaps,
                    };
                    declarations.set(id, declaration);
                    byNode.set(node, declaration);
                    gaps.push(...localGaps.map(gap => `${id}: ${gap}`));
                }
            }
            t.forEachChild(node, visit);
        };
        visit(source);
    }
    const referenceIds = [...declarations.values()].flatMap(item => [...item.imports, ...item.declarations, ...item.exports, ...item.hostDirectives]);
    const queue = referenceIds.filter(id => id.startsWith('external:'));
    const typeRefs = (type) => {
        if (!type)
            return [];
        if (t.isTupleTypeNode(type))
            return type.elements.flatMap(typeRefs);
        if (t.isUnionTypeNode(type))
            return type.types.flatMap(typeRefs);
        if (t.isTypeReferenceNode(type) || t.isTypeQueryNode(type)) {
            let symbol = context.checker.getSymbolAtLocation(t.isTypeReferenceNode(type) ? type.typeName : type.exprName);
            if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
                symbol = context.checker.getAliasedSymbol(symbol);
            const declaration = symbol?.declarations?.find(t.isClassDeclaration);
            const id = declaration && idForClass(context, declaration);
            return id ? [id] : [];
        }
        return [];
    };
    while (queue.length && external.size < 2_000) {
        const id = queue.shift();
        if (external.has(id))
            continue;
        const marker = id.lastIndexOf('#');
        const source = context.program.getSourceFile(id.slice('external:'.length, marker));
        const node = source?.statements.find(statement => t.isClassDeclaration(statement) && statement.name?.text === id.slice(marker + 1));
        if (!node || !t.isClassDeclaration(node)) {
            gaps.push(`External metadata unavailable: ${id}`);
            continue;
        }
        const metadata = node.members.find(member => t.isPropertyDeclaration(member) &&
            (member.name.getText() === 'ɵcmp' || member.name.getText() === 'ɵdir' || member.name.getText() === 'ɵmod' || member.name.getText() === 'ɵpipe'));
        if (!metadata || !t.isPropertyDeclaration(metadata) || !metadata.type || !t.isTypeReferenceNode(metadata.type)) {
            gaps.push(`External Angular metadata unavailable: ${id}`);
            continue;
        }
        const field = metadata.name.getText();
        const kind = field === 'ɵcmp' ? 'component' : field === 'ɵdir' ? 'directive' :
            field === 'ɵmod' ? 'module' : 'pipe';
        const args = metadata.type.typeArguments ?? [];
        const selector = args[1] && t.isLiteralTypeNode(args[1]) && t.isStringLiteral(args[1].literal) ? args[1].literal.text : null;
        const standalone = args[7] ? args[7].kind === t.SyntaxKind.TrueKeyword : false;
        const declarations = kind === 'module' ? typeRefs(args[1]) : [];
        const imports = kind === 'module' ? typeRefs(args[2]) : [];
        const exports = kind === 'module' ? typeRefs(args[3]) : [];
        const aliasMap = (type) => {
            const result = new Map();
            if (!type || !t.isTypeLiteralNode(type))
                return result;
            for (const member of type.members) {
                if (!t.isPropertySignature(member) || !member.name)
                    continue;
                const name = member.name.getText().replace(/^['"]|['"]$/g, '');
                let alias;
                if (member.type && t.isLiteralTypeNode(member.type) && t.isStringLiteral(member.type.literal))
                    alias = member.type.literal.text;
                if (member.type && t.isTypeLiteralNode(member.type)) {
                    const prop = member.type.members.find(part => t.isPropertySignature(part) && part.name.getText() === 'alias');
                    if (prop && t.isPropertySignature(prop) && prop.type && t.isLiteralTypeNode(prop.type) &&
                        t.isStringLiteral(prop.type.literal))
                        alias = prop.type.literal.text;
                }
                result.set(alias || name, name);
            }
            return result;
        };
        external.set(id, { id, kind, selector, standalone, declarations, imports, exports,
            inputs: aliasMap(args[3]), outputs: aliasMap(args[4]) });
        queue.push(...[...declarations, ...imports, ...exports].filter(ref => ref.startsWith('external:')));
    }
    if (queue.length)
        gaps.push('External metadata expansion limit');
    return { declarations, external, byNode, gaps };
}
