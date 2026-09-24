import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ScopeResolver } from '../resolve/scope/index.js';
const slash = (s) => s.replaceAll('\\', '/');
function rawOffsetMap(expression) {
    const raw = expression.getText();
    if (!['\'', '"', '`'].includes(raw[0] ?? '') || raw.at(-1) !== raw[0])
        return null;
    const result = [];
    let cooked = '';
    for (let i = 1; i < raw.length - 1;) {
        const start = i;
        let value;
        if (raw[i] !== '\\') {
            value = raw[i];
            i++;
        }
        else {
            const escaped = raw[i + 1];
            if (escaped === undefined)
                return null;
            const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
            if (escaped === '\n') {
                i += 2;
                continue;
            }
            if (escaped === '\r') {
                i += raw[i + 2] === '\n' ? 3 : 2;
                continue;
            }
            if (escaped === 'u' && /^[a-fA-F0-9]{4}$/.test(raw.slice(i + 2, i + 6))) {
                value = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
                i += 6;
            }
            else if (escaped === 'x' && /^[a-fA-F0-9]{2}$/.test(raw.slice(i + 2, i + 4))) {
                value = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16));
                i += 4;
            }
            else if (escaped in simple) {
                value = simple[escaped];
                i += 2;
            }
            else if (['\\', '\'', '"', '`', '$'].includes(escaped)) {
                value = escaped;
                i += 2;
            }
            else
                return null;
        }
        for (let j = 0; j < value.length; j++)
            result.push(expression.getStart() + start);
        cooked += value;
    }
    result.push(expression.getStart() + raw.length - 1);
    return cooked === expression.text ? result : null;
}
function selectorFor(context, element) {
    const selector = new context.toolchain.angularCompiler.CssSelector();
    selector.setElement(element instanceof context.toolchain.angularCompiler.TmplAstElement ? element.name : element.tagName ?? 'ng-template');
    for (const attr of element.attributes) {
        selector.addAttribute(attr.name, attr.value);
        if (attr.name === 'class')
            for (const name of attr.value.split(/\s+/).filter(Boolean))
                selector.addClassName(name);
    }
    for (const input of element.inputs)
        selector.addAttribute(input.name, '');
    for (const output of element.outputs)
        selector.addAttribute(output.name, '');
    if (element instanceof context.toolchain.angularCompiler.TmplAstTemplate) {
        for (const attr of element.templateAttrs)
            selector.addAttribute(attr.name, '');
    }
    return selector;
}
export async function indexTemplates(context, catalog, maze) {
    const ng = context.toolchain.angularCompiler;
    const scopes = new ScopeResolver(catalog);
    const elements = [];
    const slots = [];
    const byOwner = new Map();
    const diagnostics = [];
    const matchedMaze = new Set();
    const templateCache = new Map();
    for (const owner of catalog.declarations.values()) {
        if (owner.kind !== 'component' || owner.template.kind === 'none')
            continue;
        let source = owner.template.text;
        if (owner.template.kind === 'external') {
            const cached = templateCache.get(owner.template.file);
            if (cached !== undefined)
                source = cached;
            else {
                try {
                    source = await readFile(owner.template.file, 'utf8');
                    templateCache.set(owner.template.file, source);
                    await context.snapshot.recordIfExists(owner.template.file);
                }
                catch {
                    diagnostics.push(`${owner.id}: missing template ${owner.template.file}`);
                    continue;
                }
            }
        }
        const parsed = ng.parseTemplate(source, owner.template.file, { preserveWhitespaces: true });
        if (parsed.errors?.length) {
            diagnostics.push(`${owner.id}: template parse error: ${parsed.errors.map(error => error.msg).join(' | ')}`);
            continue;
        }
        const offsetMap = owner.template.kind === 'inline' && owner.template.expression ? rawOffsetMap(owner.template.expression) : null;
        if (owner.template.kind === 'inline' && !offsetMap)
            diagnostics.push(`${owner.id}: inline template offset cannot be mapped exactly`);
        const sourceFile = context.program.getSourceFile(owner.template.file);
        const map = (start, end) => {
            const mappedStart = owner.template.kind === 'inline' ? offsetMap?.[start] : start;
            const mappedEnd = owner.template.kind === 'inline' ? offsetMap?.[end] : end;
            if (mappedStart === undefined || mappedEnd === undefined)
                return null;
            const text = owner.template.kind === 'external' ? source : sourceFile?.text;
            if (!text)
                return null;
            const before = text.slice(0, mappedStart);
            const line = before.split('\n').length;
            const column = mappedStart - before.lastIndexOf('\n');
            const endLine = text.slice(0, Math.max(mappedStart, mappedEnd - 1)).split('\n').length;
            return { file: owner.template.file, start: mappedStart, end: mappedEnd, line, endLine, column };
        };
        const scope = scopes.scopeOf(owner);
        const matcher = new ng.SelectorMatcher();
        for (const id of scope.ids) {
            const declaration = catalog.declarations.get(id) ?? catalog.external.get(id);
            if (!declaration?.selector || !['component', 'directive'].includes(declaration.kind))
                continue;
            try {
                matcher.addSelectables(ng.CssSelector.parse(declaration.selector), id);
            }
            catch {
                diagnostics.push(`${id}: invalid Angular selector ${declaration.selector}`);
            }
        }
        const ownerElements = [];
        const walk = (nodes, parent, repeated, fallbackSlot = null) => {
            for (const node of nodes) {
                let current = parent;
                let localFallback = fallbackSlot;
                if (node instanceof ng.TmplAstContent) {
                    const position = map(node.startSourceSpan.start.offset, node.startSourceSpan.end.offset);
                    if (position) {
                        localFallback = { owner, node, selector: node.selector, span: position, parent,
                            order: slots.filter(slot => slot.owner.id === owner.id).length };
                        slots.push(localFallback);
                    }
                }
                if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate) {
                    const position = map(node.startSourceSpan.start.offset, node.startSourceSpan.end.offset);
                    if (position) {
                        const matches = new Set();
                        matcher.match(selectorFor(context, node), (_selector, id) => { matches.add(id); });
                        const components = [...matches].filter(id => (catalog.declarations.get(id) ?? catalog.external.get(id))?.kind === 'component');
                        const directives = [...matches].filter(id => (catalog.declarations.get(id) ?? catalog.external.get(id))?.kind === 'directive');
                        const directMatches = [...directives];
                        for (const id of [...directives, ...components])
                            for (const host of catalog.declarations.get(id)?.hostDirectives ?? [])
                                directives.push(host);
                        const gaps = [];
                        for (const input of node.inputs) {
                            const text = source.slice(input.sourceSpan.start.offset, input.sourceSpan.end.offset);
                            if (input.type === ng.BindingType.Attribute || text.includes('{{')) {
                                gaps.push(`Dynamic or interpolated attribute ${input.name} is outside static matching`);
                            }
                        }
                        if (components.length > 1)
                            gaps.push(`Ambiguous component selectors: ${components.join(', ')}`);
                        if (components.some(id => id.startsWith('external:')))
                            gaps.push('External component display boundary');
                        for (const id of [...components, ...directMatches]) {
                            const metadata = catalog.declarations.get(id);
                            if (metadata)
                                gaps.push(...metadata.gaps.filter(gap => gap.startsWith('hostDirectives:')));
                        }
                        if (!scope.complete)
                            gaps.push(...scope.reasons);
                        const component = components.length === 1 && scope.complete && !components[0].startsWith('external:') ? components[0] : null;
                        const relativeFile = slash(path.relative(context.workspaceRoot, position.file));
                        const mazeEdge = component && maze?.edges.find(edge => edge.kind === 'template' && edge.from === owner.id &&
                            edge.to === component && edge.location.file === relativeFile && edge.location.line === position.line &&
                            edge.location.column === position.column);
                        if (mazeEdge)
                            matchedMaze.add(mazeEdge);
                        const appliedInputs = new Map();
                        const appliedOutputs = new Map();
                        const addAliases = (id, inputs, outputs) => {
                            for (const [alias, member] of inputs)
                                appliedInputs.set(alias, [...(appliedInputs.get(alias) ?? []), `${id}.${member}`]);
                            for (const [alias, member] of outputs)
                                appliedOutputs.set(alias, [...(appliedOutputs.get(alias) ?? []), `${id}.${member}`]);
                        };
                        for (const id of [...components, ...directMatches]) {
                            const declaration = catalog.declarations.get(id) ?? catalog.external.get(id);
                            if (declaration)
                                addAliases(id, declaration.inputs, declaration.outputs);
                            const local = catalog.declarations.get(id);
                            if (local) {
                                for (const [hostId, aliases] of local.hostDirectiveExposures)
                                    addAliases(hostId, aliases.inputs, aliases.outputs);
                            }
                        }
                        const indexed = {
                            owner, node, tag: node instanceof ng.TmplAstElement ? node.name : node.tagName ?? 'ng-template', span: position,
                            staticAttributes: new Map(node.attributes.map(attribute => [attribute.name, attribute.value])),
                            boundAttributes: node.inputs.map(input => input.name),
                            boundExpressions: new Map(node.inputs.map(input => [input.name,
                                input.valueSpan ? source.slice(input.valueSpan.start.offset, input.valueSpan.end.offset) : ''])),
                            boundSpans: new Map(node.inputs.flatMap(input => {
                                const span = map(input.sourceSpan.start.offset, input.sourceSpan.end.offset);
                                return span ? [[input.name, span]] : [];
                            })),
                            events: node.outputs.map(output => output.name),
                            references: node.references.map(ref => ref.name), repeated, parent, fallbackSlot: localFallback,
                            component, directives: [...new Set(directives)],
                            appliedInputs, appliedOutputs,
                            origin: component ? mazeEdge ? 'ngmaze' : 'ng-wiring' : null, gaps,
                        };
                        elements.push(indexed);
                        ownerElements.push(indexed);
                        current = indexed;
                    }
                }
                const child = node;
                const forLoop = node.constructor.name.includes('ForLoop') ||
                    (node instanceof ng.TmplAstTemplate && node.templateAttrs.some(attribute => attribute.name.startsWith('ngFor')));
                if (child.children)
                    walk(child.children, current, repeated || forLoop, localFallback);
                for (const branch of child.branches ?? [])
                    if (branch.children)
                        walk(branch.children, current, repeated, localFallback);
                for (const branch of child.cases ?? [])
                    if (branch.children)
                        walk(branch.children, current, repeated, localFallback);
                if (child.empty?.children)
                    walk(child.empty.children, current, repeated, localFallback);
                if (child.placeholder?.children)
                    walk(child.placeholder.children, current, repeated, localFallback);
                if (child.loading?.children)
                    walk(child.loading.children, current, repeated, localFallback);
                if (child.error?.children)
                    walk(child.error.children, current, repeated, localFallback);
            }
        };
        walk(parsed.nodes, null, false);
        byOwner.set(owner.id, ownerElements);
    }
    const verifiesOutlet = (edge) => {
        const host = elements.find(element => element.owner.id === edge.from &&
            element.boundSpans.get('ngComponentOutlet')?.line === edge.location.line &&
            element.boundSpans.get('ngComponentOutlet')?.column === edge.location.column &&
            slash(path.relative(context.workspaceRoot, element.span.file)) === edge.location.file &&
            element.boundExpressions.has('ngComponentOutlet'));
        if (!host)
            return false;
        const expression = host.boundExpressions.get('ngComponentOutlet').trim().replace(/^this\./, '');
        const member = host.owner.node.members.find(node => context.toolchain.typescript.isPropertyDeclaration(node) && node.name.getText() === expression);
        const t = context.toolchain.typescript;
        if (!member || !t.isPropertyDeclaration(member) || !member.initializer)
            return false;
        const target = edge.to.slice(edge.to.lastIndexOf('#') + 1);
        const check = (node) => {
            if (t.isIdentifier(node)) {
                let symbol = context.checker.getSymbolAtLocation(node);
                if (symbol?.flags && symbol.flags & t.SymbolFlags.Alias)
                    symbol = context.checker.getAliasedSymbol(symbol);
                if (symbol?.declarations?.some(declaration => t.isClassDeclaration(declaration) &&
                    declaration.name?.text === target &&
                    `${slash(path.relative(context.workspaceRoot, declaration.getSourceFile().fileName))}#${target}` === edge.to))
                    return true;
            }
            return t.forEachChild(node, check) ?? false;
        };
        return check(member.initializer);
    };
    const verifiedMazeEdges = maze?.edges.filter(edge => edge.kind === 'template' ? matchedMaze.has(edge) :
        edge.kind === 'ng-component-outlet' ? verifiesOutlet(edge) : true) ?? [];
    const unmatchedMazeEdges = maze?.edges.filter(edge => !verifiedMazeEdges.includes(edge)) ?? [];
    diagnostics.push(...unmatchedMazeEdges.map(edge => `${edge.from}: ngmaze ${edge.kind} edge to ${edge.to} was not confirmed at ${edge.location.file}:${edge.location.line}`));
    return { elements, slots, byOwner, diagnostics, verifiedMazeEdges, unmatchedMazeEdges };
}
export function matchingElements(index, target) {
    if (target.kind === 'attribute')
        return index.elements.filter(element => element.staticAttributes.get(target.name) === target.value);
    return index.elements.filter(element => path.resolve(element.span.file) === path.resolve(target.file) &&
        element.span.line <= target.line && target.line <= element.span.endLine);
}
