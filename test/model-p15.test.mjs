import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConditionTable, EvidenceTable, ReportBuilder, activeGaps, detail, placeGap, placeGaps, strongestRelation,
  validateAgainstSchema, validateReport,
} from '../dist/model/index.js';
import { renderJson, renderMarkdown } from '../dist/render/index.js';

const hex = (char) => char.repeat(64);

const rootHtml = '<app-search data-id="targetInput"></app-search>\n';
const searchTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-search', template: '<input data-id="targetInput">' })\n` +
  `export class SearchComponent {\n  load() { return this.client.search(); }\n}\n`;
const rootTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-root', templateUrl: './root.component.html' })\n` +
  `export class RootComponent {}\n`;
const serviceTs = 'export class SearchService {\n  search() { return this.http.get(this.url); }\n}\n';
const files = new Map([
  ['src/app/root.component.html', rootHtml],
  ['src/app/root.component.ts', rootTs],
  ['src/app/search.component.ts', searchTs],
  ['src/app/search.service.ts', serviceTs],
]);
const at = (file, text) => ({ file, start: files.get(file).indexOf(text), end: files.get(file).indexOf(text) + text.length });

const SEARCH = 'src/app/search.component.ts#SearchComponent';
const ROOT = 'src/app/root.component.ts#RootComponent';
const SERVICE_FILE = 'src/app/search.service.ts';

/** §8 what the selected path and its events reached: owners, the selected target and the related files. */
const scope = {
  owners: [SEARCH, `${SEARCH}.load`, 'src/app/search.service.ts#SearchService'],
  targets: [ROOT],
  files: [SERVICE_FILE, 'src/app/routes.ts'],
};

const rawGaps = [
  // The owner is a member of an explored class, so the gap belongs to this selection.
  { code: 'unresolved-provider', message: 'No provider found for SEARCH_CLIENT', owner: `${SEARCH}.load` },
  // §8 the owner alone must not decide: a foreign owner still lands here through its candidates.
  { code: 'ambiguous-selector', message: 'Two components match app-search',
    owner: 'src/other/widget.component.ts#WidgetComponent', candidates: ['src/other/x.ts#X', SEARCH] },
  // §8 owner=null is placed by its location as well.
  { code: 'template-unparsed', message: 'A template expression was skipped', owner: null, file: `./${SERVICE_FILE}` },
  { code: 'unknown-owner', message: 'A template was skipped in an unidentified file', owner: null },
  { code: 'dynamic-import', message: 'Unanalyzed import in src/other/a.ts', owner: 'src/other/a.ts#A', file: 'src/other/a.ts' },
  { code: 'dynamic-import', message: 'Unanalyzed import in src/other/b.ts', owner: 'src/other/b.ts#B', file: 'src/other/b.ts' },
];

