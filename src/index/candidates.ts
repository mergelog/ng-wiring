import path from 'node:path';
import { makeCandidate, sortCandidates, type Candidate, type SourcePosition } from '../cli/candidates.js';
import { resolveWorkspacePath, type Target } from '../cli/arguments.js';
import type { AnalysisContext } from '../workspace/context.js';
import type { Catalog } from './catalog.js';
import { matchingElements, type Span, type TemplateIndex } from './templates.js';
import { resolveViewPaths, type ViewPath } from '../resolve/view/index.js';
import type { MazeGraph } from '../adapters/ng-maze/index.js';

export interface IndexedCandidate { candidate: Candidate; path: ViewPath }
const relative = (context: AnalysisContext, file: string): string => path.relative(context.workspaceRoot, file).replaceAll('\\', '/');
function position(context: AnalysisContext, span: Span): SourcePosition {
  return { path: relative(context, span.file), line: span.line, column: span.column, offset: span.start };
}

export function buildIndexedCandidates(context: AnalysisContext, catalog: Catalog, index: TemplateIndex,
  target: Target, maze?: MazeGraph): IndexedCandidate[] {
  const query = target.kind === 'attribute' ? { kind: 'attribute' as const, name: target.name, value: target.value } :
    { kind: 'source' as const, file: resolveWorkspacePath(context.workspaceRoot, target.file), line: target.line };
  const output: IndexedCandidate[] = [];
  for (const element of matchingElements(index, query)) {
    const verifiedMaze = maze ? { ...maze, edges: maze.edges.filter(edge => index.verifiedMazeEdges.includes(edge)) } : undefined;
    const resolution = resolveViewPaths(element, context, catalog, index, 1_000, verifiedMaze);
    for (const view of resolution.paths) {
      const insertion = view.steps.find(part => part.relation === 'template-insertion' || part.relation === 'projection-slot')?.span;
      const tuple = {
        contextId: context.id, ownerId: element.owner.id,
        element: { path: relative(context, element.span.file), start: element.span.start, end: element.span.end },
        usages: view.steps.filter(part => part.relation === 'component-use' && part.span).map(part => position(context, part.span!)),
        routes: [], bootstrapId: null, insertion: insertion ? position(context, insertion) : null,
      };
      const parentIds = [...new Set(view.steps.map(part => part.ownerId))];
      const related = (owner: string | null): boolean => !!owner && (owner === element.owner.id || parentIds.includes(owner));
      const partialReasons = [...element.gaps, ...resolution.diagnostics,
        ...index.diagnostics.filter(message => [element.owner.id, ...parentIds].some(id => message.startsWith(`${id}:`))),
        ...(maze?.diagnostics.filter(item => related(item.owner)).map(item => `${item.code}: ${item.message}`) ?? []),
        ...(maze?.detectionGaps.filter(item => related(item.owner)).map(item => `${item.code}: ${item.message}`) ?? [])];
      if (view.end !== 'root-unresolved') partialReasons.push(view.reason);
      if (context.entryUnknown) partialReasons.push('Bootstrap entry is unknown');
      const candidate = makeCandidate(tuple, { snapshotId: context.snapshot.id,
        class: view.end === 'fragment-uninstantiated' ? 'uninstantiated-fragment' :
          view.end === 'dynamic-boundary' ? 'unresolved-dynamic' : 'declaration',
        parentIds, routePattern: null,
        events: element.events, partialReasons });
      output.push({ candidate, path: view });
    }
  }
  const order = new Map(sortCandidates(output.map(item => item.candidate)).map((candidate, index) => [candidate, index]));
  return output.sort((a, b) => order.get(a.candidate)! - order.get(b.candidate)!);
}
