import type { Evidence, Precision } from './types.js';
/** §5 one inline template segment: template offsets `[from, to)` sit at `sourceStart` in the TS file. */
export interface InlineSegment {
    from: number;
    to: number;
    sourceStart: number;
}
export interface InlineMapping {
    file: string;
    segments: InlineSegment[];
}
export interface EvidenceInput {
    file: string;
    start: number;
    end: number;
    precision?: Precision;
    symbolId?: string | null;
}
export declare class ModelError extends Error {
}
/**
 * §5 evidence store. Offsets are UTF-16 code units over half-open ranges, lines and columns start at 1,
 * and an inline template is recorded against its TS file through the registered mapping table.
 */
export declare class EvidenceTable {
    private readonly input;
    private readonly byId;
    private readonly lineStarts;
    private readonly inline;
    constructor(input: {
        workspaceRoot: string;
        read: (file: string) => string | undefined;
    });
    /** Register where an inline template body lives inside its TS file; `virtualFile` is the template key. */
    registerInline(virtualFile: string, mapping: InlineMapping): void;
    /** Map a span onto the real source file, or null when the inline offsets cannot be converted (§3.1). */
    map(input: EvidenceInput): {
        file: string;
        start: number;
        end: number;
    } | null;
    add(input: EvidenceInput): string;
    tryAdd(input: EvidenceInput): string | null;
    private starts;
    private relative;
    get(id: string): Evidence | undefined;
    list(): Evidence[];
}
