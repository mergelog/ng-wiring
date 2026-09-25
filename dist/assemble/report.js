import path from 'node:path';
import { classMethod } from '../index/catalog.js';
import { resolveEventListeners } from '../resolve/operation/events.js';
import { componentInjectorLayers } from '../resolve/operation/di.js';
import { analyzeStore, storeInputsForSelection } from '../resolve/operation/store.js';
import { traceStoreDispatch } from '../resolve/operation/store-flow.js';
import { traceOperation } from '../resolve/operation/flow.js';
import { analyzeHttp } from '../resolve/operation/http.js';
import { traceHttpFromEffect, traceHttpFromEventConsumer, traceHttpFromMethod } from '../resolve/operation/http-flow.js';
import { resolveElementBindings } from '../resolve/operation/bindings.js';
import { resolveTemplateExpressions } from '../resolve/operation/expressions.js';
import { analyzeSignals } from '../adapters/reactive/signals.js';
import { catalogSignalStores } from '../adapters/reactive/signal-store.js';
import { analyzeEvents, resolveEventDelivery } from '../adapters/reactive/events.js';
import { analyzeReactiveMethods } from '../adapters/reactive/methods.js';
import { eventDeliverySteps } from '../adapters/reactive/delivery.js';
import { unsupportedImports } from '../adapters/reactive/capabilities.js';
import { NGMAZE_REVISION } from '../adapters/ng-maze/index.js';
import { ConditionTable } from '../model/conditions.js';
import { ReportBuilder, localIsoString } from '../model/report.js';
import { slash } from '../model/ids.js';
import { detail, edgeContracts, unresolvedDetail } from '../model/types.js';
import { SourceEvidence } from './evidence.js';
import { downwardEdgeKind, placeSteps } from './view-path.js';
import { findPatchStateCalls, templateReads } from './reactive-calls.js';
import { completeDetails, httpTraceEdges, operationTraceEdges, reactiveStepEdges, storeTraceEdges } from './steps.js';
const handlerMethod = (handler, inputs) => {
    const direct = /^\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*$/.exec(handler);
    if (direct)
        return direct[1];
    const guarded = /^\s*.+\s+&&\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*$/.exec(handler);
    if (guarded)
        return guarded[1];
    // An input signal used as a simple template ternary can be decided only at this component use.
    // Other expressions remain unresolved; guessing one arm would claim an operation that may not run.
    const branch = /^\s*(?:this\.)?([A-Za-z_$][\w$]*)\(\)\s*\?\s*(?:this\.)?([A-Za-z_$][\w$]*)\([^)]*\)\s*:\s*(?:this\.)?([A-Za-z_$][\w$]*)\([^)]*\)\s*$/.exec(handler);
    if (!branch)
        return null;
    const value = inputs.get(branch[1]);
    return value === 'true' ? branch[2] : value === 'false' ? branch[3] : null;
};
const handlerGuard = (handler) => {
    const guarded = /^\s*(.+)\s+&&\s*(?:this\.)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*$/.exec(handler);
    return guarded?.[1]?.trim() ?? null;
};
const allowed = (kind, from, to) => edgeContracts[kind].from.includes(from) && edgeContracts[kind].to.includes(to);
/**
 * §5 the assembly: the analysis layers are normalized into the one model both renderers read. Nothing
 * here decides confidence, coverage or ids on its own; the `ReportBuilder` does that from what is added.
 */
