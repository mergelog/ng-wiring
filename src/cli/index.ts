#!/usr/bin/env node
import { runCli, type CliBackend } from './run.js';
import { UsageError } from './arguments.js';

// The parser is usable now; graph analysis and rendering are added in P3–P14.
const backend: CliBackend = {
  async analyze() { throw new UsageError('Analysis backend is not implemented yet (P3–P14)'); },
  async write() { throw new Error('Renderer is not implemented yet'); },
};
process.exitCode = await runCli(process.argv.slice(2), backend, process);
