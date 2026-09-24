import type { Readable, Writable } from 'node:stream';
import { type CliOptions } from './arguments.js';
import { type Candidate } from './candidates.js';
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130;
export interface AnalysisResult {
    candidates: Candidate[];
    targetDetectionIncomplete: boolean;
    truncated: boolean;
}
export interface CliBackend {
    analyze(options: CliOptions, signal?: AbortSignal): Promise<AnalysisResult>;
    write(candidate: Candidate, options: CliOptions, signal?: AbortSignal): Promise<{
        path: string;
        partial: boolean;
    }>;
}
export interface Io {
    stdin: Readable & {
        isTTY?: boolean;
    };
    stdout: Writable;
    stderr: Writable & {
        isTTY?: boolean;
    };
}
export declare const help = "Usage: ng-wiring ATTRIBUTE=VALUE [options]\n       ng-wiring --source PATH:LINE [options]\nOptions: --project NAME | --tsconfig PATH, --through CLASS|PATH#CLASS,\n         --route PATH, --candidate NUMBER|cand:SHA256, --event NAME,\n         --out-dir DIR, --json, --help, --version\n";
export declare function runCli(argv: readonly string[], backend: CliBackend, io: Io, cwd?: string, signal?: AbortSignal): Promise<ExitCode>;