export function assembleReport(input) {
    const { analysis, selected, options } = input;
    const { context, catalog, index, routes, maze } = analysis;
    const evidence = new SourceEvidence(context);
    const conditions = new ConditionTable();
    const relative = (file) => slash(path.relative(context.workspaceRoot, file));
    const problems = [];
    const reportContext = {
        id: context.id, workspaceRoot: context.workspaceRoot, projectName: context.projectName,
        projectType: context.projectType, tsconfig: relative(context.tsconfig), configHash: context.configHash,
        strictNullChecks: context.compilerOptions.strictNullChecks ?? context.compilerOptions.strict ?? false,
        toolchain: { typescript: context.toolchain.ts.version, angularCompiler: context.toolchain.compiler.version,
            ngmaze: maze ? NGMAZE_REVISION : '未取得' },
        entry: context.entry.map(relative), entryUnknown: context.entryUnknown,
        excluded: context.gaps.filter(gap => gap.startsWith('Excluded source') || gap.startsWith('Linked source')),
        unapplied: context.unapplied,
    };
    const query = {
        raw: options.target.raw,
        target: options.target.kind === 'attribute'
            ? { kind: 'attribute', name: options.target.name, value: options.target.value }
            : { kind: 'source', file: slash(options.target.file), line: options.target.line },
        filters: { project: options.project ?? null, tsconfig: options.tsconfig ?? null,
            through: options.through ?? null, route: options.route ?? null,
            ...(options.selector ? { selector: options.selector } : {}),
            candidate: options.candidate ?? null,
            event: options.event ?? null },
        candidates: input.candidates.map(item => summarize(item)),
        enumerationComplete: input.enumerationComplete,
    };
    const builder = new ReportBuilder({ toolVersion: input.toolVersion, snapshotId: context.snapshot.id,
        generatedAt: localIsoString(input.startedAt), context: reportContext, query, evidence: evidence.table, conditions });
    const spanOf = (span) => ({ file: relative(span.file), start: span.start, end: span.end });
    const elementAt = (step) => step.span
        ? index.elements.find(item => item.owner.id === step.ownerId && item.span.file === step.span.file &&
            item.span.start === step.span.start)
        : undefined;
    const declarationNode = (id, kind = 'component', extra = []) => {
        const declaration = catalog.declarations.get(id);
        // The declaration site itself is the evidence; a use site only stands in when there is no class.
        const own = declaration ? [evidence.declaration(declaration.node, id)] : [];
        const ids = (own.some(item => item) ? own : extra).filter((item) => !!item);
        return builder.definition({ kind, symbolId: id, evidenceIds: ids, details: { name: detail(id) } });
    };
    // ---- display path -------------------------------------------------------------------------------
    const placed = placeSteps(selected.path, elementAt);
    const nodeIds = [];
    const pathEdgeIds = [];
    const declarationIds = new Set();
    const routeNodeIds = [];
    let bootstrapNodeId = null;
    const stepEvidence = (step) => {
        const own = evidence.span(step.span, 'exact');
        if (own)
            return [own];
        const fromMaze = mazeEvidenceFor(step);
        return fromMaze ? [fromMaze] : [];
    };
    function mazeEvidenceFor(step) {
        if (step.relation !== 'dynamic-creation' || !maze)
            return null;
        const edge = maze.edges.find(item => item.from === step.ownerId && `${item.kind} creates ${item.to}` === step.label);
        const usage = maze.externalUsages.find(item => `external:${item.callerName}` === step.ownerId &&
            `${item.kind} creates ${item.target}` === step.label);
        const at = edge?.location ?? usage?.location;
        return at ? evidence.location(`${at.file}:${at.line}:${at.column}`) : null;
    }
    const stepCondition = (step, evidenceId) => {
        const parts = [];
        const scope = step.ownerId;
        if (evidenceId) {
            if (step.displayCondition)
                parts.push(conditions.predicate({ expression: step.displayCondition, scope, evidenceId }));
            if (step.creationCondition)
                parts.push(conditions.predicate({ expression: step.creationCondition, scope, evidenceId }));
        }
        if (step.routeRef)
            parts.push(conditions.phase({ phase: 'route-activation', detail: step.routeRef.pattern, evidenceId: evidenceId ?? null }));
        if (step.controlFlow?.phase && step.controlFlow.phase !== 'main') {
            parts.push(conditions.phase({ phase: 'defer', detail: step.controlFlow.phase, evidenceId: evidenceId ?? null }));
        }
        return parts.length ? conditions.all(parts) : null;
    };
    // §8 the section heading names the component or element at the use site, not the relation sentence.
    const labelFor = (item) => {
        if (item.componentId)
            return item.componentId.slice(item.componentId.lastIndexOf('#') + 1);
        if (item.element)
            return `<${item.element.tag}>`;
        if (item.step.relation === 'route-outlet')
            return `route ${item.step.routeRef?.pattern ?? '(不明)'}`;
        if (item.step.relation === 'bootstrap') {
            const found = routes.bootstraps.find(entry => entry.id === item.step.ownerId);
            return found ? `${found.kind === 'module' ? 'bootstrapModule' : 'bootstrapApplication'}(${relative(found.span.file)})` : item.step.ownerId;
        }
        return item.step.label;
    };
    const nodeOf = (item) => {
        const evidenceIds = stepEvidence(item.step);
        const definitionId = item.componentId ? declarationNode(item.componentId) : null;
        if (definitionId)
            declarationIds.add(definitionId);
        const id = builder.occurrence({
            kind: item.kind,
            key: { ownerId: item.step.ownerId, definitionId, span: item.step.span ? spanOf(item.step.span) : null,
                insertion: item.step.insertionContext, projection: item.step.relation === 'projection-slot' ? item.step.label : null,
                route: item.step.routeRef?.occurrenceId ?? null },
            evidenceIds,
            details: { label: detail(labelFor(item)), relation: detail(item.step.relation),
                sentence: detail(item.step.label) },
        });
        return { id, evidenceIds };
    };
    const built = placed.map(item => ({ placed: item, ...nodeOf(item) }));
    for (const item of built) {
        nodeIds.push(item.id);
        if (item.placed.kind === 'route')
            routeNodeIds.push(item.id);
        if (item.placed.kind === 'application')
            bootstrapNodeId = item.id;
        declarationIds.add(declarationNode(item.placed.step.declarationOwnerId, item.placed.kind === 'application' ? 'application' : 'component', item.evidenceIds));
    }
    const connect = (input2) => {
        if (!input2.evidenceIds.length) {
            problems.push(`${input2.kind} の辺にソース根拠が無いため出力しない`);
            return null;
        }
        let kind = input2.kind;
        if (!allowed(kind, input2.fromKind, input2.toKind)) {
            if (allowed('display-parent', input2.fromKind, input2.toKind))
                kind = 'display-parent';
            else {
                problems.push(`${input2.kind} は ${input2.fromKind}→${input2.toKind} を接続できない`);
                return null;
            }
        }
        const details = kind === input2.kind ? input2.details : { parent: input2.details.parent ?? detail(input2.from), child: input2.details.child ?? detail(input2.to) };
        for (const key of edgeContracts[kind].details)
            details[key] ??= unresolvedDetail(`${key} は組み立てが記録していない`);
        return builder.edge({ kind, from: input2.from, to: input2.to, evidenceIds: input2.evidenceIds,
            confidence: input2.conditionId ? 'conditional' : 'confirmed', origin: input2.origin ?? 'ng-wiring',
            conditionId: input2.conditionId, details });
    };
    for (let at = 1; at < built.length; at++) {
        const parent = built[at], child = built[at - 1];
        const step = parent.placed.step;
        const evidenceIds = parent.evidenceIds.length ? parent.evidenceIds : child.evidenceIds;
        const conditionId = stepCondition(step, evidenceIds[0]);
        const parentLabel = labelFor(parent.placed);
        let childLabel = labelFor(child.placed);
        const preferred = downwardEdgeKind[step.relation];
        let toId = child.id, toKind = child.placed.kind;
        // §6.2 a routed component is a sibling of its <router-outlet> anchor: the element that holds the
        // outlet is the display parent of what the route placed, and the route node is not in that chain.
        if (preferred === 'display-parent' && child.placed.kind === 'route') {
            let cursor = at - 1;
            while (cursor >= 0 && built[cursor].placed.kind === 'route')
                cursor--;
            const routed = built[cursor];
            if (routed) {
                toId = routed.id;
                toKind = routed.placed.kind;
                childLabel = labelFor(routed.placed);
            }
        }
        if (preferred === 'bootstrap' || preferred === 'dynamic-create') {
            toId = declarationNode(child.placed.step.ownerId);
            toKind = 'component';
            declarationIds.add(toId);
        }
        const details = preferred === 'projection'
            ? { child: detail(childLabel), host: detail(step.ownerId), slot: detail(parentLabel) }
            : preferred === 'view-insertion'
                ? { fragment: detail(childLabel), declarer: detail(child.placed.step.ownerId), insertion: detail(parentLabel) }
                : preferred === 'route-outlet'
                    ? { route: detail(step.routeRef?.pattern ?? parentLabel), component: detail(child.placed.step.ownerId),
                        outlet: step.routeRef?.outlet ? detail(step.routeRef.outlet) : unresolvedDetail('名前付き outlet の指定なし（primary）') }
                    : preferred === 'bootstrap'
                        ? { application: detail(step.ownerId), component: detail(child.placed.step.ownerId) }
                        : preferred === 'dynamic-create'
                            ? { caller: detail(step.ownerId), component: detail(child.placed.step.ownerId),
                                container: unresolvedDetail('表示コンテナを確定できていない') }
                            : { parent: detail(parentLabel), child: detail(childLabel) };
        const edgeId = connect({ kind: preferred, from: parent.id, fromKind: parent.placed.kind, to: toId, toKind,
            evidenceIds, conditionId, details,
            origin: preferred === 'dynamic-create' && maze ? 'ngmaze-verified' : 'ng-wiring' });
        if (edgeId)
            pathEdgeIds.push(edgeId);
        // §8 a bootstrapped component is still the display parent of what its template renders.
        if (preferred === 'bootstrap') {
            const display = connect({ kind: 'display-parent', from: parent.id, fromKind: parent.placed.kind,
                to: child.id, toKind: child.placed.kind, evidenceIds, conditionId,
                details: { parent: detail(parentLabel), child: detail(childLabel) } });
            if (display)
                pathEdgeIds.push(display);
        }
    }
    // §8 the owner's template declaring the child it uses, and every directive applied at that use site.
    for (const item of built) {
        const element = item.placed.element;
        if (!element || !item.evidenceIds.length)
            continue;
        const owner = declarationNode(item.placed.step.ownerId);
        const location = `${relative(element.span.file)}:${element.span.line}`;
        if (item.placed.componentId) {
            const used = connect({ kind: 'template-use', from: owner, fromKind: 'component', to: item.id,
                toKind: item.placed.kind, evidenceIds: item.evidenceIds, conditionId: null,
                details: { owner: detail(item.placed.step.ownerId), child: detail(item.placed.componentId),
                    occurrence: detail(item.id), location: detail(location) },
                origin: element.origin === 'ngmaze' ? 'ngmaze-verified' : 'ng-wiring' });
            if (used)
                pathEdgeIds.push(used);
        }
        for (const directiveId of element.directives) {
            const directive = builder.occurrence({ kind: 'directive',
                key: { ownerId: item.placed.step.ownerId, definitionId: declarationNode(directiveId, 'directive'),
                    span: spanOf(element.span), insertion: item.placed.step.insertionContext, projection: null, route: null },
                evidenceIds: item.evidenceIds, details: { label: detail(directiveId) } });
            connect({ kind: 'template-use', from: owner, fromKind: 'component', to: directive, toKind: 'directive',
                evidenceIds: item.evidenceIds, conditionId: null,
                details: { owner: detail(item.placed.step.ownerId), child: detail(directiveId),
                    occurrence: detail(directive), location: detail(location) } });
        }
    }
    // §5 a path that stopped short ends at a boundary node instead of an invented parent.
    const lastNode = built.at(-1);
    if (selected.path.end !== 'bootstrap' && selected.path.end !== 'unrendered' && lastNode) {
        const boundary = builder.boundary({ reason: selected.path.reason,
            lastConfirmed: lastNode.placed.step.ownerId, evidenceIds: lastNode.evidenceIds });
        const edgeId = connect({ kind: 'boundary', from: lastNode.id, fromKind: lastNode.placed.kind, to: boundary,
            toKind: 'boundary', evidenceIds: lastNode.evidenceIds, conditionId: null,
            details: { reason: detail(selected.path.reason), lastConfirmed: detail(lastNode.placed.step.ownerId) } });
        if (edgeId) {
            nodeIds.push(boundary);
            pathEdgeIds.push(edgeId);
        }
    }
    const pathId = builder.path({ occurrenceIds: nodeIds, edgeIds: pathEdgeIds,
        declarationIds: [...declarationIds], end: selected.path.end, endReason: selected.path.reason });
    // ---- operations ---------------------------------------------------------------------------------
    const target = built[0];
    const targetElement = target?.placed.element ??
        index.elements.find(item => item.owner.id === selected.candidate.tuple.ownerId &&
            relative(item.span.file) === selected.candidate.tuple.element.path &&
            item.span.start === selected.candidate.tuple.element.start);
    const stores = catalogSignalStores(context);
    const operationIds = [];
    const resolvedGaps = [];
    if (target && targetElement) {
        addOperations({ analysis, builder, evidence, conditions, connect, declarationNode, relative, spanOf,
            targetElement, targetNodeId: target.id, targetKind: target.placed.kind, placed,
            viewPath: selected.path, options, operationIds, problems, resolvedGaps, stores });
    }
    // ---- background inputs --------------------------------------------------------------------------
    // §8 what enters the components of this path from outside the selected operation: the input bindings
    // written at each use site. They are neither a display step nor a consequence of the event, so they
    // stay outside the path and the operations and are reported as background inputs.
    for (const item of built) {
        const element = item.placed.element;
        if (!element || !item.evidenceIds.length)
            continue;
        const resolution = resolveElementBindings(element, context, catalog);
        for (const relation of resolution.relations) {
            if (relation.kind === 'output-subscription')
                continue;
            const evidenceIds = [evidence.span(relation.span ?? element.span, 'exact')]
                .filter((entry) => !!entry);
            if (!evidenceIds.length)
                continue;
            if (!relation.targetId) {
                problems.push(`${relation.alias} の束縛先を確定できていない`);
                continue;
            }
            // The receiving member is the end of the binding, so two inputs of one component stay apart.
            const member = relation.member ?? relation.alias;
            const to = builder.definition({ kind: 'symbol', symbolId: `${relation.targetId}.${member}`,
                evidenceIds, details: { name: detail(member), label: detail(member) } });
            const predicates = relation.conditions.map(text => conditions.predicate({ expression: text, scope: item.placed.step.ownerId, evidenceId: evidenceIds[0] }));
            connect({ kind: 'input-binding', from: item.id, fromKind: item.placed.kind, to, toKind: 'symbol',
                evidenceIds, conditionId: predicates.length ? conditions.all(predicates) : null,
                details: { expression: detail(relation.expression), owner: detail(item.placed.step.ownerId),
                    input: detail(`${relation.alias} → ${relation.targetId}.${member}`) } });
        }
        for (const message of resolution.diagnostics) {
            builder.diagnostic({ code: 'input-binding', severity: 'info', message });
        }
    }
    // ---- diagnostics, gaps and limits ---------------------------------------------------------------
    const scopeOwners = new Set([selected.candidate.tuple.ownerId, ...selected.candidate.parentIds,
        ...placed.map(item => item.step.ownerId), ...placed.map(item => item.step.declarationOwnerId)]);
    const scopeFiles = new Set();
    for (const owner of scopeOwners) {
        const file = owner.includes('#') ? owner.slice(0, owner.indexOf('#')) : owner;
        if (file)
            scopeFiles.add(file);
    }
    // §8 the routes, directives and services of this selection are part of where a gap counts as local.
    for (const item of placed) {
        const occurrence = item.step.routeRef && routes.byId.get(item.step.routeRef.occurrenceId);
        if (occurrence)
            scopeFiles.add(relative(occurrence.definition.file));
        for (const directiveId of item.element?.directives ?? [])
            scopeFiles.add(directiveId.slice(0, directiveId.indexOf('#')));
    }
    // A generated Store one of these components injects is a service of this selection.
    for (const instance of stores.instances) {
        if (![...scopeOwners].some(owner => sameOwnerId(owner, instance.owner)))
            continue;
        const declaration = stores.declarations.get(instance.declarationId);
        if (declaration)
            scopeFiles.add(declaration.source.slice(0, declaration.source.indexOf(':')));
    }
    const sourceGaps = addDiagnostics({ analysis, builder, evidence, relative, scopeFiles, problems, stores });
    const incomplete = [
        ...analysis.mazeProblems.map(reason => ({ reason })),
        ...catalog.gaps.map(reason => ({ reason })),
        ...index.unsupported.map(item => ({ reason: `${item.kind}: ${item.reason}`, owner: item.ownerId,
            file: item.span ? relative(item.span.file) : null })),
    ];
    const rawGaps = [...collectGaps({ analysis, evidence, relative, stores }), ...sourceGaps, ...resolvedGaps];
    const placedGaps = builder.relateGaps(rawGaps, { owners: [...scopeOwners], targets: [selected.candidate.tuple.ownerId],
        files: [...scopeFiles], incomplete });
    for (const gap of placedGaps) {
        builder.diagnostic({ code: 'gap-relation', severity: 'info',
            message: `${gap.id} を ${gap.relation} と判定: ${gap.reason}`, relatedIds: [gap.id] });
    }
    for (const problem of new Set(problems)) {
        builder.diagnostic({ code: 'assembly-limitation', severity: 'warning', message: problem });
    }
    const limits = { applied: [
            { name: 'view-depth', limit: 200, stops: 0, unexplored: 0 },
            { name: 'view-paths', limit: 1_000, stops: 0, unexplored: 0 },
            { name: 'view-states', limit: 100_000, stops: 0, unexplored: 0 },
        ], truncations: [] };
    builder.limits(limits);
    const elementEvidence = target?.evidenceIds[0] ?? evidence.span(targetElement?.span ?? null, 'exact');
    if (!elementEvidence)
        throw new Error('The selected element has no source evidence');
    builder.select({
        candidateId: selected.candidate.id, contextId: context.id, ownerId: selected.candidate.tuple.ownerId,
        targetNodeId: target?.id ?? nodeIds[0],
        element: { file: selected.candidate.tuple.element.path, start: selected.candidate.tuple.element.start,
            end: selected.candidate.tuple.element.end, evidenceId: elementEvidence },
        routeIds: routeNodeIds, bootstrapId: bootstrapNodeId, events: selected.candidate.events,
    });
    void pathId;
    void operationIds;
    return builder.build();
}
function summarize(item) {
    const candidate = item.candidate;
    return { id: candidate.id, contextId: candidate.tuple.contextId, class: candidate.class,
        ownerId: candidate.tuple.ownerId,
        element: { file: candidate.tuple.element.path, start: candidate.tuple.element.start, end: candidate.tuple.element.end },
        routePattern: candidate.routePattern, events: candidate.events, partialReasons: candidate.partialReasons };
}
/** Layer owners are absolute paths, model owners are workspace relative; both name the same class. */
const sameOwnerId = (reference, other) => !!other && (other === reference || slash(other).endsWith(`/${reference}`));
/**
 * §7 the operation half: the listeners of the selected element, what each handler reaches through the
 * NgRx, HTTP, Signal and SignalStore layers, and the template reads that put the result back on screen.
 */
