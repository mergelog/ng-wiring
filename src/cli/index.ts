#!/usr/bin/env node
import { runCli } from './run.js';
import { createBackend } from '../assemble/index.js';

const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
const backend = createBackend({ cwd: process.cwd() });
process.exitCode = await runCli(process.argv.slice(2), backend, process, process.cwd(), cancellation.signal);
