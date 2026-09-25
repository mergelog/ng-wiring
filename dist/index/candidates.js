import path from 'node:path';
import { makeCandidate, sortCandidates } from '../cli/candidates.js';
import { resolveWorkspacePath } from '../cli/arguments.js';
import { matchingElements } from './templates.js';
import { defaultViewLimits, resolveViewPaths } from '../resolve/view/index.js';
const relative = (context, file) => path.relative(context.workspaceRoot, file).replaceAll('\\', '/');
function position(context, span) {
    return { path: relative(context, span.file), line: span.line, column: span.column, offset: span.start };
}
export function buildIndexedCandidates(context, catalog, index, target, maze, routes) {
    const hostTag = (id) => {
        const selector = catalog.declarations.get(id)?.selector ?? catalog.external.get(id)?.selector;
        return selector && /^[A-Za-z][A-Za-z0-9-]*$/.test(selector.trim()) ? selector.trim().toLowerCase() : null;
    };
    const knownHostTags = new Set([...catalog.declarations.keys(), ...catalog.external.keys()]
        .map(hostTag).filter((tag) => tag !== null));
    const displayTags = (view, parentIds) => {
        const ordinary = parentIds.map(hostTag).filter((tag) => tag !== null).reverse();
        if (view.end !== 'dynamic-boundary')
            return ordinary;
        const creation = [...view.steps].reverse().find(part => part.relation === 'dynamic-creation');
        const createdId = creation?.label.match(/ creates (.+)$/)?.[1];
        const createdTag = createdId && hostTag(createdId);
        const hosts = view.steps.filter(part => part.relation === 'element').flatMap(part => {
            const tag = part.label.match(/^<([A-Za-z][A-Za-z0-9-]*)>$/)?.[1]?.toLowerCase();
            return tag && knownHostTags.has(tag) ? [tag] : [];
        }).reverse();
        return createdTag ? [createdTag, ...hosts] : ordinary;
    };
    const query = target.kind === 'attribute' ? { kind: 'attribute', name: target.name, value: target.value } :
        { kind: 'source', file: resolveWorkspacePath(context.workspaceRoot, target.file), line: target.line };
    const output = [];
    const seenIds = new Map();
    for (const element of matchingElements(index, query)) {
        const verifiedMaze = maze ? { ...maze, edges: maze.edges.filter(edge => index.verifiedMazeEdges.includes(edge)) } : undefined;
        const resolution = resolveViewPaths(element, context, catalog, index, defaultViewLimits, verifiedMaze, routes);
        for (const view of resolution.paths) {
            const insertion = view.steps.find(part => part.relation === 'template-insertion' || part.relation === 'projection-slot')?.span;
            const routeRefs = view.steps.flatMap(part => part.routeRef ? [part.routeRef] : []);
            const tuple = {
                contextId: context.id, ownerId: element.owner.id,
                element: { path: relative(context, element.span.file), start: element.span.start, end: element.span.end },
                usages: view.steps.filter(part => part.relation === 'component-use' && part.span).map(part => position(context, part.span)),
                routes: routeRefs.map(item => ({ definition: position(context, item.definition),
                    loaders: item.loaders.map(span => position(context, span)) })),
                bootstrapId: view.steps.find(part => part.relation === 'bootstrap')?.ownerId ?? null,
                insertion: insertion ? position(context, insertion) : null,
            };
            const parentIds = [...new Set(view.steps.map(part => part.ownerId))];
            const related = (owner) => !!owner && (owner === element.owner.id || parentIds.includes(owner));
            const partialReasons = [...element.gaps, ...resolution.diagnostics,
                ...index.diagnostics.filter(message => [element.owner.id, ...parentIds].some(id => message.startsWith(`${id}:`))),
                ...(maze?.diagnostics.filter(item => related(item.owner)).map(item => `${item.code}: ${item.message}`) ?? []),
                ...(maze?.detectionGaps.filter(item => related(item.owner)).map(item => `${item.code}: ${item.message}`) ?? [])];
            for (const item of routeRefs)
                partialReasons.push(...(routes?.byId.get(item.occurrenceId)?.gaps ?? []));
            if (routes && view.end !== 'bootstrap')
                partialReasons.push(...routes.gaps.filter(gap => routeRefs.some(item => gap.includes(relative(context, item.definition.file)))));
            if (view.end !== 'bootstrap')
                partialReasons.push(view.reason);
            if (context.entryUnknown)
                partialReasons.push('Bootstrap entry is unknown');
            const candidate = makeCandidate(tuple, { snapshotId: context.snapshot.id,
                class: view.end === 'bootstrap' ? 'bootstrap' :
                    view.end === 'fragment-uninstantiated' ? 'uninstantiated-fragment' :
                        view.end === 'dynamic-boundary' ? 'unresolved-dynamic' : 'declaration',
                parentIds, dom: { componentTags: displayTags(view, parentIds),
                    targetTag: element.tag.toLowerCase() }, routePattern: routeRefs[0]?.pattern ?? null,
                events: element.events, partialReasons });
            const creation = view.steps.find(part => part.relation === 'dynamic-creation');
            const edge = creation && maze?.edges.find(item => item.from === creation.ownerId &&
                `${item.kind} creates ${item.to}` === creation.label &&
                item.location.file === creation.callSite?.file && item.location.line === creation.callSite.line &&
                item.location.column === creation.callSite.column);
            const call = edge ? [{ ownerId: edge.from, kind: edge.kind,
                    file: edge.location.file, line: edge.location.line, column: edge.location.column }] : [];
            const previous = seenIds.get(candidate.id);
            if (previous) {
                const callers = previous.dynamicCallers ?? [];
                for (const item of call)
                    if (!callers.some(other => other.ownerId === item.ownerId &&
                        other.file === item.file && other.line === item.line && other.column === item.column))
                        callers.push(item);
                previous.dynamicCallers = callers;
            }
            else {
                const indexed = { candidate, path: view, dynamicCallers: call };
                seenIds.set(candidate.id, indexed);
                output.push(indexed);
            }
        }
    }
    const order = new Map(sortCandidates(output.map(item => item.candidate)).map((candidate, index) => [candidate, index]));
    return output.sort((a, b) => order.get(a.candidate) - order.get(b.candidate));
}
