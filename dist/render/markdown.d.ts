import path from 'node:path';
import type { WiringReport } from '../model/types.js';
export interface RenderInput {
    report: WiringReport;
    /** Source links are relative to the file being written, so only its directory matters (§8). */
    outputDir: string;
    /** §3.4-3 the process name before encoding and shortening, kept in the document without loss. */
    fileNameSource: string;
    /** §3.4-1 the displayed form of the target, with the attribute value quoted. */
    heading: string;
    platform?: path.PlatformPath;
}
export interface RenderResult {
    text: string;
    edgeIds: string[];
    problems: string[];
}
/**
 * §8 the Markdown report. Every relation comes from the closed sentence table, every sentence ends with
 * its evidence link and the conditions or unresolved reasons it needs, and nothing here re-derives
 * confidence or coverage: those are read from the model as the single source (§5).
 */
export declare function renderMarkdown(input: RenderInput): RenderResult;
