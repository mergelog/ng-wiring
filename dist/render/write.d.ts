/** §3.4-5 a lock held by another run is not removed; the CLI turns this into exit code 4. */
export declare class OutputLockError extends Error {
}
export declare class OutputWriteError extends Error {
}
export interface WriteOutputInput {
    directory: string;
    /** Builds the name for attempt 0, 1, 2… so the collision suffix stays on the process name side. */
    name: (collision: number) => string;
    content: string;
    signal?: AbortSignal;
}
/**
 * §3.4-5 comparison and creation are serialized through `.ng-wiring-output.lock`, both the lock and the
 * report are created with `wx`, and an existing file is never overwritten. §3.4 the caller has already
 * verified the whole document, so a failure here only has to remove the incomplete file this run made.
 */
export declare function writeOutput(input: WriteOutputInput): Promise<string>;
