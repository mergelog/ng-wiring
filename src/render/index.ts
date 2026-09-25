import { mkdir } from 'node:fs/promises';
import { assertValidReport, validateAgainstSchema } from '../model/validate.js';
import type { WiringReport } from '../model/types.js';
import { buildFileName, processName, type ProcessNameInput } from './filename.js';
import { renderJson } from './json.js';
import { renderMarkdown, type RenderInput, type RenderResult } from './markdown.js';
import { renderSimple } from './simple.js';
import { RenderError } from './text.js';
import { writeOutput } from './write.js';

export * from './filename.js';
export * from './json.js';
export * from './markdown.js';
export * from './sentences.js';
export * from './text.js';
export * from './write.js';

/** §8 the three views read the same report; the selected view controls how much it prints. */
export function renderReport(input: RenderInput & { json: boolean; detail?: boolean; belowData?: boolean }): RenderResult {
  return input.json ? renderJson(input) : input.detail ? renderMarkdown(input) : renderSimple(input);
}

export interface ProduceInput {
  report: WiringReport;
  outDir: string;
  /** Override the workspace root used for numbering (primarily for embedded callers). */
  sequenceRoot?: string;
  json: boolean;
  detail?: boolean;
  belowData?: boolean;
  /** §3.4-4 the local time the analysis started, which names the file. */
  startedAt: Date;
  name: ProcessNameInput;
  signal?: AbortSignal;
}
export interface ProduceResult { path: string; partial: boolean; problems: string[] }

/**
 * §3.4 the whole document is built and checked in memory first; only then is the file created. Until
 * that file exists the CLI prints nothing, so a half-written report is never announced as a result.
 */
export async function produceReport(input: ProduceInput): Promise<ProduceResult> {
  assertValidReport(input.report);
  const schemaProblems = await validateAgainstSchema(input.report);
  if (schemaProblems.length) {
    throw new RenderError(`The report does not match the shipped schema:\n${schemaProblems.join('\n')}`);
  }
  const { raw, heading } = processName(input.name);
  const rendered = renderReport({ report: input.report, outputDir: input.outDir,
    fileNameSource: raw, heading, json: input.json, detail: input.detail, belowData: input.belowData });
  const covered = new Set(rendered.edgeIds);
  const missing = input.report.edges.filter(edge => !covered.has(edge.id));
  if (missing.length && (input.json || input.detail)) {
    throw new RenderError(`The renderer left ${missing.length} edges out, starting at ${missing[0]!.id} (${missing[0]!.kind})`);
  }
  await mkdir(input.outDir, { recursive: true });
  const file = await writeOutput({
    directory: input.outDir, sequenceRoot: input.sequenceRoot ?? input.report.context.workspaceRoot,
    content: rendered.text, signal: input.signal,
    name: sequence => buildFileName({ raw, startedAt: input.startedAt, json: input.json, sequence }),
  });
  return { path: file, partial: input.report.status === 'partial', problems: rendered.problems };
}
