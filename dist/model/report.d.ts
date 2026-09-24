import { ConditionTable } from './conditions.js';
import { type EvidenceTable } from './evidence.js';
import { type GapScope, type RawGap } from './gaps.js';
import { type Confidence, type DetailField, type EdgeKind, type EdgeOrigin, type GapRelation, type LimitsReport, type NodeKind, type OccurrenceKey, type PathEnd, type ReportContext, type ReportQuery, type ReportSelection, type Severity, type WiringReport } from './types.js';
export interface ReportBuilderInput {
    toolVersion: string;
    snapshotId: string;
    generatedAt: string;
    context: ReportContext;
    query: ReportQuery;
    evidence: EvidenceTable;
    conditions?: ConditionTable;
}
/** §3.4-4 the local analysis time with its UTC offset, as the report and the file name both need it. */
export declare function localIsoString(date: Date): string;
/**
 * §5 the single place where the analysis result is normalized. Markdown and JSON are both rendered from
 * the `WiringReport` this produces, so neither renderer re-derives confidence, coverage or ids.
 */
export declare class ReportBuilder {
    private readonly input;
    readonly evidence: EvidenceTable;
    readonly conditions: ConditionTable;
    private readonly contextId;
    private readonly nodes;
    private readonly edges;
    private readonly diagnostics;
    private readonly gaps;
    private readonly paths;
    private readonly operations;
    private limitsReport;
    private selection;
    constructor(input: ReportBuilderInput);
    private put;
    /** A declaration site: the class, symbol, route or type itself, independent of where it is used. */
    definition(input: {
        kind: NodeKind;
        symbolId: string;
        evidenceIds: readonly string[];
        details?: Record<string, DetailField>;
    }): string;
    /** A use site. The key keeps the owner, span and insertion/projection/route setting apart (§5). */
    occurrence(input: {
        kind: NodeKind;
        key: Omit<OccurrenceKey, 'contextId'>;
        evidenceIds: readonly string[];
        details?: Record<string, DetailField>;
    }): string;
    /** §5 the unknown end of an exploration. Never stand in for a guessed concrete target. */
    boundary(input: {
        reason: string;
        lastConfirmed: string;
        evidenceIds: readonly string[];
        details?: Record<string, DetailField>;
    }): string;
    /** Direction is parent to child and cause to receiver; the renderer walks it backwards (§5). */
    edge(input: {
        kind: EdgeKind;
        from: string;
        to: string;
        evidenceIds: readonly string[];
        confidence: Confidence;
        origin: EdgeOrigin;
        conditionId?: string | null;
        details?: Record<string, DetailField>;
    }): string;
    path(input: {
        occurrenceIds: readonly string[];
        edgeIds: readonly string[];
        declarationIds?: readonly string[];
        end: PathEnd;
        endReason: string;
        coverageReasons?: readonly string[];
    }): string;
    operation(input: {
        event: string;
        eventId: string;
        listenerId: string;
        nodeIds: readonly string[];
        edgeIds: readonly string[];
        coverageReasons?: readonly string[];
    }): string;
    /** §5 a configuration error has no source span, so evidence may stay empty. */
    diagnostic(input: {
        code: string;
        severity: Severity;
        message: string;
        evidenceIds?: readonly string[];
        relatedIds?: readonly string[];
        stopReason?: string | null;
    }): string;
    /** §8 every detection gap is kept with how it relates to the selection. */
    gap(input: {
        code: string;
        message: string;
        relation: GapRelation;
        owner?: string | null;
        candidates?: readonly string[];
        evidenceIds?: readonly string[];
        resolvedBy?: string | null;
        resolvedReason?: string | null;
    }): string;
    /**
     * §8 the association step: place the reported gaps against the selection and record each one with the
     * relation it earned. The reason behind every decision is returned so the caller can report it.
     */
    relateGaps(gaps: readonly RawGap[], scope: GapScope): {
        id: string;
        relation: GapRelation;
        reason: string;
    }[];
    limits(report: LimitsReport): void;
    select(selection: ReportSelection): void;
    build(): WiringReport;
}
