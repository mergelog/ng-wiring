import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWorkspace, assembleReport, contextOf } from '../dist/assemble/index.js';
import { parseAttribute, parseSource } from '../dist/cli/arguments.js';
import { filterCandidates } from '../dist/cli/candidates.js';
import { renderSimple } from '../dist/render/simple.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  process.loadEnvFile(path.join(repo, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const configuredPath = process.env.NGWI_TEST_PROJECT_PATH;
assert(configuredPath, 'Set NGWI_TEST_PROJECT_PATH in .env for the optional ClearML regression');
const workspace = path.resolve(repo, configuredPath);
const outputDir = path.join(repo, 'x-local/tmp/clearml-regression');
await mkdir(outputDir, { recursive: true });

const cases = [
  { id: 'A02-D01', target: 'name=time-frame', route: '/workers-and-queues/workers',
    owner: 'WorkersStatsComponent' },
  { id: 'C03-D02', target: 'data-id=catalogApply', route: '/data-catalog',
    owner: 'CatalogFiltersComponent' },
  { id: 'D05', target: 'src/app/webapp-common/experiments-compare/dumbs/' +
    'experiment-compare-header/experiment-compare-header.component.html:87',
    route: '/projects/:projectId/compare-tasks', owner: 'ExperimentCompareHeaderComponent', event: 'change' },
];

for (const item of cases) {
  const options = {
    target: item.target.includes('=') ? parseAttribute(item.target) : parseSource(item.target),
    project: process.env.NGWI_TEST_PROJECT ?? 'stackup', route: item.route,
    event: item.event, outDir: outputDir,
  };
  const analysis = await analyzeWorkspace({ options, cwd: workspace, ngmaze: true });
  const candidates = filterCandidates(analysis.candidates.map(entry => entry.candidate), options)
    .filter(candidate => candidate.tuple.ownerId.endsWith(`#${item.owner}`));
  assert.equal(candidates.length, 1, `${item.id}: expected one selected owner and route`);
  const selected = analysis.candidates.find(entry => entry.candidate.id === candidates[0].id);
  assert(selected, `${item.id}: candidate is absent from the analysis`);
  const report = assembleReport({
    analysis: contextOf(analysis, selected), selected, candidates: analysis.candidates, options,
    toolVersion: '0.1.0', startedAt: new Date(), enumerationComplete: !analysis.truncated,
  });
  const simple = renderSimple({ report, outputDir }).text;
  const endpoints = report.edges.filter(edge => edge.kind === 'http-create')
    .map(edge => edge.details.urlExpression?.value ?? '');
  if (item.id === 'A02-D01') {
    assert(endpoints.some(endpoint => endpoint.endsWith('/workers.get_activity_report')));
    assert(!endpoints.some(endpoint => /\/(?:tasks|models|projects)\.get_all_ex$/.test(endpoint)));
    assert.match(simple, /selected projection must change for a new emitted value/);
  } else if (item.id === 'C03-D02') {
    assert(endpoints.some(endpoint => endpoint.endsWith('/tasks.get_all_ex')));
    assert(endpoints.some(endpoint => endpoint.endsWith('/models.get_all_ex')));
    const projectIndex = simple.indexOf('projects.get_all_ex');
    assert(projectIndex >= 0, 'the project lookup branch should remain visible');
    const projectCondition = simple.slice(0, projectIndex).split('\n')
      .filter(line => line.includes('条件:')).at(-1) ?? '';
    assert.match(projectCondition, /else of name === ''/,
      'the project lookup must be conditional on a nonempty project name');
  } else {
    assert.equal(endpoints.length, 0, 'the toggle must not acquire an unrelated HTTP request');
    assert(report.edges.some(edge => edge.kind === 'action-consume' &&
      edge.details.consumer?.value?.endsWith('#compareHeader')),
    'the selected route must register the comparison reducer');
    assert.match(simple, /通信: この探索範囲では未検出/);
  }
  const reportPath = path.join(outputDir, `${item.id}.md`);
  await writeFile(reportPath, simple);
  console.log(`${item.id}: ${reportPath}`);
}