function addOperations(input) {
    const { analysis, builder, evidence, conditions, connect, declarationNode, relative, spanOf, targetElement, targetNodeId, targetKind, placed, viewPath, options, operationIds, problems, resolvedGaps, stores } = input;
    const { context, catalog, index, routes } = analysis;
    const t = context.toolchain.typescript;
    const owners = placed.map(item => catalog.declarations.get(item.step.ownerId))
        .filter((item) => !!item);
    const selfOwner = catalog.declarations.get(targetElement.owner.id) ?? owners[0];
    const selectedUse = placed.find(item => item.element?.component === selfOwner?.id &&
        item.element.owner.id !== selfOwner.id)?.element;
    const outputUses = new Map(placed.flatMap(item => item.element?.component
        ? [[item.element.component, item.element]] : []));
    const contextualInputs = new Map();
    for (const item of placed) {
        if (item.element?.component !== selfOwner?.id)
            continue;
        for (const binding of resolveElementBindings(item.element, context, catalog).relations) {
            if (binding.kind === 'input-binding' && binding.targetId === selfOwner.id &&
                (binding.expression === 'true' || binding.expression === 'false')) {
                contextualInputs.set(binding.member ?? binding.alias, binding.expression);
            }
        }
    }
    const bootstrap = routes.bootstraps.find(item => placed.some(step => step.step.relation === 'bootstrap' && step.step.ownerId === item.id))
        ?? routes.bootstraps[0];
    const routeOccurrence = placed
        .map(item => item.step.routeRef && routes.byId.get(item.step.routeRef.occurrenceId))
        .find((item) => !!item);
    const storeInputs = bootstrap ? storeInputsForSelection(context, catalog, routes, bootstrap, routeOccurrence)
        : { rootProviders: [], routeProviders: [] };
    const storeGraph = analyzeStore(context, catalog, storeInputs);
    const layers = selfOwner
        ? componentInjectorLayers(selfOwner, owners.filter(item => item !== selfOwner), storeInputs.rootProviders, storeInputs.routeProviders ?? [])
        : [];
    const httpCatalog = analyzeHttp(context);
    const signals = analyzeSignals(context);
    const methods = analyzeReactiveMethods(context, stores);
    const eventGraph = analyzeEvents(context, stores);
    const patchStates = findPatchStateCalls(context);
    /** The class and member a recorded position sits in, so a write inside a called method is attributed. */
    const enclosingMemberAt = (location) => {
        const at = evidence.offsetOf(location);
        if (!at)
            return null;
        const source = context.program.getSourceFile(path.resolve(context.workspaceRoot, at.file));
        if (!source)
            return null;
        let classId = null;
        let member = null;
        const visit = (node) => {
            if (node.getEnd() <= at.offset || node.getStart(source) > at.offset)
                return;
            if (t.isClassDeclaration(node) && node.name)
                classId = `${relative(source.fileName)}#${node.name.text}`;
            if ((t.isMethodDeclaration(node) || t.isPropertyDeclaration(node) || t.isPropertyAssignment(node)) &&
                (t.isIdentifier(node.name) || t.isStringLiteralLike(node.name)))
                member = node.name.text;
            t.forEachChild(node, visit);
        };
        visit(source);
        return { classId, member };
    };
    /** The class a component member holds, so `service.value()` resolves to the class that declares it. */
    const memberClassFor = (ownerId, member) => {
        const declaration = catalog.declarations.get(ownerId);
        if (!declaration)
            return null;
        const property = context.checker.getTypeAtLocation(declaration.node).getProperty(member);
        if (!property)
            return null;
        const held = context.checker.getTypeOfSymbolAtLocation(property, declaration.node).getSymbol();
        const node = held?.declarations?.find(item => t.isClassDeclaration(item));
        return node && t.isClassDeclaration(node) && node.name
            ? `${relative(node.getSourceFile().fileName)}#${node.name.text}` : null;
    };
    /** The member a component holds an injected SignalStore in, so `store.key()` can be resolved. */
    const storeMemberFor = (ownerId, declarationId) => {
        const instance = stores.instances.find(item => sameOwnerId(ownerId, item.owner) &&
            item.declarationId === declarationId && item.created);
        return instance ? memberNameAt(instance.source) : null;
    };
    /** The full range of the call written at a recorded position, so a read inside it can be attributed. */
    const callRangeAt = (location) => {
        const at = evidence.offsetOf(location);
        if (!at)
            return null;
        const source = context.program.getSourceFile(path.resolve(context.workspaceRoot, at.file));
        if (!source)
            return null;
        let found;
        const visit = (node) => {
            if (node.getEnd() <= at.offset || node.getStart(source) > at.offset)
                return;
            if (t.isCallExpression(node) && node.getStart(source) === at.offset)
                found = node;
            t.forEachChild(node, visit);
        };
        visit(source);
        return found ? { file: at.file, start: found.getStart(source), end: found.getEnd() } : null;
    };
    const withinRange = (location, range) => {
        const at = evidence.offsetOf(location);
        return !!at && at.file === range.file && at.offset >= range.start && at.offset < range.end;
    };
    // Layer ids carry the absolute workspace path; the model keeps workspace-relative ids only (§5).
    const shorten = (value) => slash(value).replaceAll(`${slash(context.workspaceRoot)}/`, '');
    /**
     * The displayed form of a layer id. `path:offset:name` becomes `path#name`, which is the id form §5
     * uses for a symbol. The offset stays in the node id, so two same-named symbols in one file stay apart.
     */
    const displayId = (value) => shorten(value).replace(/^(.+\.[cm]?tsx?):\d+:([A-Za-z_$][\w$]*)$/, '$1#$2');
    const nodeFor = (item, evidenceId) => {
        if (item.nodeId)
            return item.nodeId;
        // The kind is part of the symbol id so two layers naming the same text differently never collide.
        const label = displayId(item.label);
        return builder.definition({ kind: item.kind, symbolId: `${item.kind}:${shorten(item.id)}`,
            evidenceIds: [evidenceId], details: { name: detail(label), label: detail(label) } });
    };
    /** The member a `selectSignal`/`inject` result was assigned to, read from the declaration it sits in. */
    const memberNameAt = (location) => {
        const at = evidence.offsetOf(location);
        if (!at)
            return null;
        const source = context.program.getSourceFile(path.resolve(context.workspaceRoot, at.file));
        if (!source)
            return null;
        let found = null;
        const visit = (node) => {
            if (node.getEnd() <= at.offset || node.getStart(source) > at.offset)
                return;
            if ((t.isPropertyDeclaration(node) || t.isVariableDeclaration(node)) && t.isIdentifier(node.name)) {
                found = node.name.text;
            }
            t.forEachChild(node, visit);
        };
        visit(source);
        return found;
    };
    /** Positions another layer already explained, so a later trace does not report them as unknown. */
    const resolvedAt = new Map();
    const materialize = (edges, into) => {
        for (const edge of edges) {
            const evidenceId = evidence.location(edge.location);
            if (!evidenceId) {
                problems.push(`${edge.location} を根拠に解決できず ${edge.kind} を出力しない`);
                continue;
            }
            const from = nodeFor(edge.from, evidenceId);
            const to = edge.to.kind === 'boundary'
                ? builder.boundary({ reason: displayId(edge.to.label), lastConfirmed: displayId(edge.from.id), evidenceIds: [evidenceId] })
                : nodeFor(edge.to, evidenceId);
            const predicates = [...(into.conditions ?? []), ...edge.conditions].map(text => conditions.predicate({ expression: text, scope: edge.from.id, evidenceId }));
            const conditionId = predicates.length ? conditions.all(predicates) : null;
            const details = Object.fromEntries(Object.entries(edge.details).map(([key, field]) => [key, field.value === null ? field : detail(displayId(field.value))]));
            const id = builder.edge({ kind: edge.kind, from, to, evidenceIds: [evidenceId],
                confidence: edge.kind === 'boundary' ? 'unresolved' : conditionId ? 'conditional' : 'confirmed',
                origin: 'ng-wiring', conditionId, details });
            if (edge.kind !== 'boundary' && !resolvedAt.has(edge.location))
                resolvedAt.set(edge.location, id);
            into.nodes.add(from);
            into.nodes.add(to);
            into.edges.push(id);
        }
    };
    /**
     * §8 a stop the NgRx or HTTP trace reports at a position the reactive layer explained is kept as a
     * detection gap that ng-wiring filled in, not as a boundary that hides the resolved relation.
     */
    const reconcile = (edges, ownerId) => edges.filter(edge => {
        if (edge.kind !== 'boundary')
            return true;
        const resolvedBy = resolvedAt.get(edge.location);
        if (!resolvedBy)
            return true;
        resolvedGaps.push({ code: 'trace-stopped', message: `${edge.location}: ${edge.details.reason?.value ?? edge.to.label}`,
            owner: ownerId, file: edge.location.slice(0, edge.location.indexOf(':')), resolvedBy,
            resolvedReason: '同じ呼び出し位置を Signal/SignalStore 層が解決した' });
        return false;
    });
    const resolution = resolveEventListeners(targetElement, context, catalog, options.event, { index, path: viewPath });
    for (const message of resolution.diagnostics) {
        builder.diagnostic({ code: 'event-propagation', severity: 'info', message });
    }
    const elementNode = (element) => builder.occurrence({
        kind: element.component ? 'component' : 'element',
        key: { ownerId: element.owner.id, definitionId: element.component ? declarationNode(element.component) : null,
            span: spanOf(element.span), insertion: null, projection: null, route: null },
        evidenceIds: [evidence.span(element.span, 'exact')].filter((item) => !!item),
        details: { label: detail(`<${element.tag}>`) },
    });
    for (const listener of [...resolution.listeners, ...resolution.outputSubscriptions]) {
        const ownerId = listener.listenerElement?.owner.id ?? targetElement.owner.id;
        const listenerEvidence = evidence.span(listener.span ?? targetElement.span, 'exact');
        if (!listenerEvidence) {
            problems.push(`${listener.eventName} のリスナー位置を根拠にできない`);
            continue;
        }
        const listenerNode = builder.definition({ kind: 'listener',
            symbolId: `${ownerId}.${listener.eventName}:${listener.handler}`, evidenceIds: [listenerEvidence],
            details: { name: detail(listener.handler), label: detail(`${listener.eventName} → ${listener.handler}`) } });
        const scopeNodes = new Set([targetNodeId, listenerNode]);
        const scopeEdges = [];
        const guard = handlerGuard(listener.handler);
        const listenerConditions = [...listener.conditions, ...(guard ? [`handler requires ${guard}`] : [])];
        const predicates = listenerConditions.map(text => conditions.predicate({ expression: text, scope: ownerId, evidenceId: listenerEvidence }));
        const conditionId = predicates.length ? conditions.all(predicates) : null;
        const hostNode = listener.listenerElement ? elementNode(listener.listenerElement) : declarationNode(ownerId);
        const hostKind = listener.listenerElement
            ? (listener.listenerElement.component ? 'component' : 'element') : 'component';
        const registered = connect({
            kind: listener.eventSource.endsWith('output') ? 'output-subscription' : 'dom-listener',
            from: hostNode, fromKind: hostKind, to: listenerNode, toKind: 'listener',
            evidenceIds: [listenerEvidence], conditionId,
            details: listener.eventSource.endsWith('output')
                ? { output: detail(listener.subscription ?? listener.eventName), subscriber: detail(listener.handler) }
                : { event: detail(listener.eventName), selected: detail(`<${targetElement.tag}>`),
                    listener: detail(ownerId), handler: detail(listener.handler) },
        });
        if (registered)
            scopeEdges.push(registered);
        // §7.2 an ancestor listener is reached by propagation; the DOM rules stay on the edge as conditions.
        if (!listener.eventSource.endsWith('output') && listener.listenerElement &&
            listener.listenerElement !== targetElement) {
            const propagated = connect({ kind: 'event-propagation', from: targetNodeId, fromKind: targetKind,
                to: hostNode, toKind: hostKind, evidenceIds: [listenerEvidence], conditionId,
                details: { event: detail(listener.eventName), fromElement: detail(`<${targetElement.tag}>`),
                    toElement: detail(`<${listener.listenerElement.tag}>`), phase: detail('bubble') } });
            if (propagated)
                scopeEdges.push(propagated);
        }
        const method = handlerMethod(listener.handler, contextualInputs);
        const owner = catalog.declarations.get(ownerId);
        if (method && owner) {
            const declaration = classMethod(context, owner.node, method);
            const range = declaration ? { file: relative(declaration.getSourceFile().fileName),
                start: declaration.getStart(), end: declaration.getEnd() } : null;
            const inside = (location) => {
                if (!range)
                    return false;
                const at = evidence.offsetOf(location);
                return !!at && at.file === range.file && at.offset >= range.start && at.offset < range.end;
            };
            const scope = { nodes: scopeNodes, edges: scopeEdges, conditions: listenerConditions };
            const actionSource = t.createSourceFile('__ngwi_handler.ts', listener.handler, t.ScriptTarget.Latest, true);
            const action = actionSource.statements[0];
            const rootArguments = action && t.isExpressionStatement(action) && t.isCallExpression(action.expression)
                ? action.expression.arguments : [];
            const storeTrace = traceStoreDispatch(context, storeGraph, owner, method, layers, { outputElement: selectedUse ?? targetElement, outputUses, catalog, parentLayers: layers, rootArguments,
                routeInjectorUnknown: !routeOccurrence });
            const outputTypes = new Map();
            for (const member of owner.node.members) {
                if (!t.isPropertyDeclaration(member) || !member.initializer || !t.isCallExpression(member.initializer) ||
                    !t.isIdentifier(member.name))
                    continue;
                if (!owner.outputs.has(member.name.text))
                    continue;
                const declared = member.initializer.typeArguments?.[0]?.getText();
                if (declared)
                    outputTypes.set(member.name.text, declared);
            }
            const outputValues = new Map(storeTrace.steps.filter(step => step.kind === 'output-emit' &&
                step.source === ownerId && step.detail !== null).map(step => [step.location, step.detail]));
            materialize(operationTraceEdges(traceOperation(context, owner, method), ownerId, outputTypes, outputValues), scope);
            const httpTrace = traceHttpFromMethod(context, httpCatalog, owner, method, { catalog, store: storeGraph, methods, stores, layers });
            for (const consumed of storeTrace.steps.filter(step => step.kind === 'action-consume')) {
                const effect = storeGraph.effects.find(item => item.id === consumed.target);
                if (!effect)
                    continue;
                const effectHttp = traceHttpFromEffect(context, httpCatalog, effect, { catalog, store: storeGraph, methods, stores, layers }, consumed.conditions);
                const offset = httpTrace.flows.length;
                httpTrace.steps.push(...effectHttp.steps.map(step => ({ ...step,
                    flowIndex: step.flowIndex === undefined ? undefined : step.flowIndex + offset })));
                httpTrace.flows.push(...effectHttp.flows);
                httpTrace.diagnostics.push(...effectHttp.diagnostics);
            }
            // Store methods this operation actually entered. Only a call on a resolved receiver counts: the
            // handler's own name must not stand in for a Store member that happens to share it.
            const entered = new Set(storeTrace.steps
                .filter(step => step.kind === 'call' && step.target.includes('.'))
                .map(step => step.target.slice(step.target.lastIndexOf('.') + 1)));
            // The same, resolved to the class that owns each entered method: `field.method` names the class the
            // component holds in `field`, and a bare method name is the component's own.
            const enteredIn = storeTrace.steps.filter(step => step.kind === 'call').map(step => {
                const dot = step.target.lastIndexOf('.');
                return dot < 0 ? { classId: ownerId, member: step.target }
                    : { classId: memberClassFor(ownerId, step.target.slice(0, dot)), member: step.target.slice(dot + 1) };
            });
            const reached = (location) => {
                if (inside(location))
                    return true;
                const at = enclosingMemberAt(location);
                return !!at && enteredIn.some(item => item.member === at.member && !!item.classId &&
                    sameOwnerId(item.classId, at.classId));
            };
            // The reactive layer runs first so the NgRx and HTTP traces can be reconciled against what it resolved.
            const keys = addReactiveWrites({ listenerNode, inside: reached, signals, eventGraph, owners, materialize,
                scope, storeGraph, callRangeAt, withinRange, memberNameAt, stores, patchStates, entered, ownerId,
                context, catalog, httpCatalog, layers,
                reachedConsumers: new Set(storeTrace.steps.filter(step => step.kind === 'reactive-link')
                    .map(step => step.target)) });
            addDisplayReads({ analysis, builder, evidence, connect, declarationNode, spanOf, keys, placed, scope,
                storeMemberFor, memberClassFor });
            materialize(reconcile(storeTraceEdges(storeTrace), ownerId), scope);
            materialize(reconcile(httpTraceEdges(httpTrace), ownerId), scope);
            // A write to a member bound to a sibling component input can trigger that component's
            // ngOnChanges on a later change-detection pass. It is a separate branch from calls in the
            // current handler; in particular, an immediate jump does not use the recalculated list yet.
            const changedByOwner = new Map();
            for (const step of storeTrace.steps.filter(item => item.kind === 'state-write' &&
                catalog.declarations.has(item.source))) {
                const members = changedByOwner.get(step.source) ?? new Set();
                members.add(step.target);
                changedByOwner.set(step.source, members);
            }
            for (const [parentId, changed] of changedByOwner)
                for (const child of index.byOwner.get(parentId) ?? []) {
                    if (!child.component || !changed.size)
                        continue;
                    const childOwner = catalog.declarations.get(child.component);
                    if (!childOwner)
                        continue;
                    const bindings = resolveElementBindings(child, context, catalog).relations;
                    for (const bound of bindings.filter(item => item.kind === 'input-binding' &&
                        changed.has(item.expression.trim()) && item.targetId === child.component)) {
                        const onChange = bindings.find(item => item.kind === 'input-change' && item.alias === bound.alias);
                        if (!onChange)
                            continue;
                        const at = evidence.span(bound.span ?? child.span, 'exact');
                        if (!at)
                            continue;
                        const phase = [`${bound.expression} input may change on a later change-detection pass`,
                            'ngOnChanges runs only when Angular records an input change'];
                        const gate = conditions.all(phase.map(expression => conditions.predicate({ expression, scope: parentId, evidenceId: at })));
                        const state = builder.definition({ kind: 'state', symbolId: `state:${bound.expression.trim()}`,
                            evidenceIds: [at], details: { name: detail(bound.expression.trim()), label: detail(bound.expression.trim()) } });
                        const inputNode = builder.definition({ kind: 'symbol',
                            symbolId: `${child.component}.${bound.member ?? bound.alias}`, evidenceIds: [at],
                            details: { name: detail(bound.alias), label: detail(bound.alias) } });
                        const lifecycle = builder.definition({ kind: 'symbol', symbolId: `${child.component}.ngOnChanges`,
                            evidenceIds: [at], details: { name: detail('ngOnChanges'), label: detail('ngOnChanges') } });
                        const flow = connect({ kind: 'value-flow', from: state, fromKind: 'state', to: inputNode,
                            toKind: 'symbol', evidenceIds: [at], conditionId: gate,
                            details: { valueExpression: detail(bound.expression), destination: detail(`${child.component}.${bound.alias}`) } });
                        const lifecycleCall = connect({ kind: 'call', from: inputNode, fromKind: 'symbol', to: lifecycle,
                            toKind: 'symbol', evidenceIds: [at], conditionId: gate,
                            details: { caller: detail(`${child.component}.${bound.alias}`), callee: detail('ngOnChanges'),
                                arguments: detail(`SimpleChanges.${bound.alias}`) } });
                        if (flow)
                            scope.edges.push(flow);
                        if (lifecycleCall)
                            scope.edges.push(lifecycleCall);
                        scope.nodes.add(state);
                        scope.nodes.add(inputNode);
                        scope.nodes.add(lifecycle);
                        const downstream = traceStoreDispatch(context, storeGraph, childOwner, 'ngOnChanges', layers, { outputElement: child, outputUses, catalog, parentLayers: layers, changedInput: bound.alias,
                            routeInjectorUnknown: !routeOccurrence });
                        materialize(storeTraceEdges(downstream).map(edge => ({ ...edge,
                            conditions: [...phase, ...edge.conditions] })), scope);
                    }
                }
            if (!declaration) {
                builder.diagnostic({ code: 'handler-unresolved', severity: 'warning',
                    message: `${ownerId} に ${method} の本体が無いため処理を追跡していない`,
                    evidenceIds: [listenerEvidence], stopReason: 'handler method body was not found' });
            }
        }
        else if (!method) {
            builder.diagnostic({ code: 'handler-expression', severity: 'info',
                message: `${listener.eventName} のハンドラー ${listener.handler} はメソッド呼び出しではないため本体を追跡していない`,
                evidenceIds: [listenerEvidence] });
        }
        operationIds.push(builder.operation({ event: listener.eventName, eventId: targetNodeId,
            listenerId: listenerNode, nodeIds: [...scopeNodes], edgeIds: scopeEdges,
            coverageReasons: listener.status === 'unresolved' ? [`${listener.eventName}: リスナー解決が未確定`] : [] }));
    }
    for (const derived of resolution.derivedEvents) {
        builder.diagnostic({ code: 'derived-event', severity: 'info',
            message: `${derived.from} から ${derived.to} への派生は境界: ${derived.reason}`,
            stopReason: derived.reason });
    }
}
/** §7.6 the state this operation writes through Signal and SignalStore APIs, with no effect required. */
function addReactiveWrites(input) {
    const { context, catalog, httpCatalog, layers, listenerNode, inside, signals, eventGraph, owners, storeGraph, materialize, scope, callRangeAt, withinRange, memberNameAt, stores, patchStates, entered, ownerId, reachedConsumers } = input;
    const keys = [];
    const traced = [];
    const listenerEnd = { kind: 'listener', id: 'listener', label: 'listener', nodeId: listenerNode };
    for (const write of signals.writes.filter(item => inside(item.location))) {
        const source = signals.sources.find(item => item.id === write.sourceId);
        // A derived value can be written explicitly as well; it is then named by the link that declares it.
        const derivedTarget = source ? null : signals.links.find(item => item.id === write.sourceId);
        const stateId = source ? `${source.state.instance ?? source.state.declaration}.${source.state.key ?? ''}`
            : derivedTarget?.id ?? write.id;
        const label = source?.state.key ?? derivedTarget?.to ?? write.id;
        const node = { kind: 'state', id: stateId, label };
        traced.push({ kind: 'state-write', from: listenerEnd, to: node, location: write.location,
            conditions: write.conditions, capability: write.capability,
            details: { writer: detail('listener'), state: detail(label),
                valueExpression: unresolvedDetail('更新値の式は signal 解析が記録していない') } });
        if (source)
            keys.push({ ownerId: source.state.instance, member: source.state.key ?? label, node });
        else if (derivedTarget?.to)
            keys.push({ ownerId: null, member: derivedTarget.to, node });
        // §7.6 a derived value keeps its own link; the write reaches it without an effect. The dependency is
        // a read of this source inside the derived expression itself, not a name that happens to match.
        for (const link of signals.links) {
            const range = callRangeAt(link.location);
            const dependsOn = link.from === write.sourceId || (!!range && !!write.sourceId &&
                signals.reads.some(read => read.sourceId === write.sourceId && withinRange(read.location, range)));
            if (!dependsOn)
                continue;
            // A derived value holds a value the template reads, so it is a state node and not a plain symbol.
            const derived = { kind: 'state', id: `${link.capability}:${link.to ?? link.id}`, label: link.to ?? link.id };
            traced.push({ kind: 'reactive-link', from: node, to: derived, location: link.location,
                conditions: link.conditions, capability: link.capability,
                details: { source: detail(label), consumer: detail(link.to ?? link.id), operator: detail(link.capability),
                    scheduling: detail('読み出し時に再計算') } });
            if (link.to)
                keys.push({ ownerId: source?.state.instance ?? null, member: link.to,
                    node: { kind: 'state', id: derived.id, label: derived.label } });
        }
    }
    // §7.6 SignalStore events: the dispatch site decides the bus instance, the consumers write the state.
    // The graph names injector owners with absolute paths, so the ancestry is matched onto that spelling;
    // otherwise a component that calls provideDispatcher would never be recognised as a bus instance.
    const ancestry = owners.map(item => eventGraph.dispatcherOwners.find(owner => sameOwnerId(item.id, owner)) ?? item.id);
    for (const dispatch of eventGraph.dispatches.filter(item => inside(item.source))) {
        const delivery = resolveEventDelivery(eventGraph, dispatch, ancestry, consumer => consumer.owner ? [consumer.owner, ...ancestry] : ancestry);
        materialize(reactiveStepEdges(eventDeliverySteps(eventGraph, dispatch, delivery)), scope);
        for (const consumer of delivery.consumers.filter(item => item.kind === 'handler')) {
            const http = traceHttpFromEventConsumer(context, httpCatalog, consumer, { catalog, store: storeGraph, stores, layers }, [...delivery.conditions, ...consumer.conditions]);
            materialize(httpTraceEdges(http), scope);
        }
        for (const consumer of delivery.consumers)
            for (const key of consumer.writes) {
                keys.push({ ownerId: consumer.owner, member: key, storeId: consumer.storeId,
                    node: { kind: 'state', id: [consumer.storeId ?? consumer.id, consumer.owner, key].filter(Boolean).join('.'), label: key } });
            }
    }
    // §7.6 an effect that tracks the written state re-runs; only a tracked read is such a dependency, so a
    // read after an await or inside untracked never becomes one.
    for (const write of signals.writes.filter(item => inside(item.location) && item.sourceId)) {
        const source = signals.sources.find(item => item.id === write.sourceId);
        const label = source?.state.key ?? write.id;
        const stateNode = { kind: 'state',
            id: source ? `${source.state.instance ?? source.state.declaration}.${source.state.key ?? ''}` : write.id,
            label };
        for (const effect of signals.effects) {
            const tracked = effect.reads.some(id => signals.reads.some(read => read.id === id && read.sourceId === write.sourceId));
            if (!tracked)
                continue;
            traced.push({ kind: 'reactive-link', from: stateNode,
                to: { kind: 'effect', id: effect.id, label: effect.capability },
                location: effect.location,
                conditions: [...effect.lifetime, ...effect.cleanups.map(at => `cleanup registered at ${at}`),
                    ...effect.destroys.map(at => `explicitly destroyed at ${at}`)],
                capability: effect.capability,
                details: completeDetails('reactive-link', { source: detail(label), consumer: detail(effect.capability),
                    operator: detail(effect.capability), scheduling: detail(effect.phase) }) });
        }
    }
    // §7.6 a Store method this operation called writes its state with patchState; no effect is involved.
    for (const instance of stores.instances.filter(item => sameOwnerId(ownerId, item.owner) && item.created)) {
        const declaration = stores.declarations.get(instance.declarationId);
        const range = declaration ? callRangeAt(declaration.source) : null;
        if (!declaration || !range)
            continue;
        for (const patch of patchStates) {
            if (!withinRange(patch.location, range))
                continue;
            if (!patch.member || !entered.has(patch.member))
                continue;
            const written = patch.keys.length ? patch.keys : declaration.stateKeys;
            for (const key of written) {
                const node = { kind: 'state', id: `${declaration.id}.${key}`, label: key };
                traced.push({ kind: 'state-write', from: listenerEnd, to: node, location: patch.location,
                    conditions: [...instance.conditions, ...(patch.keys.length ? [] : ['書き換え対象のキーを静的に確定できていない'])],
                    capability: 'signals/patchState',
                    details: { writer: detail(patch.member), state: detail(key),
                        valueExpression: unresolvedDetail('patchState の更新式は静的に確定していない') } });
                keys.push({ ownerId: null, member: key, storeId: declaration.id, node });
            }
        }
    }
    // §7.4 only a selector this operation's state change actually reached is a display of it. A consumer
    // the trace never reached is a background read and does not become a consequence of this operation.
    for (const consumer of storeGraph.consumers) {
        if (!reachedConsumers.has(consumer.id))
            continue;
        const member = memberNameAt(consumer.source);
        if (member)
            keys.push({ ownerId: consumer.owner, member,
                node: { kind: 'state', id: consumer.id, label: member } });
    }
    materialize(traced, scope);
    return keys;
}
/**
 * §7.3 the display half. A template that reads the member resolves it against the owning class, so the
 * connection is a resolved member reference and not a name that merely looks alike.
 */
