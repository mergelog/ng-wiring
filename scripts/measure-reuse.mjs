#!/usr/bin/env node
/**
 * §9 there is no persistent cache: within one run the AST and the indexes of the same snapshot and
 * context are reused, and nothing survives the process. This measures that reuse on the CLI's own
 * entry points — the first analysis, a second analysis of the same target, and the write that turns the
 * kept analysis into a report — and prints one JSON line the measurement harness collects (P17-07).
 */
import { performance } from 'node:perf_hooks';
import { parseArguments } from '../dist/cli/arguments.js';
import { filterCandidates, selectCandidate } from '../dist/cli/candidates.js';
import { createBackend } from '../dist/assemble/index.js';

const cwd = process.argv[2];
const parsed = parseArguments(process.argv.slice(3), cwd);
const options = parsed.options;
const backend = createBackend({ cwd });

const start = performance.now();
const first = await backend.analyze(options);
const analyzed = performance.now();
await backend.analyze(options);
const reanalyzed = performance.now();
const selected = selectCandidate(filterCandidates(first.candidates, options), options.candidate);
const written = await backend.write(selected, options);
const end = performance.now();

console.log(JSON.stringify({
  candidates: first.candidates.length,
  analyzeMs: Math.round(analyzed - start),
  reanalyzeMs: Math.round(reanalyzed - analyzed),
  writeMs: Math.round(end - reanalyzed),
  partial: written.partial,
  maxRssKb: process.resourceUsage().maxRSS,
}));
