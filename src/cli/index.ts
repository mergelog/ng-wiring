#!/usr/bin/env node
import { runCli, type CliBackend } from './run.js';
import { UsageError } from './arguments.js';

// The argument contract and both renderers are in place; assembling the analysis layers into the
// intermediate model the renderers read is P16.
const backend: CliBackend = {
  async analyze() { throw new UsageError('Analysis backend is not implemented yet (P16)'); },
  async write() { throw new Error('The analysis is not assembled into a report yet (P16)'); },
};
const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.exitCode = await runCli(process.argv.slice(2), backend, process, process.cwd(), cancellation.signal);