function addDisplayReads(input) {
    const { analysis, builder, evidence, connect, declarationNode, spanOf, keys, placed, scope, storeMemberFor, memberClassFor } = input;
    if (!keys.length)
        return;
    const { context, catalog, index } = analysis;
    const ownerIds = [...new Set(placed.map(item => item.step.ownerId))];
    for (const ownerId of ownerIds) {
        const elements = index.byOwner.get(ownerId) ?? [];
        for (const element of elements) {
            if (!element.node.inputs.length && !element.node.children.length)
                continue;
            const resolved = resolveTemplateExpressions(element, context, catalog, index);
            const direct = new Set(resolved.references.filter(item => item.kind === 'member').map(item => item.name));
            for (const read of templateReads(element, context)) {
                // A bare member must have resolved against the owning class; a `store.key()` read must go
                // through the member that holds the Store this state belongs to.
                const match = keys.find(key => key.member === read.member && (read.receiver === null
                    ? direct.has(read.member) && (key.ownerId === null || sameOwnerId(ownerId, key.ownerId))
                    // A value held elsewhere is read through the member that holds it: a generated Store, or a
                    // class this component injects and whose own declaration owns the state.
                    : (!!key.storeId && storeMemberFor(ownerId, key.storeId) === read.receiver) ||
                        (!!key.ownerId && sameOwnerId(memberClassFor(ownerId, read.receiver) ?? '', key.ownerId))));
                if (!match)
                    continue;
                const evidenceId = evidence.span(element.span, 'exact');
                if (!evidenceId)
                    continue;
                const reader = builder.occurrence({ kind: element.component ? 'component' : 'element',
                    key: { ownerId, definitionId: element.component ? declarationNode(element.component) : null,
                        span: spanOf(element.span), insertion: null, projection: null, route: null },
                    evidenceIds: [evidenceId], details: { label: detail(`<${element.tag}>`) } });
                const state = builder.definition({ kind: match.node.kind, symbolId: `${match.node.kind}:${match.node.id}`,
                    evidenceIds: [evidenceId], details: { name: detail(match.node.label), label: detail(match.node.label) } });
                const edgeId = connect({ kind: 'state-read', from: state, fromKind: match.node.kind, to: reader,
                    toKind: element.component ? 'component' : 'element', evidenceIds: [evidenceId], conditionId: null,
                    details: { reader: detail(`${ownerId} のテンプレート`), state: detail(match.node.label),
                        tracking: detail('tracked') } });
                if (edgeId) {
                    scope.nodes.add(state);
                    scope.nodes.add(reader);
                    scope.edges.push(edgeId);
                }
            }
        }
    }
}
/**
 * §10 the syntax, type and configuration errors that were detected are always reported. A clean build of
 * the target application is not a pass condition, so these are stated instead of being required to be absent.
 */