test('a gap is placed by its owner, its candidates or its location, never by the owner alone', () => {
  const placed = placeGaps(rawGaps, scope);
  assert.deepEqual(placed.map((gap) => gap.relation),
    ['related', 'related', 'related', 'global-unknown', 'unrelated', 'unrelated']);
  assert.match(placed[0].reason, /owner src\/app\/search\.component\.ts#SearchComponent\.load is the explored path/);
  assert.match(placed[1].reason, /candidate src\/app\/search\.component\.ts#SearchComponent is the explored path/);
  assert.match(placed[2].reason, /src\/app\/search\.service\.ts holds a route, directive or service/);
  assert.match(placed[3].reason, /no owner, candidate or location/);
  assert.match(placed[4].reason, /stayed outside the selection/);

  // A class id covers its own members in both directions, and a longer name is not a prefix match.
  assert.equal(placeGap({ code: 'c', message: 'm', owner: SEARCH }, { owners: [`${SEARCH}.load`], targets: [], files: [] }).relation, 'related');
  assert.equal(placeGap({ code: 'c', message: 'm', owner: 'src/app/search.component.ts#SearchComponentOld' }, scope).relation, 'unrelated');
  // The selected target counts as well, and node ids are accepted where a symbol id is expected.
  assert.equal(placeGap({ code: 'c', message: 'm', owner: `def:${ROOT}` }, scope).relation, 'related');
  assert.equal(placeGap({ code: 'c', message: 'm', owner: 'src\\app\\search.component.ts#SearchComponent' }, scope).relation, 'related');
  assert.equal(strongestRelation(['unrelated', 'related', 'global-unknown']), 'related');
  assert.equal(strongestRelation([]), 'unrelated');
});

test('a gap whose candidate omission cannot be ruled out is promoted to a related one', () => {
  const wide = { ...scope, incomplete: [{ reason: 'External metadata expansion limit' }] };
  const promoted = placeGaps(rawGaps, wide);
  assert.deepEqual(promoted.map((gap) => gap.relation),
    ['related', 'related', 'related', 'related', 'related', 'related']);
  assert.match(promoted[3].reason, /a missed candidate cannot be ruled out: External metadata expansion limit/);

  // An incompleteness that names a file or an owner promotes only the gaps it can actually cover.
  const narrow = { ...scope, incomplete: [{ reason: 'imports of A are unresolved', file: 'src/other/a.ts' }] };
  assert.deepEqual(placeGaps(rawGaps, narrow).map((gap) => gap.relation),
    ['related', 'related', 'related', 'global-unknown', 'related', 'unrelated']);
  const byOwner = { ...scope, incomplete: [{ reason: 'the B catalog stopped', owner: 'src/other/b.ts#B' }] };
  assert.deepEqual(placeGaps(rawGaps, byOwner).map((gap) => gap.relation),
    ['related', 'related', 'related', 'global-unknown', 'unrelated', 'related']);
});

function buildReport(options = {}) {
  const evidence = new EvidenceTable({ workspaceRoot: '/ws', read: (file) => files.get(file) });
  const conditions = new ConditionTable();
  const context = {
    id: hex('a'), workspaceRoot: '/ws', projectName: 'app', projectType: 'application',
    tsconfig: 'tsconfig.app.json', configHash: hex('b'),
    toolchain: { typescript: '6.0.3', angularCompiler: '22.1.5', ngmaze: '0.1.0' },
    entry: ['src/main.ts'], entryUnknown: false, excluded: [], unapplied: [],
  };
  const candidate = {
    id: `cand:${hex('d')}`, contextId: context.id, class: 'bootstrap', ownerId: ROOT,
    element: { file: 'src/app/root.component.html', start: 0, end: 51 },
    routePattern: null, events: [], partialReasons: [],
  };
  const query = {
    raw: 'data-id="targetInput"',
    target: { kind: 'attribute', name: 'data-id', value: 'targetInput' },
    filters: { project: null, tsconfig: null, through: null, route: null, candidate: null, event: null },
    candidates: [candidate], enumerationComplete: true,
  };
  const builder = new ReportBuilder({ toolVersion: '0.1.0', snapshotId: hex('c'),
    generatedAt: '2026-09-24T13:00:24.000+09:00', context, query, evidence, conditions });

  const useSpan = at('src/app/root.component.html', '<app-search data-id="targetInput"></app-search>');
  const evUse = evidence.add(useSpan);
  const evRoot = evidence.add(at('src/app/root.component.ts', 'export class RootComponent {}'));
  const evSearch = evidence.add(at('src/app/search.component.ts', 'export class SearchComponent {'));
  const root = builder.definition({ kind: 'component', symbolId: ROOT, evidenceIds: [evRoot] });
  const search = builder.definition({ kind: 'component', symbolId: SEARCH, evidenceIds: [evSearch] });
  const occSearch = builder.occurrence({ kind: 'component', evidenceIds: [evUse],
    key: { ownerId: ROOT, definitionId: search, span: evidence.map(useSpan), insertion: null, projection: null, route: null } });
  const templateUse = builder.edge({ kind: 'template-use', from: root, to: occSearch, evidenceIds: [evUse],
    confidence: 'confirmed', origin: 'ngmaze-verified',
    details: { owner: detail('RootComponent'), child: detail('SearchComponent'),
      occurrence: detail(occSearch), location: detail('src/app/root.component.html:1') } });
  builder.path({ occurrenceIds: [occSearch], edgeIds: [templateUse], declarationIds: [root, search],
    end: 'bootstrap', endReason: 'RootComponent is bootstrapped in src/main.ts' });

  const placements = builder.relateGaps(options.gaps ?? rawGaps, options.scope ?? scope);
  builder.select({ candidateId: candidate.id, contextId: context.id, ownerId: ROOT, targetNodeId: occSearch,
    element: { ...evidence.map(useSpan), evidenceId: evUse }, routeIds: [], bootstrapId: null, events: [] });
  return { report: builder.build(), builder, placements, ids: { root, search, occSearch } };
}

test('the report keeps every gap with its relation and counts the unrelated ones by code', async () => {
  const { report, placements } = buildReport();
  assert.deepEqual(validateReport(report), []);
  assert.deepEqual(await validateAgainstSchema(report), []);
  assert.equal(report.coverage.gaps.length, 6, 'the JSON model keeps all gaps, not only the local ones');
  assert.deepEqual(placements.map((item) => item.relation),
    ['related', 'related', 'related', 'global-unknown', 'unrelated', 'unrelated']);
  const byCode = (code) => report.coverage.gaps.filter((gap) => gap.code === code);
  assert.deepEqual(report.coverage.gaps.map((gap) => gap.relation).sort(),
    ['global-unknown', 'related', 'related', 'related', 'unrelated', 'unrelated']);
  // §8 an unrelated gap is not dropped: it stays in the model and is summed per code.
  assert.deepEqual(report.coverage.gapCounts, [{ code: 'dynamic-import', count: 2 }]);
  assert.equal(byCode('dynamic-import').length, 2);
  assert.equal(byCode('unknown-owner')[0].relation, 'global-unknown');
  assert.equal(byCode('ambiguous-selector')[0].candidates.length, 2, 'the candidates that placed the gap are kept');
  // §3.3, §8 an open local gap makes the answer partial; the unrelated ones do not.
  assert.equal(report.coverage.overall, 'partial');
  assert.equal(report.status, 'partial');
  assert(report.coverage.reasons.includes('unresolved-provider: No provider found for SEARCH_CLIENT'));
  assert(!report.coverage.reasons.some((reason) => reason.startsWith('dynamic-import')));
  assert.equal(report.paths[0].coverage, 'complete-within-scope', 'an unrelated gap never rewrites the path');

  // §8 the JSON output carries every gap with its relation, not only the ones the document lists.
  const json = JSON.parse(renderJson({ report, outputDir: '/ws/out', fileNameSource: 'x', heading: 'x' }).text);
  assert.deepEqual(json.coverage.gaps.map((gap) => [gap.code, gap.relation]),
    report.coverage.gaps.map((gap) => [gap.code, gap.relation]));
  assert.deepEqual(json.coverage.gapCounts, report.coverage.gapCounts);
});

test('a gap ng-wiring filled in keeps its record and leaves the active missing list', () => {
  const { ids } = buildReport();
  const filled = { code: 'unresolved-provider', message: 'No provider found for LEGACY_CLIENT', owner: SEARCH,
    resolvedBy: ids.search, resolvedReason: 'ng-wiring resolved the token through the component providers' };
  const { report } = buildReport({ gaps: [filled, rawGaps[4]] });
  assert.deepEqual(validateReport(report), []);
  const [gap] = report.coverage.gaps.filter((item) => item.code === 'unresolved-provider');
  assert.equal(gap.relation, 'related', 'the original record is not rewritten');
  assert.equal(gap.resolvedBy, ids.search);
  assert.equal(gap.resolvedReason, 'ng-wiring resolved the token through the component providers');
  assert.deepEqual(activeGaps(report.coverage.gaps), [], 'a filled gap is no longer an active missing range');
  assert(!report.coverage.reasons.some((reason) => reason.includes('LEGACY_CLIENT')));
  assert.equal(report.coverage.overall, 'complete-within-scope');
  assert.equal(report.status, 'complete-within-scope');
});

test('the same gap reported twice keeps the closest relation and the resolution', () => {
  const { builder } = buildReport({ gaps: [] });
  const body = { code: 'unresolved-provider', message: 'No provider found for SEARCH_CLIENT', owner: `${SEARCH}.load` };
  const first = builder.gap({ ...body, relation: 'unrelated' });
  const second = builder.relateGaps([{ ...body, candidates: ['src/other/x.ts#X'] }], scope)[0];
  assert.equal(second.id, first);
  const report = builder.build();
  const gap = report.coverage.gaps.find((item) => item.id === first);
  assert.equal(gap.relation, 'related');
  assert.deepEqual(gap.candidates, ['src/other/x.ts#X']);
  assert.deepEqual(report.coverage.gapCounts, []);
});

test('the document separates the local, the filled, the global and the out-of-scope gaps', () => {
  const { ids } = buildReport();
  const { report } = buildReport({ gaps: [...rawGaps,
    { code: 'unresolved-provider', message: 'No provider found for LEGACY_CLIENT', owner: SEARCH,
      resolvedBy: ids.search, resolvedReason: 'the token is provided in the component providers' }] });
  const { text, problems } = renderMarkdown({ report, outputDir: '/ws/out',
    fileNameSource: 'RootComponent.data-id=targetInput', heading: 'RootComponent.data-id="targetInput"' });
  assert.deepEqual(problems, []);
  const tail = text.slice(text.indexOf('### 未検出範囲'));
  const section = (heading) => tail.slice(tail.indexOf(heading), tail.indexOf('\n\n', tail.indexOf(heading)));

  const local = section('関連する未検出:');
  assert(local.includes('- unresolved-provider: No provider found for SEARCH\\_CLIENT（owner src/app/search.component.ts#SearchComponent.load）'), local);
  assert(local.includes('- ambiguous-selector: Two components match app-search'), local);
  assert(local.includes('- template-unparsed: A template expression was skipped'), local);
  assert(!local.includes('LEGACY\\_CLIENT'), 'a filled gap is not listed as an active missing range');

  const resolved = section('ng-wiring が補完した未検出');
  assert(resolved.includes('- unresolved-provider: No provider found for LEGACY\\_CLIENT'), resolved);
  assert(resolved.includes('補完: the token is provided in the component providers'), resolved);

  // §8 what could not be tied to the selection goes to the end, and the rest is counted per code.
  const global = section('解析全体の未検出範囲:');
  assert(global.includes('- unknown-owner: A template was skipped in an unidentified file'), global);
  const counts = section('対象外の未検出（コード別件数）:');
  assert(counts.includes('- dynamic-import: 2 件'), counts);
  assert(!counts.includes('src/other/a.ts'), 'out-of-scope gaps are summed, not listed one by one');
});

test('model validation rejects a gap filed in the wrong bucket or filled in without grounds', () => {
  const base = buildReport().report;
  const rejects = (mutate, pattern) => {
    const report = JSON.parse(JSON.stringify(base));
    mutate(report);
    const problems = validateReport(report);
    assert(problems.some((problem) => pattern.test(problem)), `expected ${pattern} in ${JSON.stringify(problems)}`);
  };
  rejects((report) => { report.coverage.gaps.find((gap) => gap.relation === 'global-unknown').owner = 'src/x.ts#X'; },
    /filed as global-unknown/);
  rejects((report) => { report.coverage.gaps.find((gap) => gap.relation === 'unrelated').owner = null; },
    /no owner but was filed as unrelated/);
  rejects((report) => { report.coverage.gapCounts = [{ code: 'dynamic-import', count: 1 }]; },
    /gapCounts does not count the unrelated gaps/);
  rejects((report) => { report.coverage.gaps[0].resolvedBy = 'def:src/missing.ts#Gone'; },
    /filled in by unknown id/);
  rejects((report) => {
    const gap = report.coverage.gaps.find((item) => item.relation === 'related');
    gap.resolvedBy = base.nodes[0].id;
    gap.resolvedReason = '  ';
  }, /filled in without recording why/);
  rejects((report) => { report.coverage.gaps[0].resolvedReason = 'explained but never resolved'; },
    /fill-in reason without resolvedBy/);
  rejects((report) => { report.coverage.reasons = report.coverage.reasons.filter((reason) => !reason.startsWith('unresolved-provider')); },
    /missing from coverage.reasons/);
});
