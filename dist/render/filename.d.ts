import type { QueryTarget } from '../model/types.js';
export declare const outputLockName = ".ng-wiring-output.lock";
export interface ProcessNameInput {
    target: QueryTarget;
    /** The class that owns the selected element; the file name and the heading both start from it. */
    ownerClass: string;
    /** `workspace relative TS path#ClassName` of that owner, used for the `--source` path hash. */
    ownerId: string;
    /** Tag name of the selected element, required for a `--source` target. */
    elementName?: string;
}
/** §3.4-1 the path hash of a `--source` name: the owning ComponentId and the source path. */
export declare function pathHash(ownerId: string, file: string): string;
/**
 * §3.4-1 step 1. The file name keeps the attribute value without the outer syntactic quotes, while the
 * heading shows it quoted. Quotes inside the value are part of the value and stay in both.
 */
export declare function processName(input: ProcessNameInput): {
    raw: string;
    heading: string;
};
/**
 * §3.4-2 step 2. Only the string used for the file name is NFC normalized; the matching value and the
 * identifiers in the document are left as they were read.
 */
export declare function encodeName(raw: string): string;
export declare const nameLimit = 160;
export declare const nameKept = 140;
/** §3.4-3 step 3. Shortening never splits a `%HH` triple, and the original stays in the document. */
export declare function shortenName(encoded: string, raw: string): string;
/** §3.4-4 step 4. The local time the analysis started, as the fixed-width `YYMMDD.HHMMSS` stamp. */
export declare function timestamp(date: Date): string;
export interface FileNameInput {
    raw: string;
    startedAt: Date;
    json: boolean;
    sequence: number;
}
/** `ngwi-{sequence}-{process name}-{YYMMDD.HHMMSS}.md`; the sequence grows past two digits. */
export declare function buildFileName(input: FileNameInput): string;
/** The fixed-width stamp keeps the name decomposable even when the process name holds `-` or `.`. */
export declare const fileNamePattern: RegExp;
