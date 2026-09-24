import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConditionTable, EvidenceTable, ModelError, ReportBuilder, SCHEMA_VERSION, assertValidReport, branchSummary,
  combineCoverage, conditionPhases, definitionId, edgeContracts, edgeKinds, isProvenFalse, localIsoString,
  nodeKinds, occurrenceId, pathEnds, schemaPath, validateAgainstSchema, validateReport, weakestConfidence,
} from '../dist/model/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hex = (char) => char.repeat(64);

const rootHtml = '<app-search data-id="searchInputField"></app-search>\n<p>tail</p>\n';
const templateBody = '<input data-id="searchInputField" (input)="onInput($event)">';
const searchTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-search', template: '${templateBody}' })\n` +
  `export class SearchComponent {\n  onInput(event: Event) { this.load(); }\n` +
  `  load() { return this.http.get<Result>(this.endpoint); }\n}\n`;
const rootTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-root', templateUrl: './root.component.html' })\n` +
  `export class RootComponent {}\n`;
const mainTs = 'bootstrapApplication(RootComponent);\n';
const files = new Map([
  ['src/app/root.component.html', rootHtml],
  ['src/app/root.component.ts', rootTs],
  ['src/app/search.component.ts', searchTs],
  ['src/main.ts', mainTs],
]);
const inlineKey = 'src/app/search.component.ts#template';

function newEvidence() {
  const table = new EvidenceTable({ workspaceRoot: '/ws', read: (file) => files.get(file) });
  table.registerInline(inlineKey, { file: 'src/app/search.component.ts',
    segments: [{ from: 0, to: templateBody.length, sourceStart: searchTs.indexOf(templateBody) }] });
  return table;
}

const at = (file, text, length = text.length) => ({ file, start: files.get(file).indexOf(text), end: files.get(file).indexOf(text) + length });
const inTemplate = (text) => ({ file: inlineKey, start: templateBody.indexOf(text), end: templateBody.indexOf(text) + text.length });

test('evidence keeps UTF-16 half-open spans and maps inline templates into the TS file', () => {
  const evidence = newEvidence();
  const tail = at('src/app/root.component.html', '<p>tail</p>');
  const id = evidence.add(tail);
  const record = evidence.get(id);
  assert.equal(record.file, 'src/app/root.component.html');
  assert.equal(record.startLine, 2);
  assert.equal(record.startColumn, 1);
  assert.equal(record.endLine, 2);
  assert.equal(record.endColumn, 12);
  assert.equal(record.precision, 'exact');
  assert.equal(rootHtml.slice(record.startOffset, record.endOffset), '<p>tail</p>');
  assert.equal(evidence.add(tail), id, 'identical evidence is stored once');
  assert.notEqual(evidence.add({ ...tail, precision: 'approximate' }), id);

  const mapped = evidence.map(inTemplate('(input)="onInput($event)"'));
  assert.equal(mapped.file, 'src/app/search.component.ts');
  assert.equal(searchTs.slice(mapped.start, mapped.end), '(input)="onInput($event)"');
  const inline = evidence.get(evidence.add(inTemplate('(input)="onInput($event)"')));
  assert.equal(inline.file, 'src/app/search.component.ts');
  assert.equal(inline.startLine, 2, 'an inline span is reported at its line inside the TS file');

  // §3.1 offsets that cannot be converted are refused instead of guessed at.
  assert.equal(evidence.map({ file: inlineKey, start: 0, end: templateBody.length + 5 }), null);
  assert.equal(evidence.tryAdd({ file: inlineKey, start: 0, end: templateBody.length + 5 }), null);
  assert.throws(() => evidence.add({ file: inlineKey, start: 0, end: templateBody.length + 5 }), ModelError);
  assert.equal(evidence.tryAdd({ file: 'src/missing.ts', start: 0, end: 3 }), null);
  assert.equal(evidence.tryAdd({ file: 'src/main.ts', start: 4, end: 4 }), null, 'a zero-length span is not evidence');
});

