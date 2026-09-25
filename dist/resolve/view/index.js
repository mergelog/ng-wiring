import { resolveOutletPlacement } from './routes.js';
export const defaultViewLimits = { depth: 200, paths: 1_000, states: 100_000 };
function selectorMatches(context, selector, projected) {
    const ng = context.toolchain.angularCompiler;
    const matcher = new ng.SelectorMatcher();
    try {
        matcher.addSelectables(ng.CssSelector.parse(selector), true);
    }
    catch {
        return false;
    }
    const projectedAs = projected.staticAttributes.get('ngProjectAs');
    let candidate;
    if (projectedAs) {
        try {
            candidate = ng.CssSelector.parse(projectedAs)[0];
        }
        catch {
            return false;
        }
    }
    else {
        candidate = new ng.CssSelector();
        candidate.setElement(projected.tag);
        for (const [name, value] of projected.staticAttributes) {
            candidate.addAttribute(name, value);
            if (name === 'class')
                for (const part of value.split(/\s+/).filter(Boolean))
                    candidate.addClassName(part);
        }
        for (const name of projected.boundAttributes)
            candidate.addAttribute(name, '');
    }
    return matcher.match(candidate, null);
}
function slotFor(context, index, host, projected) {
    if (projected.boundAttributes.includes('ngProjectAs'))
        return 'unknown';
    const slots = index.slots.filter(slot => slot.owner.id === host.component).sort((a, b) => a.order - b.order);
    for (const slot of slots)
        if (slot.selector && slot.selector !== '*') {
            try {
                context.toolchain.angularCompiler.CssSelector.parse(slot.selector);
            }
            catch {
                return 'unknown';
            }
        }
    for (const slot of slots)
        if (slot.selector && slot.selector !== '*' && selectorMatches(context, slot.selector, projected))
            return slot;
    return slots.find(slot => !slot.selector || slot.selector === '*') ?? null;
}
function projectionChain(context, index, host, projected, active = new Set()) {
    if (active.has(host))
        return { steps: [], reason: `Projection cycle at ${host.span.file}:${host.span.start}`, unresolved: true };
    active.add(host);
    const slot = slotFor(context, index, host, projected);
    if (slot === 'unknown')
        return { steps: [], reason: `Projection slot is unresolved in ${host.component}`, unresolved: true };
    if (!slot)
        return { steps: [], reason: `Projected content has no matching ng-content slot in ${host.component}`, unresolved: false };
    const projection = step('projection-slot', slot.owner.id, `ng-content${slot.selector ? ` select="${slot.selector}"` : ''}`, slot.span, true, `${host.span.file}:${host.span.start}`);
    projection.expressionOwnerId = projected.owner.id;
    projection.diOwnerId = projected.owner.id;
    projection.displayCondition = 'projection slot visible';
    projection.creationCondition = 'projected view created by declaration owner';
    const steps = [projection];
    for (let ancestor = slot.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.component) {
            const nested = projectionChain(context, index, ancestor, projected, active);
            if (nested.reason)
                return { steps: [...steps, ...nested.steps], reason: nested.reason, unresolved: nested.unresolved };
            steps.push(...nested.steps);
            const use = step('component-use', ancestor.owner.id, `${ancestor.owner.id} uses ${ancestor.component}`, ancestor.span);
            steps.push(use);
        }
        else if (ancestor.tag !== 'ng-container' && ancestor.tag !== 'ng-template') {
            steps.push(step('element', ancestor.owner.id, `<${ancestor.tag}>`, ancestor.span));
        }
    }
    active.delete(host);
    return { steps, reason: null, unresolved: false };
}
function hasProjectedContent(context, index, host, targetSlot) {
    if (index.elements.some(element => element.parent === host && slotFor(context, index, host, element) === targetSlot))
        return true;
    for (const forwarding of index.slots.filter(slot => slot.parent === host)) {
        for (const use of index.elements.filter(element => element.component === forwarding.owner.id)) {
            for (const element of index.elements.filter(item => item.parent === use && slotFor(context, index, use, item) === forwarding)) {
                if (slotFor(context, index, host, element) === targetSlot)
                    return true;
            }
        }
    }
    return false;
}
function step(relation, ownerId, label, span, displayParent = true, insertionContext = null) {
    return { number: '', relation, ownerId, label, span, displayParent, declarationOwnerId: ownerId,
        expressionOwnerId: ownerId, diOwnerId: ownerId, diContextOverride: null,
        displayCondition: null, creationCondition: null, insertionContext, routeRef: null, controlFlow: null };
}
function finalize(steps, end, reason) {
    const numbered = steps.map((item, index) => ({ ...item, number: String(index + 1).padStart(2, '0') }));
    const refs = [];
    const seen = new Set();
    for (const item of steps)
        if (!seen.has(item.declarationOwnerId)) {
            refs.push({ ownerId: item.declarationOwnerId, span: item.span });
            seen.add(item.declarationOwnerId);
        }
    return { steps: numbered, declarationRefs: refs, end, reason };
}
function vcrInsertions(context, ownerId, reference, index) {
    const t = context.toolchain.typescript;
    const owner = index.byOwner.get(ownerId)?.[0]?.owner;
    if (!owner)
        return [];
    const queries = new Map();
    for (const member of owner.node.members) {
        if (!member.name || !t.isIdentifier(member.name))
            continue;
        const calls = [];
        for (const decorator of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
            if (t.isCallExpression(decorator.expression))
                calls.push(decorator.expression);
        }
        if (t.isPropertyDeclaration(member) && member.initializer && t.isCallExpression(member.initializer))
            calls.push(member.initializer);
        for (const call of calls) {
            const callee = t.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
            if (!t.isIdentifier(callee) || !['ViewChild', 'ContentChild', 'viewChild', 'contentChild'].includes(callee.text))
                continue;
            const argument = call.arguments[0];
            if (argument && t.isStringLiteralLike(argument))
                queries.set(member.name.text, argument.text);
        }
    }
    const result = [];
    const visit = (node) => {
        if (t.isCallExpression(node) && t.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createEmbeddedView') {
            const receiver = node.expression.expression;
            const type = context.checker.getTypeAtLocation(receiver);
            const symbol = type.getSymbol();
            const angularVcr = symbol?.getName() === 'ViewContainerRef' && symbol.declarations?.some(d => d.getSourceFile().fileName.includes('/node_modules/@angular/core/'));
            if (angularVcr) {
                const argument = node.arguments[0];
                const name = argument && t.isPropertyAccessExpression(argument) && argument.expression.kind === t.SyntaxKind.ThisKeyword
                    ? queries.get(argument.name.text) : argument && t.isIdentifier(argument) ? queries.get(argument.text) ?? argument.text : undefined;
                if (name === reference) {
                    const source = node.getSourceFile();
                    const start = node.getStart(source);
                    const point = source.getLineAndCharacterOfPosition(start);
                    const containerName = t.isPropertyAccessExpression(receiver) && receiver.expression.kind === t.SyntaxKind.ThisKeyword
                        ? queries.get(receiver.name.text) : undefined;
                    const containers = containerName ? (index.byOwner.get(ownerId) ?? []).filter(item => item.references.includes(containerName)) : [];
                    result.push({ span: { file: source.fileName, start, end: node.getEnd(), line: point.line + 1,
                            endLine: source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1, column: point.character + 1 },
                        container: containers.length === 1 ? containers[0] : null });
                }
            }
        }
        t.forEachChild(node, visit);
    };
    visit(owner.node);
    return result;
}
function templateAliases(context, ownerId, reference, index) {
    const aliases = new Set([reference]);
    const owner = index.byOwner.get(ownerId)?.[0]?.owner;
    if (!owner)
        return aliases;
    const t = context.toolchain.typescript;
    for (const member of owner.node.members) {
        if (!member.name || !t.isIdentifier(member.name))
            continue;
        const calls = [];
        for (const decorator of t.canHaveDecorators(member) ? t.getDecorators(member) ?? [] : []) {
            if (t.isCallExpression(decorator.expression))
                calls.push(decorator.expression);
        }
        if (t.isPropertyDeclaration(member) && member.initializer && t.isCallExpression(member.initializer))
            calls.push(member.initializer);
        for (const call of calls) {
            const name = t.isPropertyAccessExpression(call.expression) ? call.expression.name.text :
                t.isIdentifier(call.expression) ? call.expression.text : '';
            if (!['ViewChild', 'ContentChild', 'viewChild', 'contentChild'].includes(name))
                continue;
            if (call.arguments[0] && t.isStringLiteralLike(call.arguments[0]) && call.arguments[0].text === reference)
                aliases.add(member.name.text);
        }
    }
    const assignments = [];
    const visit = (node) => {
        if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.EqualsToken &&
            t.isPropertyAccessExpression(node.left) && node.left.expression.kind === t.SyntaxKind.ThisKeyword) {
            const right = t.isPropertyAccessExpression(node.right) && node.right.expression.kind === t.SyntaxKind.ThisKeyword
                ? node.right.name.text : t.isIdentifier(node.right) ? node.right.text : undefined;
            if (right)
                assignments.push({ left: node.left.name.text, right });
        }
        t.forEachChild(node, visit);
    };
    visit(owner.node);
    for (let i = 0; i < assignments.length; i++)
        for (const assignment of assignments) {
            if (aliases.has(assignment.right))
                aliases.add(assignment.left);
        }
    return aliases;
}
function routeStepFor(occurrence, ownerId) {
    const name = occurrence.outlet ? ` name="${occurrence.outlet}"` : '';
    const placement = step('route-outlet', ownerId, `route ${occurrence.pattern} places ${ownerId} in <router-outlet${name}>`, occurrence.definition, true, occurrence.id);
    placement.creationCondition = 'route activation';
    placement.displayCondition = occurrence.conditions.map(condition => condition.text).join('; ') || 'route matches the URL';
    placement.routeRef = { occurrenceId: occurrence.id, pattern: occurrence.pattern, outlet: occurrence.outlet,
        definition: occurrence.definition, anchor: occurrence.anchor, loaders: occurrence.loaders, rooted: occurrence.rooted };
    return placement;
}
/** Frames introduced between an element and its display parent, outermost first. */
function ownControlFlow(element) {
    const outer = element.parent?.controlFlow ?? [];
    let shared = 0;
    while (shared < outer.length && shared < element.controlFlow.length && outer[shared] === element.controlFlow[shared])
        shared++;
    return element.controlFlow.slice(shared);
}
function controlFlowSteps(element) {
    const created = {
        if: 'embedded view created while this branch is selected',
        for: 'one embedded view per item; individual rows are not identified',
        'for-empty': 'embedded view created while the collection is empty',
        switch: 'embedded view created while this case is selected',
        defer: 'deferred view created for this phase',
    };
    // Innermost first: steps run from the element towards the root.
    return ownControlFlow(element).reverse().map(frame => {
        const item = step('control-flow', element.owner.id, frame.label, frame.span, false);
        item.displayCondition = [frame.condition, ...frame.notes].join('; ');
        item.creationCondition = frame.phase && frame.phase !== 'main'
            ? `${frame.phase} view created for ${frame.defer?.id ?? 'the @defer block'}` : created[frame.kind];
        item.controlFlow = frame;
        return item;
    });
}
/** §6.3 cycle key: no growing ancestor array, and the same class at another use stays distinct. */
function cycleKey(context, element, relation, insertion) {
    return [context.id, element.owner.id, `${element.span.file}:${element.span.start}-${element.span.end}`,
        relation, insertion].join('|');
}
export function resolveViewPaths(target, context, catalog, index, limit = {}, maze, routes) {
    const limits = { ...defaultViewLimits, ...typeof limit === 'number' ? { paths: limit } : limit };
    const report = { ...limits, depthStops: 0, pathStops: 0, stateStops: 0, unexplored: 0 };
    const diagnostics = [];
    const paths = [];
    const stack = [{ current: target, steps: [], keys: new Set(), depth: 0, routeIds: new Set(),
            relation: 'element', insertion: 'none' }];
    let states = 0;
    const stop = (kind, state, reason) => {
        report[`${kind === 'depth' ? 'depth' : kind === 'paths' ? 'path' : 'state'}Stops`]++;
        diagnostics.push(reason);
        paths.push(finalize(state.steps, 'limit', reason));
    };
    while (stack.length) {
        const state = stack.pop();
        const current = state.current;
        const where = `${current.owner.id} at ${current.span.file}:${current.span.line}`;
        if (states >= limits.states) {
            report.unexplored += stack.length + 1;
            stop('states', state, `View expansion stopped after ${limits.states} states at ${where}; ${stack.length + 1} branches were not enumerated`);
            break;
        }
        states++;
        const key = cycleKey(context, current, state.relation, state.insertion);
        if (state.keys.has(key)) {
            // The boundary is reported once; the other non-cyclic branches keep being enumerated (§6.3).
            paths.push(finalize(state.steps, 'cycle', `Recursion boundary: ${where} is re-entered through ${state.relation}`));
            continue;
        }
        if (state.depth >= limits.depth) {
            report.unexplored += 1;
            stop('depth', state, `Parent path depth limit ${limits.depth} reached at ${where}`);
            continue;
        }
        if (paths.length >= limits.paths) {
            report.unexplored += stack.length + 1;
            stop('paths', state, `Candidate limit ${limits.paths} reached at ${where}; ${stack.length + 1} branches were not enumerated`);
            break;
        }
        const keys = new Set(state.keys);
        keys.add(key);
        const routeIds = state.routeIds;
        const insertion = state.insertion;
        const steps = [...state.steps];
        // A routed component is a sibling of its <router-outlet> anchor, so the anchor is not a display ancestor.
        if (!state.anchor && current.tag !== 'ng-container' && current.tag !== 'ng-template') {
            const entry = step('element', current.owner.id, `<${current.tag}>`, current.span);
            if (current.repeated)
                entry.displayCondition = '@for iteration exists; individual row is not identified';
            steps.push(entry);
        }
        steps.push(...controlFlowSteps(current));
        if (current.parent) {
            const parent = current.parent;
            if (parent.component) {
                let projected = current;
                while (projected.parent && projected.parent !== parent)
                    projected = projected.parent;
                const chain = projectionChain(context, index, parent, projected);
                if (chain.reason) {
                    const reason = chain.reason;
                    diagnostics.push(reason);
                    paths.push(finalize(steps, chain.unresolved ? 'projection-unresolved' : 'unrendered', reason));
                    continue;
                }
                stack.push({ current: parent, steps: [...steps, ...chain.steps], keys, depth: state.depth + 1, routeIds,
                    relation: 'projection-slot', insertion: `${parent.span.file}:${parent.span.start}` });
                continue;
            }
            if (parent.node.constructor.name === 'Template') {
                const isExplicit = parent.tag === 'ng-template';
                if (isExplicit) {
                    const reference = parent.references[0];
                    const aliases = reference ? templateAliases(context, parent.owner.id, reference, index) : new Set();
                    const directInsertions = reference ? (index.byOwner.get(parent.owner.id) ?? []).filter(element => {
                        const expression = element.boundExpressions.get('ngTemplateOutlet')?.trim().replace(/^this\./, '');
                        return expression !== undefined && aliases.has(expression);
                    }) : [];
                    const crossInsertions = [];
                    if (reference)
                        for (const use of index.byOwner.get(parent.owner.id) ?? []) {
                            if (!use.component)
                                continue;
                            const child = catalog.declarations.get(use.component);
                            if (!child)
                                continue;
                            for (const [alias, expression] of use.boundExpressions) {
                                if (expression.trim() !== reference)
                                    continue;
                                const member = child.inputs.get(alias);
                                if (!member)
                                    continue;
                                crossInsertions.push(...(index.byOwner.get(child.id) ?? []).filter(element => [member, `this.${member}`].includes(element.boundExpressions.get('ngTemplateOutlet')?.trim() ?? '')));
                            }
                        }
                    const insertions = [...new Set([...directInsertions, ...crossInsertions])];
                    const vcr = reference ? vcrInsertions(context, parent.owner.id, reference, index) : [];
                    if (!insertions.length && !vcr.length) {
                        const reason = `TemplateRef ${reference ?? '(unnamed)'} has no confirmed insertion`;
                        diagnostics.push(reason);
                        paths.push(finalize([...steps, step('fragment-declaration', parent.owner.id, 'ng-template', parent.span, false)], 'fragment-uninstantiated', reason));
                        continue;
                    }
                    for (const insertion of insertions) {
                        const fragment = step('fragment-declaration', parent.owner.id, `#${reference}`, parent.span, false);
                        const variables = parent.node.variables ?? [];
                        const placement = step('template-insertion', insertion.owner.id, `NgTemplateOutlet(${reference})`, insertion.span, true, `${insertion.span.file}:${insertion.span.start}`);
                        placement.expressionOwnerId = parent.owner.id;
                        placement.diOwnerId = parent.owner.id;
                        placement.diContextOverride = insertion.boundExpressions.get('ngTemplateOutletInjector') ?? null;
                        placement.displayCondition = 'NgTemplateOutlet creates embedded view';
                        placement.creationCondition = 'fragment declaration exists';
                        placement.insertionContext = variables.length ? `${variables.map(variable => `${variable.name}<-${variable.value || '$implicit'}`).join(', ')}; ${insertion.boundExpressions.get('ngTemplateOutletContext') ?? 'context unknown'}` :
                            insertion.boundExpressions.get('ngTemplateOutletContext') ?? null;
                        if (placement.diContextOverride)
                            diagnostics.push(`DI context overridden at ${insertion.span.file}:${insertion.span.line}`);
                        stack.push({ current: insertion, steps: [...steps, fragment, placement], keys, depth: state.depth + 1, routeIds,
                            relation: 'template-insertion', insertion: `${insertion.span.file}:${insertion.span.start}` });
                    }
                    for (const insertion of vcr) {
                        const fragment = step('fragment-declaration', parent.owner.id, `#${reference}`, parent.span, false);
                        const placement = step('template-insertion', parent.owner.id, `ViewContainerRef.createEmbeddedView(#${reference})`, insertion.span, !!insertion.container, `${insertion.span.file}:${insertion.span.start}`);
                        placement.displayCondition = 'createEmbeddedView call executes';
                        placement.creationCondition = 'fragment declaration exists';
                        if (insertion.container)
                            stack.push({ current: insertion.container, steps: [...steps, fragment, placement], keys,
                                depth: state.depth + 1, routeIds, relation: 'template-insertion',
                                insertion: `${insertion.span.file}:${insertion.span.start}` });
                        else
                            paths.push(finalize([...steps, fragment, placement], 'dynamic-boundary', 'ViewContainerRef location is unresolved'));
                    }
                    continue;
                }
                const template = parent.node;
                const knownStructural = template.templateAttrs?.some(attr => ['ngIf', 'ngFor', 'ngForOf', 'ngSwitchCase', 'ngSwitchDefault'].includes(attr.name));
                if (!knownStructural) {
                    const reason = `Custom structural directive insertion is unresolved at ${parent.span.file}:${parent.span.line}`;
                    diagnostics.push(reason);
                    paths.push(finalize(steps, 'fragment-uninstantiated', reason));
                    continue;
                }
                const structural = step('structural-view', parent.owner.id, `*${parent.tag}`, parent.span, false);
                structural.displayCondition = [...parent.boundAttributes, ...(template.templateAttrs ?? []).map(attr => attr.name)].join(', ');
                steps.push(structural);
                stack.push({ current: parent, steps, keys, depth: state.depth + 1, routeIds,
                    relation: 'structural-view', insertion });
                continue;
            }
            stack.push({ current: parent, steps, keys, depth: state.depth + 1, routeIds, relation: 'element', insertion });
            continue;
        }
        const uses = index.elements.filter(element => element.component === current.owner.id);
        const dynamic = maze?.edges.filter(edge => edge.to === current.owner.id && edge.kind !== 'template') ?? [];
        for (const edge of dynamic) {
            const relation = step('dynamic-creation', edge.from, `${edge.kind} creates ${edge.to}`, null, false);
            relation.creationCondition = 'runtime creation call executes';
            relation.displayCondition = 'render container or overlay parent unresolved';
            paths.push(finalize([...steps, relation], 'dynamic-boundary', `Dynamic display container is not confirmed for ${edge.to}`));
        }
        const external = maze?.externalUsages.filter(usage => usage.target === current.owner.id) ?? [];
        for (const usage of external) {
            const relation = step('dynamic-creation', `external:${usage.callerName}`, `${usage.kind} creates ${usage.target}`, null, false);
            relation.creationCondition = 'external caller executes';
            relation.displayCondition = 'external library wrapper and display container unresolved';
            paths.push(finalize([...steps, relation], 'dynamic-boundary', `External caller ${usage.callerName} is a display boundary`));
        }
        const occurrences = routes?.byComponent.get(current.owner.id) ?? [];
        for (const occurrence of occurrences) {
            if (routeIds.has(occurrence.id)) {
                paths.push(finalize([...steps, routeStepFor(occurrence, current.owner.id)], 'cycle', `Route cycle at ${occurrence.pattern}`));
                continue;
            }
            for (const placement of resolveOutletPlacement(context, routes, index, occurrence)) {
                const entry = routeStepFor(occurrence, current.owner.id);
                if (placement.kind === 'unresolved') {
                    diagnostics.push(placement.reason);
                    paths.push(finalize([...steps, entry], 'route-unresolved', placement.reason));
                    continue;
                }
                entry.ownerId = placement.hostId;
                entry.declarationOwnerId = placement.hostId;
                entry.expressionOwnerId = current.owner.id;
                entry.diOwnerId = current.owner.id;
                if (placement.conditions.length)
                    entry.displayCondition = `${entry.displayCondition}; ${placement.conditions.join('; ')}`;
                stack.push({ current: placement.element, steps: [...steps, entry], keys,
                    depth: state.depth + 1, routeIds: new Set([...routeIds, occurrence.id]), anchor: true,
                    relation: 'route-outlet', insertion: occurrence.id });
            }
        }
        const bootstraps = routes?.bootstrapByComponent.get(current.owner.id) ?? [];
        for (const bootstrap of bootstraps) {
            const entry = step('bootstrap', bootstrap.id, `${bootstrap.id} bootstraps ${current.owner.id}`, bootstrap.span, false);
            entry.creationCondition = 'application bootstrap';
            entry.displayCondition = `${bootstrap.kind === 'module' ? 'bootstrapModule' : 'bootstrapApplication'} runs for entry ${bootstrap.entry}`;
            paths.push(finalize([...steps, entry], 'bootstrap', `Bootstrapped from ${bootstrap.entry}`));
        }
        if (!uses.length) {
            if (dynamic.length || external.length || occurrences.length || bootstraps.length)
                continue;
            const declaration = catalog.declarations.get(current.owner.id);
            const reason = declaration ? `No confirmed display use for ${current.owner.id}` : `Unknown declaration ${current.owner.id}`;
            paths.push(finalize(steps, 'root-unresolved', reason));
            continue;
        }
        let fallbackVisible = false;
        for (const use of uses) {
            if (target.fallbackSlot) {
                if (hasProjectedContent(context, index, use, target.fallbackSlot))
                    continue;
                fallbackVisible = true;
            }
            const relation = step('component-use', use.owner.id, `${use.owner.id} uses ${current.owner.id}`, use.span);
            relation.expressionOwnerId = use.owner.id;
            relation.diOwnerId = use.owner.id;
            if (target.fallbackSlot)
                relation.displayCondition = 'ng-content fallback when no projected content matches';
            stack.push({ current: use, steps: [...steps, relation], keys, depth: state.depth + 1, routeIds,
                relation: 'component-use', insertion });
        }
        if (target.fallbackSlot && !fallbackVisible) {
            const reason = `ng-content fallback is suppressed by projected content in ${current.owner.id}`;
            diagnostics.push(reason);
            paths.push(finalize(steps, 'unrendered', reason));
        }
    }
    if (!paths.length)
        paths.push(finalize([], 'root-unresolved', 'No display path'));
    return { paths, diagnostics, limits: report };
}