function addDiagnostics(input) {
    const { analysis, builder, evidence, relative, scopeFiles, stores } = input;
    const gaps = [];
    const { context, catalog, index } = analysis;
    const t = context.toolchain.typescript;
    const flatten = (message) => t.flattenDiagnosticMessageText(message, ' ');
    let outside = 0;
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (!source)
            continue;
        const local = scopeFiles.has(relative(file));
        const found = [...context.program.getSyntacticDiagnostics(source), ...context.program.getSemanticDiagnostics(source)];
        if (!local) {
            outside += found.length;
            continue;
        }
        for (const item of found) {
            const span = item.start !== undefined && item.length
                ? evidence.table.tryAdd({ file, start: item.start, end: item.start + item.length, precision: 'exact' }) : null;
            const error = item.category === t.DiagnosticCategory.Error;
            const message = `TS${item.code}: ${flatten(item.messageText)}`;
            builder.diagnostic({ code: error ? 'ts-error' : 'ts-report',
                severity: error ? 'error' : 'warning', message,
                evidenceIds: span ? [span] : [], stopReason: null });
            // §10 a source in the explored scope that does not type-check may have been read wrongly, so the
            // related range is reported as incomplete instead of being claimed as fully covered.
            if (error) {
                gaps.push({ code: 'ts-error', message, owner: null, file: relative(file),
                    evidenceIds: span ? [span] : [] });
            }
        }
    }
    if (outside) {
        builder.diagnostic({ code: 'ts-outside-selection', severity: 'info',
            message: `選択範囲外のソースに ${outside} 件の構文/型診断がある（ビルド成功は合格条件にしない）` });
    }
    for (const problem of context.parsedConfig.errors) {
        builder.diagnostic({ code: 'tsconfig-error', severity: 'error', message: flatten(problem.messageText) });
    }
    for (const message of catalog.gaps)
        builder.diagnostic({ code: 'catalog-gap', severity: 'warning', message });
    for (const message of index.diagnostics)
        builder.diagnostic({ code: 'template-index', severity: 'warning', message });
    for (const region of index.unsupported) {
        const span = region.span ? evidence.span(region.span, 'exact') : null;
        builder.diagnostic({ code: 'unsupported-template', severity: 'warning',
            message: `${region.ownerId}: ${region.kind} — ${region.reason}`, evidenceIds: span ? [span] : [],
            stopReason: region.reason });
    }
    for (const message of analysis.mazeProblems) {
        builder.diagnostic({ code: 'ngmaze-unavailable', severity: 'warning', message, stopReason: message });
    }
    for (const item of analysis.maze?.diagnostics ?? []) {
        builder.diagnostic({ code: item.code, severity: 'warning', message: item.message });
    }
    // §7.6 R16: a feature this version cannot identify may add or replace members of the Store, so the
    // range stays partial instead of the feature being passed through as transparent.
    for (const declaration of stores.declarations.values()) {
        const file = declaration.source.slice(0, declaration.source.indexOf(':'));
        if (!scopeFiles.has(file))
            continue;
        const unresolved = declaration.features.filter(item => item.status === 'boundary');
        if (declaration.status !== 'partial' && !unresolved.length)
            continue;
        const reason = unresolved.map(item => `${item.label}: ${item.reason ?? '識別できない feature'}`).join('; ') ||
            declaration.gaps.join('; ') || '識別できない feature が member/state を上書きし得る';
        const at = evidence.location(declaration.source);
        builder.diagnostic({ code: 'unsupported-store-feature', severity: 'warning',
            message: `${declaration.name}: ${reason}`, evidenceIds: at ? [at] : [], stopReason: reason });
    }
    // §7.6 R16: a reactive API with no semantic model stops the trace instead of being read as a known one.
    for (const file of context.sourceFiles) {
        const source = context.program.getSourceFile(file);
        if (!source || !scopeFiles.has(relative(file)))
            continue;
        for (const use of unsupportedImports(context, source)) {
            const span = evidence.table.tryAdd({ file, start: use.location.getStart(source), end: use.location.getEnd(),
                precision: 'exact' });
            builder.diagnostic({ code: 'unsupported-reactive-api', severity: 'warning',
                message: `${use.module} の ${use.specifier} には意味モデルが無い: ${use.capability.note ?? '対応範囲外'}`,
                evidenceIds: span ? [span] : [], stopReason: use.capability.note ?? 'unsupported reactive API' });
        }
    }
    return gaps;
}
/** §8 every detection gap that was reported, before it is placed against the selection. */
function collectGaps(input) {
    const { analysis, evidence } = input;
    const gaps = [];
    for (const gap of analysis.maze?.detectionGaps ?? []) {
        const evidenceId = gap.location.file ? evidence.location(`${gap.location.file}:${gap.location.line}:${gap.location.column}`) : null;
        gaps.push({ code: gap.code, message: gap.message, owner: gap.owner, candidates: gap.candidates,
            file: gap.file || null, evidenceIds: evidenceId ? [evidenceId] : [] });
    }
    for (const message of analysis.catalog.gaps)
        gaps.push({ code: 'catalog-gap', message, owner: null, file: null });
    for (const message of analysis.context.gaps)
        gaps.push({ code: 'program-scope', message, owner: null, file: null });
    for (const message of analysis.routes.gaps)
        gaps.push({ code: 'route-graph', message, owner: null, file: null });
    for (const message of analysis.index.diagnostics) {
        const owner = message.includes(': ') ? message.slice(0, message.indexOf(': ')) : null;
        gaps.push({ code: 'template-index', message, owner: owner?.includes('#') ? owner : null,
            file: owner?.includes('#') ? owner.slice(0, owner.indexOf('#')) : null });
    }
    for (const region of analysis.index.unsupported) {
        gaps.push({ code: 'unsupported-template', message: `${region.kind}: ${region.reason}`, owner: region.ownerId,
            file: region.span ? input.relative(region.span.file) : null });
    }
    for (const message of analysis.mazeProblems)
        gaps.push({ code: 'ngmaze-unavailable', message, owner: null, file: null });
    for (const declaration of input.stores.declarations.values()) {
        const unresolved = declaration.features.filter(item => item.status === 'boundary');
        if (declaration.status !== 'partial' && !unresolved.length)
            continue;
        gaps.push({ code: 'unsupported-store-feature',
            message: `${declaration.name}: 識別できない feature が state/member を上書きし得る`,
            owner: null, file: declaration.source.slice(0, declaration.source.indexOf(':')),
            evidenceIds: [input.evidence.location(declaration.source)].filter((item) => !!item) });
    }
    return gaps;
}