test('definition nodes and use sites stay separate and occurrence ids ignore instance counts', () => {
  const evidence = newEvidence();
  const builder = fixture(evidence).builder;
  const key = { ownerId: 'src/app/root.component.ts#RootComponent',
    definitionId: definitionId('src/app/search.component.ts#SearchComponent'),
    span: { file: 'src/app/root.component.html', start: 0, end: 51 },
    insertion: null, projection: null, route: null };
  const first = builder.occurrence({ kind: 'component', key, evidenceIds: [] });
  const again = builder.occurrence({ kind: 'component', key, evidenceIds: [] });
  const other = builder.occurrence({ kind: 'component', key: { ...key, span: { ...key.span, start: 1 } }, evidenceIds: [] });
  const projected = builder.occurrence({ kind: 'component', key: { ...key, projection: 'search-button' }, evidenceIds: [] });
  assert.equal(first, again, 'the same use site keeps one id however many instances run');
  assert.notEqual(first, other);
  assert.notEqual(first, projected, 'the projection context is part of the identity');
  assert.equal(first, occurrenceId({ ...key, contextId: hex('a') }));
  assert.equal(definitionId('src\\app\\search.component.ts#SearchComponent'),
    'def:src/app/search.component.ts#SearchComponent');
  builder.definition({ kind: 'component', symbolId: 'src/app/search.component.ts#SearchComponent', evidenceIds: [] });
  assert.throws(() => builder.definition({ kind: 'directive',
    symbolId: 'src/app/search.component.ts#SearchComponent', evidenceIds: [] }), ModelError);
});

function fixture(evidence = newEvidence()) {
  const conditions = new ConditionTable();
  const context = {
    id: hex('a'), workspaceRoot: '/ws', projectName: 'app', projectType: 'application',
    tsconfig: 'tsconfig.app.json', configHash: hex('b'),
    toolchain: { typescript: '6.0.3', angularCompiler: '22.1.5', ngmaze: '0.1.0' },
    entry: ['src/main.ts'], entryUnknown: false, excluded: [], unapplied: [],
  };
  const candidate = {
    id: `cand:${hex('d')}`, contextId: context.id, class: 'bootstrap',
    ownerId: 'src/app/search.component.ts#SearchComponent',
    element: { file: 'src/app/search.component.ts', start: 0, end: 1 },
    routePattern: null, events: ['input'], partialReasons: [],
  };
  const query = {
    raw: 'data-id="searchInputField"',
    target: { kind: 'attribute', name: 'data-id', value: 'searchInputField' },
    filters: { project: null, tsconfig: null, through: null, route: null, candidate: null, event: null },
    // §5 another context appears in the candidate list only; its graph is never stored here.
    candidates: [candidate, { ...candidate, id: `cand:${hex('e')}`, contextId: hex('f') }],
    enumerationComplete: true,
  };
  const builder = new ReportBuilder({ toolVersion: '0.1.0', snapshotId: hex('c'),
    generatedAt: '2026-09-24T13:00:24.000+09:00', context, query, evidence, conditions });
  return { builder, evidence, conditions, context, candidate };
}

