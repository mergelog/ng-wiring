import { UsageError, type CliOptions } from '../cli/arguments.js';
import type { Candidate } from '../cli/candidates.js';
import type { AnalysisResult, CliBackend } from '../cli/run.js';
import { produceReport } from '../render/index.js';
import { analyzeWorkspace, contextOf, type WorkspaceAnalysis } from './analysis.js';
import { assembleReport } from './report.js';

/** The CLI prints `0.1.0`; the report names the same build. */
export const toolVersion = '0.1.0';

export interface BackendInput { cwd: string; toolVersion?: string; ngmaze?: boolean }

/**
 * §3 the CLI contract over the assembly. `analyze` and `write` are two calls of one run, so the second
 * reuses the Program, catalog and base graph the first built instead of analysing the workspace twice.
 */
export function createBackend(input: BackendInput): CliBackend {
  let cached: { key: string; analysis: WorkspaceAnalysis } | null = null;
  const startedAt = new Date();
  const keyOf = (options: CliOptions): string =>
    JSON.stringify([options.target, options.project ?? null, options.tsconfig ?? null]);
  const analysisFor = async (options: CliOptions, signal?: AbortSignal): Promise<WorkspaceAnalysis> => {
    const key = keyOf(options);
    if (cached?.key === key) return cached.analysis;
    const analysis = await analyzeWorkspace({ options, cwd: input.cwd, signal, ngmaze: input.ngmaze });
    cached = { key, analysis };
    return analysis;
  };
  return {
    async analyze(options, signal): Promise<AnalysisResult> {
      const analysis = await analysisFor(options, signal);
      return { candidates: analysis.candidates.map(item => item.candidate),
        targetDetectionIncomplete: analysis.targetDetectionIncomplete, truncated: analysis.truncated };
    },
    async write(candidate: Candidate, options, signal) {
      const analysis = await analysisFor(options, signal);
      const found = analysis.candidates.find(item => item.candidate.id === candidate.id);
      if (!found) throw new UsageError(`Candidate ${candidate.id} is outside the discovered candidates`);
      // The CLI may hand back a filtered copy; its event list is the selection, the path is the analysed one.
      const selected = { ...found, candidate };
      const report = assembleReport({ analysis: contextOf(analysis, found), selected,
        candidates: analysis.candidates, options, toolVersion: input.toolVersion ?? toolVersion,
        startedAt, enumerationComplete: !analysis.truncated,
        includeAllEvents: !options.detail && !options.json });
      const ownerId = candidate.tuple.ownerId;
      const element = contextOf(analysis, found).index.elements.find(item => item.owner.id === ownerId &&
        item.span.start === candidate.tuple.element.start);
      const result = await produceReport({ report, outDir: options.outDir, json: options.json,
        detail: options.detail, belowData: options.belowData, startedAt,
        signal, name: { target: report.query.target, ownerClass: ownerId.slice(ownerId.lastIndexOf('#') + 1),
          ownerId, elementName: element?.tag } });
      return { path: result.path, partial: result.partial };
    },
  };
}
