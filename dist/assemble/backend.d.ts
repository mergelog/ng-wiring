import type { CliBackend } from '../cli/run.js';
/** The CLI prints `0.1.0`; the report names the same build. */
export declare const toolVersion = "0.1.0";
export interface BackendInput {
    cwd: string;
    toolVersion?: string;
    ngmaze?: boolean;
}
/**
 * §3 the CLI contract over the assembly. `analyze` and `write` are two calls of one run, so the second
 * reuses the Program, catalog and base graph the first built instead of analysing the workspace twice.
 */
export declare function createBackend(input: BackendInput): CliBackend;