function buildReport() {
  const { builder, evidence, conditions, candidate } = fixture();
  const ev = (span, options) => evidence.add({ ...span, ...options });
  const useSpan = at('src/app/root.component.html', '<app-search data-id="searchInputField"></app-search>');
  const evUse = ev(useSpan);
  const evRootClass = ev(at('src/app/root.component.ts', 'export class RootComponent {}'));
  const evSearchClass = ev(at('src/app/search.component.ts', 'export class SearchComponent {'));
  const evBootstrap = ev(at('src/main.ts', 'bootstrapApplication(RootComponent);'));
  const evInput = ev(inTemplate(templateBody));
  const evBinding = ev(inTemplate('(input)="onInput($event)"'));
  const evHandler = ev(inTemplate('onInput($event)'));
  const evOnInput = ev(at('src/app/search.component.ts', 'onInput(event: Event) { this.load(); }'));
  const evLoad = ev(at('src/app/search.component.ts', 'load() { return this.http.get<Result>(this.endpoint); }'));
  const evRequest = ev(at('src/app/search.component.ts', 'this.http.get<Result>(this.endpoint)'));

  const application = builder.definition({ kind: 'application', symbolId: 'src/main.ts#Application', evidenceIds: [evBootstrap] });
  const root = builder.definition({ kind: 'component', symbolId: 'src/app/root.component.ts#RootComponent', evidenceIds: [evRootClass] });
  const search = builder.definition({ kind: 'component', symbolId: 'src/app/search.component.ts#SearchComponent', evidenceIds: [evSearchClass] });
  const onInput = builder.definition({ kind: 'symbol', symbolId: 'src/app/search.component.ts#SearchComponent.onInput', evidenceIds: [evOnInput] });
  const load = builder.definition({ kind: 'symbol', symbolId: 'src/app/search.component.ts#SearchComponent.load', evidenceIds: [evLoad] });
  const owner = 'src/app/search.component.ts#SearchComponent';
  const occSearch = builder.occurrence({ kind: 'component', evidenceIds: [evUse],
    key: { ownerId: 'src/app/root.component.ts#RootComponent', definitionId: search,
      span: evidence.map(useSpan), insertion: null, projection: null, route: null } });
  const occInput = builder.occurrence({ kind: 'element', evidenceIds: [evInput],
    key: { ownerId: owner, definitionId: null, span: evidence.map(inTemplate(templateBody)),
      insertion: null, projection: null, route: null } });
  const occEvent = builder.occurrence({ kind: 'event', evidenceIds: [evBinding],
    key: { ownerId: owner, definitionId: null, span: evidence.map(inTemplate('(input)="onInput($event)"')),
      insertion: null, projection: null, route: null } });
  const occListener = builder.occurrence({ kind: 'listener', evidenceIds: [evHandler],
    key: { ownerId: owner, definitionId: onInput, span: evidence.map(inTemplate('onInput($event)')),
      insertion: null, projection: null, route: null } });
  const occHttp = builder.occurrence({ kind: 'http', evidenceIds: [evRequest],
    key: { ownerId: owner, definitionId: null, span: evidence.map(at('src/app/search.component.ts', 'this.http.get<Result>(this.endpoint)')),
      insertion: null, projection: null, route: null } });
  const unknown = builder.boundary({ reason: 'The injected client is chosen at runtime',
    lastConfirmed: 'src/app/search.component.ts#SearchComponent.load', evidenceIds: [evLoad] });

  const detail = (value) => ({ value, unresolvedReason: null });
  const unresolved = (reason) => ({ value: null, unresolvedReason: reason });
  const templateUse = builder.edge({ kind: 'template-use', from: root, to: occSearch, evidenceIds: [evUse],
    confidence: 'confirmed', origin: 'ngmaze-verified',
    details: { owner: detail('RootComponent'), child: detail('SearchComponent'),
      occurrence: detail(occSearch), location: detail('src/app/root.component.html:1') } });
  const displayParent = builder.edge({ kind: 'display-parent', from: root, to: occSearch, evidenceIds: [evUse],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { parent: detail('RootComponent'), child: detail('SearchComponent') } });
  const bootstrap = builder.edge({ kind: 'bootstrap', from: application, to: root, evidenceIds: [evBootstrap],
    confidence: 'confirmed', origin: 'ngmaze',
    details: { application: detail('src/main.ts'), component: detail('RootComponent') } });
  const listener = builder.edge({ kind: 'dom-listener', from: occInput, to: occListener, evidenceIds: [evBinding],
    confidence: 'conditional', origin: 'ng-wiring',
    conditionId: conditions.all([conditions.phase({ phase: 'lifecycle', detail: 'after the view is created' }),
      conditions.predicate({ expression: 'value.length >= minimumChars', scope: 'SearchComponent', evidenceId: evHandler })]),
    details: { event: detail('input'), selected: detail('input[data-id="searchInputField"]'),
      listener: detail('SearchComponent'), handler: detail('onInput') } });
  const call = builder.edge({ kind: 'call', from: occListener, to: load, evidenceIds: [evHandler],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { caller: detail('SearchComponent.onInput'), callee: detail('SearchComponent.load'), arguments: detail('') } });
  // §5 the connection is known, so only the unknown URL field is marked; the edge keeps its kind.
  const httpCreate = builder.edge({ kind: 'http-create', from: load, to: occHttp, evidenceIds: [evRequest],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { method: detail('GET'), urlExpression: unresolved('this.endpoint is assigned outside the analyzed scope'),
      requestType: detail('void'), responseType: detail('Result') } });
  const httpConsume = builder.edge({ kind: 'http-consume', from: occHttp, to: onInput, evidenceIds: [evRequest],
    confidence: 'conditional', origin: 'ng-wiring',
    details: { request: detail('GET this.endpoint'), consumer: detail('SearchComponent.onInput') } });
  const boundary = builder.edge({ kind: 'boundary', from: load, to: unknown, evidenceIds: [evLoad],
    confidence: 'unresolved', origin: 'ng-wiring',
    details: { reason: detail('The injected client is chosen at runtime'),
      lastConfirmed: detail('SearchComponent.load') } });
  const excluded = builder.edge({ kind: 'projection', from: root, to: occSearch, evidenceIds: [evUse],
    confidence: 'conditional', origin: 'ng-wiring',
    conditionId: conditions.never('The slot selector never matches app-search'),
    details: { child: detail('SearchComponent'), host: detail('RootComponent'), slot: detail('search-button') } });
  builder.diagnostic({ code: 'excluded-branch', severity: 'info', relatedIds: [excluded],
    message: 'The search-button slot cannot match app-search, so the branch was dropped', evidenceIds: [evUse] });
  builder.diagnostic({ code: 'config-unapplied', severity: 'warning', message: 'budgets was not applied' });

  const displayPath = builder.path({ occurrenceIds: [occInput, occSearch], edgeIds: [templateUse, displayParent, bootstrap],
    declarationIds: [root, search], end: 'bootstrap', endReason: 'RootComponent is bootstrapped in src/main.ts' });
  const operation = builder.operation({ event: 'input', eventId: occEvent, listenerId: occListener,
    nodeIds: [occListener, load, occHttp, unknown], edgeIds: [listener, call, httpCreate, httpConsume, boundary],
    coverageReasons: ['The runtime client behind SearchComponent.load was not resolved'] });
  builder.gap({ code: 'unresolved-provider', message: 'No provider found for SEARCH_CLIENT', relation: 'related' });
  builder.gap({ code: 'unresolved-provider', message: 'No provider found for LEGACY_CLIENT', relation: 'related',
    resolvedBy: load, resolvedReason: 'ng-wiring resolved the token through the component providers' });
  builder.gap({ code: 'dynamic-import', message: 'Unanalyzed import in src/other/a.ts', relation: 'unrelated', owner: 'src/other/a.ts#A' });
  builder.gap({ code: 'dynamic-import', message: 'Unanalyzed import in src/other/b.ts', relation: 'unrelated', owner: 'src/other/b.ts#B' });
  builder.limits({ applied: [{ name: 'view-depth', limit: 200, stops: 0, unexplored: 0 }], truncations: [] });
  builder.select({ candidateId: candidate.id, contextId: hex('a'), ownerId: owner, targetNodeId: occInput,
    element: { ...evidence.map(inTemplate(templateBody)), evidenceId: evInput },
    routeIds: [], bootstrapId: application, events: ['input'] });
  return { report: builder.build(), builder, ids: { application, root, search, load, onInput, occInput, occSearch,
    occEvent, occListener, occHttp, unknown, templateUse, listener, boundary, excluded, displayPath, operation } };
}

