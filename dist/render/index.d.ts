import type { WiringReport } from '../model/types.js';
import { type ProcessNameInput } from './filename.js';
import { type RenderInput, type RenderResult } from './markdown.js';
export * from './filename.js';
export * from './json.js';
export * from './markdown.js';
export * from './sentences.js';
export * from './text.js';
export * from './write.js';
/** §8 the three views read the same report; the selected view controls how much it prints. */
export declare function renderReport(input: RenderInput & {
    json: boolean;
    detail?: boolean;
    belowData?: boolean;
}): RenderResult;
export interface ProduceInput {
    report: WiringReport;
    outDir: string;
    /** Override the workspace root used for numbering (primarily for embedded callers). */
    sequenceRoot?: string;
    json: boolean;
    detail?: boolean;
    belowData?: boolean;
    /** §3.4-4 the local time the analysis started, which names the file. */
    startedAt: Date;
    name: ProcessNameInput;
    signal?: AbortSignal;
}
export interface ProduceResult {
    path: string;
    partial: boolean;
    problems: string[];
}
/**
 * §3.4 the whole document is built and checked in memory first; only then is the file created. Until
 * that file exists the CLI prints nothing, so a half-written report is never announced as a result.
 */
export declare function produceReport(input: ProduceInput): Promise<ProduceResult>;
