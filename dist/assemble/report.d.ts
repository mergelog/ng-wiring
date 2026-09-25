import type { CliOptions } from '../cli/arguments.js';
import type { IndexedCandidate } from '../index/candidates.js';
import { type WiringReport } from '../model/types.js';
import type { ContextAnalysis } from './analysis.js';
export interface AssembleInput {
    analysis: ContextAnalysis;
    selected: IndexedCandidate;
    /** Every candidate of every context, for the candidate list §5 keeps beside the selected context. */
    candidates: readonly IndexedCandidate[];
    options: CliOptions;
    toolVersion: string;
    startedAt: Date;
    enumerationComplete: boolean;
    /** Simple output needs downstream output operations even when --event selects one starting event. */
    includeAllEvents?: boolean;
}
/**
 * §5 the assembly: the analysis layers are normalized into the one model both renderers read. Nothing
 * here decides confidence, coverage or ids on its own; the `ReportBuilder` does that from what is added.
 */
export declare function assembleReport(input: AssembleInput): WiringReport;