test('one normalized report carries the model for both renderers', async () => {
  const { report } = buildReport();
  assert.deepEqual(validateReport(report), []);
  assert.deepEqual(await validateAgainstSchema(report), []);
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.toolVersion, '0.1.0');
  assert.deepEqual(Object.keys(report), ['schemaVersion', 'toolVersion', 'status', 'generatedAt', 'snapshotId',
    'context', 'query', 'selection', 'nodes', 'edges', 'evidence', 'conditions', 'paths', 'operations',
    'diagnostics', 'coverage', 'limits']);
  const round = JSON.parse(JSON.stringify(report));
  assert.deepEqual(round, report, 'the model is plain data, so both renderers read the same values');
  assert.deepEqual(validateReport(round), []);
  assert.deepEqual([...report.nodes].sort((a, b) => a.id < b.id ? -1 : 1).map(n => n.id), report.nodes.map(n => n.id));
  assert.deepEqual([...report.edges].sort((a, b) => a.id < b.id ? -1 : 1).map(e => e.id), report.edges.map(e => e.id));
  assert.equal(report.nodes.filter(node => node.role === 'definition').length, 5);
  assert.equal(report.nodes.filter(node => node.role === 'occurrence').length, 5);
  assert.equal(report.nodes.filter(node => node.role === 'boundary').length, 1);
  // §5 only the selected context is stored; the other one stays a candidate row.
  assert.equal(report.query.candidates.length, 2);
  assert(report.nodes.every(node => node.contextId === report.context.id));
  assert(report.edges.every(edge => edge.contextId === report.context.id));
});

