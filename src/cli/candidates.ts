import { createHash } from 'node:crypto';
import { parseDomSelector, UsageError } from './arguments.js';

export type CandidateClass = 'bootstrap' | 'declaration' | 'uninstantiated-fragment' | 'unresolved-dynamic';
export interface SourcePosition { path: string; line: number; column: number; offset: number }
export interface CandidateTuple {
  contextId: string;
  ownerId: string;
  element: { path: string; start: number; end: number };
  usages: SourcePosition[];
  routes: { definition: SourcePosition; loaders: SourcePosition[] }[];
  bootstrapId: string | null;
  insertion: SourcePosition | null;
}
export interface Candidate {
  tuple: CandidateTuple;
  snapshotId: string;
  class: CandidateClass;
  parentIds: string[];
  /** Display-path component host tags and selected template tag; not part of the stable ID. */
  dom?: { componentTags: string[]; targetTag: string };
  routePattern: string | null;
  events: string[];
  partialReasons: string[];
  eventFilterReason?: string;
  id: string;
}

function pointCodeCompare(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return x.length - y.length;
}

function normalizePath(input: string): string {
  return input.replaceAll('\\', '/');
}

function positionKey(position: SourcePosition): [string, number, number, number] {
  return [normalizePath(position.path), position.line, position.column, position.offset];
}

function comparePosition(a: SourcePosition, b: SourcePosition): number {
  const x = positionKey(a), y = positionKey(b);
  return pointCodeCompare(x[0], y[0]) || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort(pointCodeCompare).map(key => `${JSON.stringify(key)}:${canonicalJson(object[key] ?? null)}`).join(',')}}`;
}

export function makeCandidate(tuple: CandidateTuple, details: Omit<Candidate, 'tuple' | 'id'>): Candidate {
  const paths = [tuple.ownerId.split('#')[0]!, tuple.element.path,
    ...tuple.usages.map(p => p.path), ...tuple.routes.flatMap(r => [r.definition.path, ...r.loaders.map(p => p.path)]),
    ...(tuple.insertion ? [tuple.insertion.path] : [])];
  if (paths.some(p => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))) {
    throw new UsageError('Candidate identity paths must be workspace-relative');
  }
  const stableTuple: CandidateTuple = {
    contextId: tuple.contextId,
    ownerId: normalizePath(tuple.ownerId),
    element: { ...tuple.element, path: normalizePath(tuple.element.path) },
    usages: [...tuple.usages].sort(comparePosition).map(p => ({ ...p, path: normalizePath(p.path) })),
    routes: [...tuple.routes].map(route => ({
      definition: { ...route.definition, path: normalizePath(route.definition.path) },
      loaders: [...route.loaders].sort(comparePosition).map(p => ({ ...p, path: normalizePath(p.path) })),
    })).sort((a, b) => comparePosition(a.definition, b.definition)),
    bootstrapId: tuple.bootstrapId && normalizePath(tuple.bootstrapId),
    insertion: tuple.insertion && { ...tuple.insertion, path: normalizePath(tuple.insertion.path) },
  };
  const hash = createHash('sha256').update(canonicalJson(stableTuple), 'utf8').digest('hex');
  return { ...details, tuple: stableTuple, id: `cand:${hash}` };
}

export function sortCandidates(candidates: readonly Candidate[]): Candidate[] {
  const comparePositions = (left: SourcePosition[], right: SourcePosition[]): number => {
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const result = comparePosition(left[i]!, right[i]!);
      if (result) return result;
    }
    return left.length - right.length;
  };
  return [...candidates].sort((a, b) => {
    const x = a.tuple, y = b.tuple;
    return pointCodeCompare(x.contextId, y.contextId)
      || pointCodeCompare(x.ownerId, y.ownerId)
      || pointCodeCompare(x.element.path, y.element.path)
      || x.element.start - y.element.start || x.element.end - y.element.end
      || comparePositions(x.usages, y.usages)
      || comparePositions(x.routes.map(r => r.definition), y.routes.map(r => r.definition))
      || comparePositions(x.routes.flatMap(r => r.loaders), y.routes.flatMap(r => r.loaders))
      || pointCodeCompare(x.bootstrapId ?? '', y.bootstrapId ?? '')
      || comparePositions(x.insertion ? [x.insertion] : [], y.insertion ? [y.insertion] : []);
  });
}

export function matchesEvent(requested: string, actual: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase();
  const query = normalize(requested), event = normalize(actual);
  return query.includes('.') ? event === query : event === query || event.startsWith(`${query}.`);
}

export function filterCandidates(candidates: readonly Candidate[], options: {
  through?: string; route?: string; selector?: string; event?: string;
}): Candidate[] {
  let selected = [...candidates];
  if (options.through) {
    const through = normalizePath(options.through);
    if (!through.includes('#')) {
      const ids = new Set(selected.flatMap(c => c.parentIds).filter(id => id.endsWith(`#${through}`)));
      if (ids.size > 1) throw new UsageError(`Ambiguous --through ${through}: ${[...ids].sort(pointCodeCompare).join(', ')}`);
      selected = selected.filter(c => c.parentIds.some(id => id.endsWith(`#${through}`)));
    } else selected = selected.filter(c => c.parentIds.map(normalizePath).includes(through));
  }
  if (options.route !== undefined) selected = selected.filter(c => c.routePattern === options.route);
  if (options.selector) {
    if (!selected.length) return [];
    const tags = parseDomSelector(options.selector);
    const known = new Set(selected.flatMap(candidate => candidate.dom?.componentTags ?? []));
    const componentTags = tags.filter(tag => known.has(tag));
    if (!componentTags.length) {
      throw new UsageError('--selector contains no component host tag found in the candidates');
    }
    const targetTag = tags.at(-1)!;
    // Angular Material inserts this wrapper around an authored form control.
    // DevTools may copy the wrapper selector even when the supplied attribute is on its child input.
    const materialInputWrapper = /^div\.mat-mdc-form-field-infix(?:[.#:\[]|$)/i.test(
      options.selector.split('>').at(-1)?.trim() ?? '');
    selected = selected.filter(candidate => {
      if (!candidate.dom || (candidate.dom.targetTag !== targetTag &&
        !(materialInputWrapper && ['input', 'textarea'].includes(candidate.dom.targetTag)))) return false;
      const path = candidate.dom.componentTags;
      return componentTags.length <= path.length &&
        componentTags.every((tag, index) => path[path.length - componentTags.length + index] === tag);
    });
  }
  // Event filtering selects listener paths; an element with no matching listener
  // remains reportable so the renderer can explain the missing listener.
  if (options.event) selected = selected.map(c => ({ ...c,
    events: c.events.filter(name => matchesEvent(options.event!, name)),
    eventFilterReason: c.events.some(name => matchesEvent(options.event!, name))
      ? undefined : `No listener matched ${options.event}`,
  }));
  return sortCandidates(selected);
}

