/** §3.4-5 a lock held by another run is not removed; the CLI turns this into exit code 4. */
export declare class OutputLockError extends Error {
}
export declare class OutputWriteError extends Error {
}
export interface WriteOutputInput {
    directory: string;
    /** The Angular workspace root. Defaults to the output directory for direct callers. */
    sequenceRoot?: string;
    name: (sequence: number) => string;
    content: string;
    signal?: AbortSignal;
}
/**
 * Number allocation and creation are serialized through `.ng-wiring-output.lock` at the sequence root.
 * The completed report is renamed into place, so a same-name file is replaced only after writing succeeds.
 */
export declare function writeOutput(input: WriteOutputInput): Promise<string>;