test('confidence, coverage and status are aggregated per scope and stay independent', () => {
  const { report, ids } = buildReport();
  assert.equal(weakestConfidence(['confirmed', 'conditional']), 'conditional');
  assert.equal(weakestConfidence(['conditional', 'unresolved', 'confirmed']), 'unresolved');
  assert.equal(weakestConfidence([]), 'confirmed');
  assert.equal(combineCoverage(['complete-within-scope', 'partial']), 'partial');

  const [display] = report.paths;
  assert.equal(display.id, ids.displayPath);
  assert.equal(display.confidence, 'confirmed');
  assert.equal(display.coverage, 'complete-within-scope');
  const [operation] = report.operations;
  assert.equal(operation.confidence, 'unresolved', 'the weakest edge decides the operation');
  assert.equal(operation.coverage, 'partial');
  // §5 the unresolved branch of an event must not rewrite the display path it hangs from.
  assert.equal(report.coverage.paths, 'complete-within-scope');
  assert.deepEqual(report.coverage.events, [{ event: 'input', operationId: ids.operation, coverage: 'partial' }]);
  assert.equal(report.coverage.overall, 'partial');
  assert.equal(report.status, 'partial');
  assert(report.coverage.reasons.includes('The runtime client behind SearchComponent.load was not resolved'));
  assert(report.coverage.reasons.includes('unresolved-provider: No provider found for SEARCH_CLIENT'));
  assert(!report.coverage.reasons.some(reason => reason.includes('LEGACY_CLIENT')), 'a resolved gap leaves the open list');
  // §8 unrelated gaps are kept and counted per code, never merged into the selection.
  assert.deepEqual(report.coverage.gapCounts, [{ code: 'dynamic-import', count: 2 }]);
  assert.equal(report.coverage.gaps.length, 4);

  const summary = branchSummary([{ id: 'a', confidence: 'confirmed' }, { id: 'b', confidence: 'conditional' }]);
  assert.equal(summary.confidence, 'conditional');
  assert.deepEqual(summary.branches.map(branch => branch.confidence), ['confirmed', 'conditional']);
});

test('an unresolved field keeps its edge kind while an unresolvable target ends at a boundary', () => {
  const { report, ids } = buildReport();
  const http = report.edges.find(edge => edge.kind === 'http-create');
  assert.equal(http.confidence, 'confirmed');
  assert.equal(http.details.method.value, 'GET');
  assert.equal(http.details.urlExpression.value, null);
  assert.equal(http.details.urlExpression.unresolvedReason, 'this.endpoint is assigned outside the analyzed scope');
  const boundary = report.edges.find(edge => edge.id === ids.boundary);
  assert.equal(boundary.kind, 'boundary');
  assert.equal(boundary.confidence, 'unresolved');
  assert.equal(report.nodes.find(node => node.id === boundary.to).kind, 'boundary');
});

