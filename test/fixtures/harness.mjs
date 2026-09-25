import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAttribute, parseSource } from '../../dist/cli/arguments.js';
import { linkTargetWorkspace } from './target.mjs';
import { analyzeWorkspace, assembleReport, contextOf } from '../../dist/assemble/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.dirname(path.dirname(here));
export const fixtureRoot = here;

/**
 * §10 a fixture is a checked-in workspace. It is copied to a temporary root that declares its toolchain
 * and links `node_modules` to this repository, so the run resolves the pinned TypeScript and Angular
 * the analysis requires and no output lands next to the committed sources.
 */
export async function withFixture(name, run) {
  const root = await mkdtemp(path.join(tmpdir(), `ngwi-fx-${name}-`));
  try {
    await cp(path.join(fixtureRoot, name), root, { recursive: true });
    await linkTargetWorkspace(root);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const targetFor = (target) => target.includes('=') && !target.includes(':')
  ? parseAttribute(target) : parseSource(target);

export function optionsFor(input) {
  return {
    target: targetFor(input.target),
    project: input.project, tsconfig: input.tsconfig, through: input.through, route: input.route,
    selector: input.selector,
    candidate: input.candidate, event: input.event,
    outDir: input.outDir ?? '.', json: input.json ?? false,
  };
}

/**
 * Runs the whole pipeline on a fixture and returns the report for the selected candidate, together
 * with the candidate list so a test can check what the enumeration found before the selection.
 */
export async function analyzeFixture(name, input) {
  return withFixture(name, async (root) => {
    const options = optionsFor(input);
    const analysis = await analyzeWorkspace({ options, cwd: root, ngmaze: input.ngmaze !== false });
    const pick = input.pick ?? ((candidates) => candidates[0]);
    const selected = pick(analysis.candidates, analysis);
    const report = selected ? assembleReport({
      analysis: contextOf(analysis, selected), selected, candidates: analysis.candidates, options,
      toolVersion: '0.1.0', startedAt: new Date(), enumerationComplete: !analysis.truncated,
    }) : null;
    return await (input.then ?? (value => value))({ root, analysis, options, selected, report });
  });
}

const labelOf = (report, id) => {
  const node = report.nodes.find(item => item.id === id);
  if (!node) return id;
  const explicit = node.details.label?.value ?? node.details.name?.value;
  if (explicit) return explicit;
  if (node.role === 'definition') return node.id.slice('def:'.length);
  return node.kind;
};

/** `kind|from|to` for every edge, the form the expectation ledger and the fixture tests compare. */
export function edgeKeys(report) {
  return report.edges.map(edge => `${edge.kind}|${labelOf(report, edge.from)}|${labelOf(report, edge.to)}`);
}

export function edgesOfKind(report, kind) {
  return report.edges.filter(edge => edge.kind === kind)
    .map(edge => ({ ...edge, fromLabel: labelOf(report, edge.from), toLabel: labelOf(report, edge.to) }));
}

/** Every gap, diagnostic code and coverage reason a fixture may assert on. */
export function findings(report) {
  return {
    diagnosticCodes: [...new Set(report.diagnostics.map(item => item.code))],
    gapCodes: [...new Set(report.coverage.gaps.map(item => item.code))],
    activeGaps: report.coverage.gaps.filter(item => item.relation === 'related' && !item.resolvedBy),
    filledGaps: report.coverage.gaps.filter(item => item.resolvedBy),
    stopReasons: report.diagnostics.filter(item => item.stopReason).map(item => item.stopReason),
  };
}
