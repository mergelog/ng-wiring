import { createInterface } from 'node:readline/promises';
import { mkdir } from 'node:fs/promises';
import { parseArguments, UsageError } from './arguments.js';
import { filterCandidates, formatCandidateList, selectCandidate } from './candidates.js';
export const help = `Usage: ng-wiring ATTRIBUTE=VALUE [options]
       ng-wiring --source PATH:LINE [options]
Options: --project NAME | --tsconfig PATH, --through CLASS|PATH#CLASS,
         --route PATH, --candidate NUMBER|cand:SHA256, --event NAME,
         --out-dir DIR, --json, --help, --version
`;
export async function runCli(argv, backend, io, cwd = process.cwd()) {
    try {
        const parsed = parseArguments(argv, cwd);
        if (parsed.kind === 'help') {
            io.stdout.write(help);
            return 0;
        }
        if (parsed.kind === 'version') {
            io.stdout.write('0.1.0\n');
            return 0;
        }
        const options = parsed.options;
        const result = await backend.analyze(options);
        const candidates = filterCandidates(result.candidates, options);
        if (!candidates.length) {
            io.stderr.write(result.targetDetectionIncomplete ? 'Target detection incomplete\n' : 'No matching target\n');
            return result.targetDetectionIncomplete ? 5 : 1;
        }
        let selected = selectCandidate(candidates, options.candidate);
        if (result.truncated && !options.candidate)
            selected = undefined;
        if (!selected) {
            io.stderr.write(`${formatCandidateList(candidates, result.truncated)}\n`);
            if (io.stdin.isTTY && io.stderr.isTTY && !result.truncated) {
                const rl = createInterface({ input: io.stdin, output: io.stderr, terminal: true });
                try {
                    const answer = await rl.question('Select candidate number or ID: ');
                    if (!answer)
                        return 2;
                    selected = selectCandidate(candidates, answer.trim());
                }
                catch (error) {
                    if (error.name === 'AbortError' || error.code === 'ERR_USE_AFTER_CLOSE')
                        return 2;
                    throw error;
                }
                finally {
                    rl.close();
                }
            }
            else
                return 2;
        }
        if (!selected)
            return 2;
        await mkdir(options.outDir, { recursive: true });
        const output = await backend.write(selected, options);
        io.stdout.write(`${output.path}\n`);
        return output.partial || selected.partialReasons.length > 0 ? 5 : 0;
    }
    catch (error) {
        io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return error instanceof UsageError ? 3 : 4;
    }
}
