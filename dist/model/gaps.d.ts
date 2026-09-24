import type { CoverageGap, GapRelation } from './types.js';
/** §8 a detection gap as ngmaze or a local analyzer reports it, before it is placed against the selection. */
export interface RawGap {
    code: string;
    message: string;
    /** `path#Class[.member]`, or null when the reporter could not name an owner. */
    owner?: string | null;
    /** Ids the reporter could not decide between; one of them inside the selection makes the gap local. */
    candidates?: readonly string[];
    /** Workspace relative file the gap was found in, when it has a location. */
    file?: string | null;
    evidenceIds?: readonly string[];
    /** §8 what ng-wiring filled the gap with and on what grounds; the original record stays either way. */
    resolvedBy?: string | null;
    resolvedReason?: string | null;
}
/**
 * §8 a place where enumeration stopped. While one of these applies to a gap, a missed candidate cannot
 * be ruled out for it, so the gap is promoted to a related one instead of being filed away as unrelated.
 * An entry without an owner and without a file is a problem of the whole scope and covers every gap.
 */
export interface ScopeIncompleteness {
    reason: string;
    owner?: string | null;
    file?: string | null;
}
/** §8 what the selected display path and its events reached, and where the enumeration stopped. */
export interface GapScope {
    /** Owner ids explored for the selection: components, directives, services and their members. */
    owners: readonly string[];
    /** The selection's own candidate targets. */
    targets: readonly string[];
    /** Files of the routes, directives and services that belong to the selection. */
    files: readonly string[];
    /** Catalog gaps and scope-wide problems that leave a candidate omission possible. */
    incomplete?: readonly ScopeIncompleteness[];
}
export interface GapPlacement {
    relation: GapRelation;
    reason: string;
}
export type PlacedGap = RawGap & GapPlacement;
/** Two reports of the same gap keep the closest association either of them showed (§8). */
export declare function strongestRelation(relations: Iterable<GapRelation>): GapRelation;
/**
 * §8 place one gap against the selection. The owner alone never decides it: an unrelated owner still
 * becomes a local gap through its candidates or its location, an owner-less gap is placed the same way,
 * and a gap whose candidate omission cannot be ruled out is promoted instead of being filed as unrelated.
 */
export declare function placeGap(gap: RawGap, scope: GapScope): GapPlacement;
export declare function placeGaps(gaps: readonly RawGap[], scope: GapScope): PlacedGap[];
/** §8 the gaps that still count as missing: related, and not filled in by ng-wiring itself. */
export declare const activeGaps: (gaps: readonly CoverageGap[]) => CoverageGap[];