test('a proven-false branch leaves the paths and is explained by a diagnostic', () => {
  const { report, ids } = buildReport();
  const conditions = new Map(report.conditions.map(condition => [condition.id, condition]));
  const excluded = report.edges.find(edge => edge.id === ids.excluded);
  assert(isProvenFalse(conditions, excluded.conditionId));
  assert.equal(conditions.get(excluded.conditionId).reason, 'The slot selector never matches app-search');
  assert(report.paths.every(item => !item.edgeIds.includes(excluded.id)));
  assert(report.diagnostics.some(item => item.code === 'excluded-branch' && item.relatedIds.includes(excluded.id)));
  // §5 a condition that cannot be evaluated stays a predicate.
  const listener = report.edges.find(edge => edge.id === ids.listener);
  const tree = conditions.get(listener.conditionId);
  assert.equal(tree.kind, 'all');
  assert.deepEqual(tree.operandIds.map(id => conditions.get(id).kind), ['phase', 'predicate']);
  assert(!isProvenFalse(conditions, listener.conditionId));
  const table = new ConditionTable();
  assert.throws(() => table.never('  '), /proven unreachable/);
  assert.equal(table.all([]), table.always());
  assert.equal(table.all([table.always()]), table.always());
  // §5 a diagnostic without a source position may carry no evidence.
  assert.deepEqual(report.diagnostics.find(item => item.code === 'config-unapplied').evidenceIds, []);
});

test('model validation rejects broken references, context mixing and kind mismatches', () => {
  const base = buildReport().report;
  const copy = () => JSON.parse(JSON.stringify(base));
  const rejects = (mutate, pattern) => {
    const report = copy();
    mutate(report);
    const problems = validateReport(report);
    assert(problems.some(problem => pattern.test(problem)), `expected ${pattern} in ${JSON.stringify(problems)}`);
  };
  rejects(report => { report.edges[0].to = 'occ:missing'; }, /unknown node/);
  rejects(report => { report.edges[0].evidenceIds = []; }, /has no evidence/);
  rejects(report => { report.edges[0].evidenceIds = [`ev:${hex('9')}`]; }, /unknown evidence/);
  rejects(report => { report.nodes[0].contextId = hex('f'); }, /another analysis context/);
  rejects(report => {
    const edge = report.edges.find(item => item.kind === 'bootstrap');
    edge.to = report.nodes.find(node => node.kind === 'element').id;
  }, /cannot end at a element node/);
  rejects(report => { delete report.edges.find(item => item.kind === 'dom-listener').details.handler; }, /missing the handler detail/);
  rejects(report => {
    report.edges[0].details.owner = { value: null, unresolvedReason: null };
  }, /null without a reason/);
  rejects(report => {
    const edge = report.edges.find(item => item.kind === 'call');
    edge.confidence = 'unresolved';
  }, /unresolved but does not end at a boundary/);
  rejects(report => { report.nodes.find(node => node.role === 'occurrence').occurrence.insertion = 'ng-container'; },
    /does not match its identity key/);
  rejects(report => { report.paths[0].coverage = 'partial'; }, /coverage does not match its reasons/);
  rejects(report => { report.paths[0].confidence = 'confirmed'; report.paths[0].edgeIds.push(base.edges.find(e => e.kind === 'boundary').id); },
    /weakest edge confidence/);
  rejects(report => { report.diagnostics = report.diagnostics.filter(item => item.code !== 'excluded-branch'); },
    /excluded as a false branch without a diagnostic/);
  rejects(report => { report.paths[0].edgeIds.push(base.edges.find(e => e.kind === 'projection').id); },
    /keeps the excluded branch/);
  rejects(report => { report.selection.candidateId = `cand:${hex('e')}`; }, /belongs to another analysis context/);
  rejects(report => { report.evidence[0].endOffset = report.evidence[0].startOffset; }, /non-empty half-open range/);
  rejects(report => { report.evidence[0].startLine = 0; }, /1-based range/);
  rejects(report => {
    const element = report.nodes.find(node => node.kind === 'element');
    for (const id of element.evidenceIds) report.evidence.find(item => item.id === id).precision = 'approximate';
  }, /no exact evidence for its tag position/);
  rejects(report => { report.status = 'complete-within-scope'; }, /status does not match/);
  rejects(report => { report.generatedAt = '2026-09-24T13:00:24'; }, /UTC offset/);
  rejects(report => { report.schemaVersion = '0.9.0'; }, /schemaVersion must be/);
  assert.throws(() => assertValidReport({ ...base, schemaVersion: '0.9.0' }), ModelError);
});

