import { createInterface } from 'node:readline/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { parseArguments, UsageError, type CliOptions } from './arguments.js';
import { filterCandidates, formatCandidateList, selectCandidate, type Candidate } from './candidates.js';

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130;
export interface AnalysisResult { candidates: Candidate[]; targetDetectionIncomplete: boolean; truncated: boolean }
export interface CliBackend {
  analyze(options: CliOptions, signal?: AbortSignal): Promise<AnalysisResult>;
  write(candidate: Candidate, options: CliOptions, signal?: AbortSignal): Promise<{ path: string; partial: boolean }>;
}
export interface Io { stdin: Readable & { isTTY?: boolean }; stdout: Writable; stderr: Writable & { isTTY?: boolean } }

export const help = `Usage: ng-wiring ATTRIBUTE=VALUE [options]
       ng-wiring --source PATH:LINE [options]
Options: --project NAME | --tsconfig PATH, --through CLASS|PATH#CLASS,
         --route PATH, --candidate NUMBER|cand:SHA256, --event NAME,
         --out-dir DIR, --json, --help, --version
`;

export async function runCli(argv: readonly string[], backend: CliBackend, io: Io, cwd = process.cwd(), signal?: AbortSignal): Promise<ExitCode> {
  try {
    if (signal?.aborted) return 130;
    const parsed = parseArguments(argv, cwd);
    if (parsed.kind === 'help') { io.stdout.write(help); return 0; }
    if (parsed.kind === 'version') { io.stdout.write('0.1.0\n'); return 0; }
    const options = parsed.options;
    const result = await backend.analyze(options, signal);
    if (signal?.aborted) return 130;
    const filtered = filterCandidates(result.candidates, options);
    const truncated = result.truncated || filtered.length > 1_000;
    const candidates = filtered.slice(0, 1_000);
    if (!candidates.length) {
      io.stderr.write(result.targetDetectionIncomplete ? 'Target detection incomplete\n' : 'No matching target\n');
      return result.targetDetectionIncomplete ? 5 : 1;
    }
    let selected: Candidate | undefined;
    try { selected = selectCandidate(candidates, options.candidate); }
    catch (error) {
      if (truncated && error instanceof UsageError) throw new UsageError(`${error.message}. Narrow with --through, --route, or --project`);
      throw error;
    }
    if (truncated && !options.candidate) selected = undefined;
    if (!selected) {
      io.stderr.write(`${formatCandidateList(candidates, truncated)}\n`);
      if (io.stdin.isTTY && io.stderr.isTTY && !truncated) {
        const rl = createInterface({ input: io.stdin, output: io.stderr, terminal: true });
        try {
          io.stderr.write('Select candidate number or ID: ');
          const answer = await new Promise<string | undefined>(resolve => {
            rl.once('line', line => resolve(line));
            rl.once('close', () => resolve(undefined));
            signal?.addEventListener('abort', () => { rl.close(); resolve(undefined); }, { once: true });
          });
          if (!answer) return signal?.aborted ? 130 : 2;
          selected = selectCandidate(candidates, answer.trim());
        } finally { rl.close(); }
      } else return 2;
    }
    if (!selected) return 2;
    if (signal?.aborted) return 130;
    await mkdir(options.outDir, { recursive: true });
    const output = await backend.write(selected, options, signal);
    if (signal?.aborted) return 130;
    if (!path.isAbsolute(output.path)) throw new Error('Renderer returned a non-absolute output path');
    io.stdout.write(`${output.path}\n`);
    return output.partial || selected.partialReasons.length > 0 ? 5 : 0;
  } catch (error) {
    if (signal?.aborted) return 130;
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof UsageError ? 3 : 4;
  }
}