export function selectCandidate(candidates: readonly Candidate[], selector?: string): Candidate | undefined {
  if (selector === undefined) return candidates.length === 1 ? candidates[0] : undefined;
  const item = selector.startsWith('cand:') ? candidates.find(c => c.id === selector) : candidates[Number(selector) - 1];
  if (!item) throw new UsageError(`Candidate ${selector} is outside the discovered candidates`);
  return item;
}

export function formatCandidateList(candidates: readonly Candidate[], truncated = false): string {
  const lines = candidates.flatMap((candidate, index) => {
    const componentIds = candidate.parentIds.filter(id => id !== candidate.tuple.bootstrapId);
    const chain = (componentIds.length ? componentIds : [candidate.tuple.ownerId])
      .map(id => id.slice(id.lastIndexOf('#') + 1)).reverse().join(' -> ');
    const usages = candidate.tuple.usages.length
      ? candidate.tuple.usages.map(site => `${site.path}:${site.line}`).join(', ')
      : '(none)';
    return [
      `${index + 1}. [${candidate.class}] route: ${candidate.routePattern ?? '(none)'}`,
      `   path: ${chain}`,
      `   use: ${usages}`,
      `   target: ${candidate.tuple.element.path} (offset ${candidate.tuple.element.start}); ID: ${candidate.id}`,
    ];
  });
  if (truncated) lines.push('Candidate enumeration was truncated. Narrow with --through, --route, or --project.');
  return lines.join('\n');
}