test('the report cannot be built before a candidate is selected', () => {
  const { builder } = fixture();
  assert.throws(() => builder.build(), /selected candidate/);
  assert.throws(() => builder.edge({ kind: 'bootstrap', from: 'def:a', to: 'def:b', evidenceIds: [],
    confidence: 'confirmed', origin: 'ng-wiring', details: {} }), /has no evidence/);
});

test('the shipped schema states the same contract as the model', async () => {
  const schema = JSON.parse(await readFile(schemaPath(), 'utf8'));
  assert.equal(schemaPath(), path.join(repo, 'docs/ng-wiring.schema.json'));
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.deepEqual(schema.required, ['schemaVersion', 'toolVersion', 'status', 'generatedAt', 'snapshotId',
    'context', 'query', 'selection', 'nodes', 'edges', 'evidence', 'conditions', 'paths', 'operations',
    'diagnostics', 'coverage', 'limits']);
  assert.deepEqual(schema.definitions.node.properties.kind.enum, [...nodeKinds]);
  assert.deepEqual(schema.definitions.edge.properties.kind.enum, [...edgeKinds]);
  assert.deepEqual(schema.definitions.path.properties.end.enum, [...pathEnds]);
  assert.equal(edgeKinds.length, 29);
  assert.equal(nodeKinds.length, 19);
  const phases = schema.definitions.condition.oneOf.find(item => item.properties.kind.const === 'phase');
  assert.deepEqual(phases.properties.phase.enum, [...conditionPhases]);
  for (const kind of edgeKinds) {
    const rule = schema.definitions.edge.allOf.find(item => item.if.properties.kind.const === kind);
    assert(rule, `schema has no details rule for ${kind}`);
    assert.deepEqual(rule.then.properties.details.required, [...edgeContracts[kind].details], kind);
  }

  const { report } = buildReport();
  const broken = async (mutate) => {
    const copy = JSON.parse(JSON.stringify(report));
    mutate(copy);
    const errors = await validateAgainstSchema(copy);
    assert(errors.length > 0, 'the schema accepted an invalid report');
    return errors;
  };
  await broken(copy => { delete copy.edges.find(edge => edge.kind === 'http-create').details.responseType; });
  await broken(copy => { copy.edges[0].kind = 'made-up'; });
  await broken(copy => { copy.nodes[0].kind = 'made-up'; });
  await broken(copy => { copy.edges[0].evidenceIds = []; });
  await broken(copy => { copy.edges[0].details.owner = { value: 'RootComponent', unresolvedReason: 'both' }; });
  await broken(copy => { copy.schemaVersion = '2.0.0'; });
  await broken(copy => { copy.conditions.push({ id: `cond:${hex('1')}`, kind: 'false' }); });
  await broken(copy => { delete copy.evidence[0].contentHash; });
});

test('the local analysis time is written with its UTC offset', () => {
  const stamp = localIsoString(new Date(2026, 8, 24, 13, 0, 24, 5));
  assert.match(stamp, /^2026-09-24T13:00:24\.005(Z|[+-]\d{2}:\d{2})$/);
  assert.equal(new Date(stamp).getTime(), new Date(2026, 8, 24, 13, 0, 24, 5).getTime());
});
