import { mkdir } from 'node:fs/promises';
import { assertValidReport, validateAgainstSchema } from '../model/validate.js';
import { buildFileName, processName } from './filename.js';
import { renderJson } from './json.js';
import { renderMarkdown } from './markdown.js';
import { RenderError } from './text.js';
import { writeOutput } from './write.js';
export * from './filename.js';
export * from './json.js';
export * from './markdown.js';
export * from './sentences.js';
export * from './text.js';
export * from './write.js';
/** §8 both renderers take the same intermediate model; only the serialization differs. */
export function renderReport(input) {
    return input.json ? renderJson(input) : renderMarkdown(input);
}
/**
 * §3.4 the whole document is built and checked in memory first; only then is the file created. Until
 * that file exists the CLI prints nothing, so a half-written report is never announced as a result.
 */
export async function produceReport(input) {
    assertValidReport(input.report);
    const schemaProblems = await validateAgainstSchema(input.report);
    if (schemaProblems.length) {
        throw new RenderError(`The report does not match the shipped schema:\n${schemaProblems.join('\n')}`);
    }
    const { raw, heading } = processName(input.name);
    const rendered = renderReport({ report: input.report, outputDir: input.outDir,
        fileNameSource: raw, heading, json: input.json });
    const covered = new Set(rendered.edgeIds);
    const missing = input.report.edges.filter(edge => !covered.has(edge.id));
    if (missing.length) {
        throw new RenderError(`The renderer left ${missing.length} edges out, starting at ${missing[0].id} (${missing[0].kind})`);
    }
    await mkdir(input.outDir, { recursive: true });
    const file = await writeOutput({
        directory: input.outDir, content: rendered.text, signal: input.signal,
        name: collision => buildFileName({ raw, startedAt: input.startedAt, json: input.json, collision }),
    });
    return { path: file, partial: input.report.status === 'partial', problems: rendered.problems };
}
