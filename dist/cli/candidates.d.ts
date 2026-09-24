export type CandidateClass = 'bootstrap' | 'declaration' | 'uninstantiated-fragment' | 'unresolved-dynamic';
export interface SourcePosition {
    path: string;
    line: number;
    column: number;
    offset: number;
}
export interface CandidateTuple {
    contextId: string;
    ownerId: string;
    element: {
        path: string;
        start: number;
        end: number;
    };
    usages: SourcePosition[];
    routes: {
        definition: SourcePosition;
        loaders: SourcePosition[];
    }[];
    bootstrapId: string | null;
    insertion: SourcePosition | null;
}
export interface Candidate {
    tuple: CandidateTuple;
    snapshotId: string;
    class: CandidateClass;
    parentIds: string[];
    routePattern: string | null;
    events: string[];
    partialReasons: string[];
    eventFilterReason?: string;
    id: string;
}
export declare function canonicalJson(value: unknown): string;
export declare function makeCandidate(tuple: CandidateTuple, details: Omit<Candidate, 'tuple' | 'id'>): Candidate;
export declare function sortCandidates(candidates: readonly Candidate[]): Candidate[];
export declare function matchesEvent(requested: string, actual: string): boolean;
export declare function filterCandidates(candidates: readonly Candidate[], options: {
    through?: string;
    route?: string;
    event?: string;
}): Candidate[];
export declare function selectCandidate(candidates: readonly Candidate[], selector?: string): Candidate | undefined;
export declare function formatCandidateList(candidates: readonly Candidate[], truncated?: boolean): string;
