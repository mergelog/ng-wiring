import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { makeCandidate } from '../dist/cli/candidates.js';
import { runCli } from '../dist/cli/run.js';
import {
  ConditionTable, EvidenceTable, ReportBuilder, detail, edgeContracts, edgeKinds, nodeKinds, unresolvedDetail,
} from '../dist/model/index.js';
import {
  OutputLockError, RenderError, buildFileName, displayGroupOf, displayGroups, displayGroupProblems, encodeLinkPath, encodeName,
  escapeInline, fileNamePattern, nameKept, nameLimit, outputLockName, pathHash, processName, produceReport,
  relativeLinkTarget, renderCondition, renderJson, renderMarkdown, renderReport, renderSentence,
  sentenceSlotProblems, sentenceSlots, sentenceTemplates, shortenName, timestamp, writeOutput,
} from '../dist/render/index.js';

const hex = (char) => char.repeat(64);
const workspaceRoot = '/ws';
const startedAt = new Date(2026, 8, 24, 13, 0, 24);

const rootHtml = '<app-search data-id="searchInputField"></app-search>\n<p>tail</p>\n';
const templateBody = '<input data-id="searchInputField" (input)="onValueChange($event)">';
const searchTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-search', template: '${templateBody}' })\n` +
  `export class SearchComponent {\n  onValueChange(event: Event) { this.load(); }\n` +
  `  load() { return this.http.get<Result>(this.endpoint); }\n}\n`;
const widgetTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'lib-search', template: '<app-search></app-search>' })\n` +
  `export class SearchComponent {}\n`;
const rootTs = `import { Component } from '@angular/core';\n` +
  `@Component({ selector: 'app-root', templateUrl: './root.component.html' })\n` +
  `export class RootComponent {}\n`;
const mainTs = 'bootstrapApplication(RootComponent);\n';
const oddTs = 'export const SEARCH_CLIENT = new InjectionToken<Client>("client");\n';
const oddFile = 'src/app/odd name#1.ts';
const files = new Map([
  ['src/app/root.component.html', rootHtml],
  ['src/app/root.component.ts', rootTs],
  ['src/app/search.component.ts', searchTs],
  ['src/app/widgets/search.component.ts', widgetTs],
  ['src/main.ts', mainTs],
  [oddFile, oddTs],
]);
const inlineKey = 'src/app/search.component.ts#template';
const at = (file, text) => ({ file, start: files.get(file).indexOf(text), end: files.get(file).indexOf(text) + text.length });
const inTemplate = (text) => ({ file: inlineKey, start: templateBody.indexOf(text), end: templateBody.indexOf(text) + text.length });

const owner = 'src/app/search.component.ts#SearchComponent';
const query = {
  raw: 'data-id="searchInputField"',
  target: { kind: 'attribute', name: 'data-id', value: 'searchInputField' },
  filters: { project: 'app', tsconfig: null, through: null, route: null, candidate: null, event: 'input' },
  candidates: [],
  enumerationComplete: true,
};

/** One report that exercises every block of §8: paths, a cycle, events, background, an excluded branch. */
function buildReport() {
  const evidence = new EvidenceTable({ workspaceRoot, read: (file) => files.get(file) });
  evidence.registerInline(inlineKey, { file: 'src/app/search.component.ts',
    segments: [{ from: 0, to: templateBody.length, sourceStart: searchTs.indexOf(templateBody) }] });
  const conditions = new ConditionTable();
  const context = {
    id: hex('a'), workspaceRoot, projectName: 'app', projectType: 'application',
    tsconfig: 'tsconfig.app.json', configHash: hex('b'),
    toolchain: { typescript: '6.0.3', angularCompiler: '22.1.5', ngmaze: '0.1.0' },
    entry: ['src/main.ts'], entryUnknown: false, excluded: [], unapplied: ['budgets'],
  };
  const candidate = {
    id: `cand:${hex('d')}`, contextId: context.id, class: 'bootstrap', ownerId: owner,
    element: { file: 'src/app/search.component.ts', start: 0, end: 1 },
    routePattern: null, events: ['input'], partialReasons: [],
  };
  const builder = new ReportBuilder({ toolVersion: '0.1.0', snapshotId: hex('c'),
    generatedAt: '2026-09-24T13:00:24.000+09:00', context,
    query: { ...query, candidates: [candidate] }, evidence, conditions });

  const ev = (span, options) => evidence.add({ ...span, ...options });
  const useSpan = at('src/app/root.component.html', '<app-search data-id="searchInputField"></app-search>');
  const evUse = ev(useSpan);
  const evRootClass = ev(at('src/app/root.component.ts', 'export class RootComponent {}'));
  const evSearchClass = ev(at('src/app/search.component.ts', 'export class SearchComponent {'));
  const evWidgetClass = ev(at('src/app/widgets/search.component.ts', 'export class SearchComponent {}'));
  const evWidgetUse = ev(at('src/app/widgets/search.component.ts', '<app-search></app-search>'));
  const evBootstrap = ev(at('src/main.ts', 'bootstrapApplication(RootComponent);'));
  const evInput = ev(inTemplate(templateBody));
  const evBinding = ev(inTemplate('(input)="onValueChange($event)"'));
  const evHandler = ev(inTemplate('onValueChange($event)'));
  const evOnValueChange = ev(at('src/app/search.component.ts', 'onValueChange(event: Event) { this.load(); }'));
  const evLoad = ev(at('src/app/search.component.ts', 'load() { return this.http.get<Result>(this.endpoint); }'));
  const evRequest = ev(at('src/app/search.component.ts', 'this.http.get<Result>(this.endpoint)'));
  const evToken = ev(at(oddFile, 'SEARCH_CLIENT'));

  const application = builder.definition({ kind: 'application', symbolId: 'src/main.ts#Application', evidenceIds: [evBootstrap] });
  const root = builder.definition({ kind: 'component', symbolId: 'src/app/root.component.ts#RootComponent', evidenceIds: [evRootClass] });
  const search = builder.definition({ kind: 'component', symbolId: owner, evidenceIds: [evSearchClass] });
  const widget = builder.definition({ kind: 'component', symbolId: 'src/app/widgets/search.component.ts#SearchComponent', evidenceIds: [evWidgetClass] });
  const onValueChange = builder.definition({ kind: 'symbol', symbolId: `${owner}.onValueChange`, evidenceIds: [evOnValueChange] });
  const load = builder.definition({ kind: 'symbol', symbolId: `${owner}.load`, evidenceIds: [evLoad] });
  const token = builder.definition({ kind: 'service', symbolId: `${oddFile}#SEARCH_CLIENT`, evidenceIds: [evToken] });

  const occInput = builder.occurrence({ kind: 'element', evidenceIds: [evInput],
    details: { label: detail('input[data-id="searchInputField"]') },
    key: { ownerId: owner, definitionId: null, span: evidence.map(inTemplate(templateBody)),
      insertion: null, projection: 'search-button', route: null } });
  const occSearch = builder.occurrence({ kind: 'component', evidenceIds: [evUse],
    key: { ownerId: 'src/app/root.component.ts#RootComponent', definitionId: search,
      span: evidence.map(useSpan), insertion: null, projection: null, route: null } });
  const occWidget = builder.occurrence({ kind: 'component', evidenceIds: [evWidgetUse],
    key: { ownerId: 'src/app/widgets/search.component.ts#SearchComponent', definitionId: widget,
      span: evidence.map(at('src/app/widgets/search.component.ts', '<app-search></app-search>')),
      insertion: null, projection: null, route: null } });
  const occEvent = builder.occurrence({ kind: 'event', evidenceIds: [evBinding],
    key: { ownerId: owner, definitionId: null, span: evidence.map(inTemplate('(input)="onValueChange($event)"')),
      insertion: null, projection: null, route: null } });
  const occListener = builder.occurrence({ kind: 'listener', evidenceIds: [evHandler],
    key: { ownerId: owner, definitionId: onValueChange, span: evidence.map(inTemplate('onValueChange($event)')),
      insertion: null, projection: null, route: null } });
  const occHttp = builder.occurrence({ kind: 'http', evidenceIds: [evRequest],
    key: { ownerId: owner, definitionId: null,
      span: evidence.map(at('src/app/search.component.ts', 'this.http.get<Result>(this.endpoint)')),
      insertion: null, projection: null, route: null } });
  const unknown = builder.boundary({ reason: 'The injected client is chosen at runtime',
    lastConfirmed: `${owner}.load`, evidenceIds: [evLoad] });

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
  // §8 an unconfirmed display parent stays unresolved instead of borrowing a placeholder name.
  const widgetParent = builder.edge({ kind: 'display-parent', from: root, to: occWidget, evidenceIds: [evWidgetUse],
    confidence: 'conditional', origin: 'ng-wiring',
    conditionId: conditions.predicate({ expression: 'showWidget()', scope: 'RootComponent', evidenceId: evWidgetUse }),
    details: { parent: unresolvedDetail('The widget host is picked at runtime'), child: detail('SearchComponent') } });
  const listener = builder.edge({ kind: 'dom-listener', from: occInput, to: occListener, evidenceIds: [evBinding],
    confidence: 'conditional', origin: 'ng-wiring',
    conditionId: conditions.all([conditions.phase({ phase: 'lifecycle', detail: 'after the view is created' }),
      conditions.predicate({ expression: 'value.length >= minimumChars', scope: 'SearchComponent', evidenceId: evHandler })]),
    details: { event: detail('input'), selected: detail('input[data-id="searchInputField"]'),
      listener: detail('SearchComponent'), handler: detail('onValueChange') } });
  const call = builder.edge({ kind: 'call', from: occListener, to: load, evidenceIds: [evHandler],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { caller: detail('SearchComponent.onValueChange'), callee: detail('SearchComponent.load'),
      arguments: detail('[click me](javascript:alert(1)) <script>x</script>') } });
  const httpCreate = builder.edge({ kind: 'http-create', from: load, to: occHttp, evidenceIds: [evRequest],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { method: detail('GET'), urlExpression: unresolvedDetail('this.endpoint is assigned outside the analyzed scope'),
      requestType: detail('void'), responseType: detail('Result') } });
  const httpConsume = builder.edge({ kind: 'http-consume', from: occHttp, to: onValueChange, evidenceIds: [evRequest],
    confidence: 'conditional', origin: 'ng-wiring',
    details: { request: detail('GET this.endpoint'), consumer: detail('SearchComponent.onValueChange') } });
  const boundary = builder.edge({ kind: 'boundary', from: load, to: unknown, evidenceIds: [evLoad],
    confidence: 'unresolved', origin: 'ng-wiring',
    details: { reason: detail('The injected client is chosen at runtime'), lastConfirmed: detail('SearchComponent.load') } });
  const di = builder.edge({ kind: 'di-resolve', from: token, to: load, evidenceIds: [evToken],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { token: detail('SEARCH_CLIENT'), implementation: detail('HttpSearchClient'), provider: detail('providers in AppConfig') } });
  const dispatch = builder.edge({ kind: 'event-dispatch', from: onValueChange, to: occEvent, evidenceIds: [evHandler],
    confidence: 'confirmed', origin: 'ng-wiring',
    details: { caller: detail('SearchComponent.onValueChange'), event: detail('searchRequested'),
      busId: detail('SearchStore'), scope: detail('store'), dispatchMode: detail('named-dispatcher') } });
  const excluded = builder.edge({ kind: 'projection', from: root, to: occSearch, evidenceIds: [evUse],
    confidence: 'conditional', origin: 'ng-wiring',
    conditionId: conditions.never('The slot selector never matches app-search'),
    details: { child: detail('SearchComponent'), host: detail('RootComponent'), slot: detail('search-button') } });
  builder.diagnostic({ code: 'excluded-branch', severity: 'info', relatedIds: [excluded],
    message: 'The search-button slot cannot match app-search, so the branch was dropped', evidenceIds: [evUse] });
  builder.diagnostic({ code: 'config-unapplied', severity: 'warning', message: 'budgets was not applied' });

  const displayPath = builder.path({ occurrenceIds: [occInput, occSearch],
    edgeIds: [templateUse, displayParent, bootstrap], declarationIds: [root, search],
    end: 'bootstrap', endReason: 'RootComponent is bootstrapped in src/main.ts' });
  // §8 the cycle tail names what it referred back to and shows that the walk was cut off.
  const cyclePath = builder.path({ occurrenceIds: [occInput, occWidget, occInput], edgeIds: [widgetParent],
    declarationIds: [widget], end: 'cycle', endReason: 'The walk returned to input[data-id="searchInputField"]' });
  const operation = builder.operation({ event: 'input', eventId: occEvent, listenerId: occListener,
    nodeIds: [occListener, load, occHttp, unknown],
    edgeIds: [listener, call, httpCreate, httpConsume, boundary, dispatch],
    coverageReasons: ['The runtime client behind SearchComponent.load was not resolved'] });
  builder.gap({ code: 'unresolved-provider', message: 'No provider found for SEARCH_CLIENT', relation: 'related' });
  builder.gap({ code: 'unknown-owner', message: 'A template was skipped in an unidentified file', relation: 'global-unknown' });
  builder.gap({ code: 'dynamic-import', message: 'Unanalyzed import in src/other/a.ts', relation: 'unrelated', owner: 'src/other/a.ts#A' });
  builder.gap({ code: 'dynamic-import', message: 'Unanalyzed import in src/other/b.ts', relation: 'unrelated', owner: 'src/other/b.ts#B' });
  builder.limits({ applied: [{ name: 'view-depth', limit: 200, stops: 1, unexplored: 0 }],
    truncations: [{ limit: 'view-depth', reason: 'The widget cycle was cut at depth 200', nodeId: occWidget, edgeId: null, evidenceIds: [evWidgetUse] }] });
  builder.select({ candidateId: candidate.id, contextId: hex('a'), ownerId: owner, targetNodeId: occInput,
    element: { ...evidence.map(inTemplate(templateBody)), evidenceId: evInput },
    routeIds: [], bootstrapId: application, events: ['input'] });
  return { report: builder.build(), ids: { occInput, occSearch, occWidget, di, dispatch, excluded, displayPath, cyclePath, operation } };
}

const outputDir = '/ws/out';
const render = (report) => renderMarkdown({ report, outputDir,
  fileNameSource: 'SearchComponent.data-id=searchInputField', heading: 'SearchComponent.data-id="searchInputField"' });

test('the sentence table covers every kind and matches the model contract', () => {
  assert.deepEqual(sentenceSlotProblems(), []);
  assert.deepEqual(displayGroupProblems(), []);
  assert.equal(Object.keys(sentenceTemplates).length, edgeKinds.length);
  // §8 the display groups label the document only; `state` and `service` are also node kinds, so the
  // renderer keys sentences by edge kind alone and prints the group as a separate label.
  for (const group of displayGroups) {
    assert(!edgeKinds.includes(group), `${group} must not be an edge kind`);
    assert(!(group in sentenceTemplates), `${group} must not carry a sentence`);
    assert(Object.values(displayGroupOf).includes(group), `${group} labels no kind`);
  }
  assert(nodeKinds.includes('state') && nodeKinds.includes('service'), 'the overlap this guard is about still exists');
  for (const kind of edgeKinds) {
    const details = Object.fromEntries(edgeContracts[kind].details.map((key) => [key, detail(`<${key}>`)]));
    const sentence = renderSentence(kind, details);
    assert(!/\{[A-Za-z]/.test(sentence.text), `${kind} left a slot unfilled: ${sentence.text}`);
    assert.deepEqual(sentence.unresolved, []);
    for (const key of sentenceSlots(kind)) assert(sentence.text.includes(`&lt;${key}&gt;`), `${kind} dropped ${key}`);
    assert(sentenceSlots(kind).every((slot) => edgeContracts[kind].details.includes(slot)), kind);
  }
  // §8 P14-05 an unknown kind is a render error, never free prose.
  assert.throws(() => renderSentence('made-up', {}), RenderError);
  assert.throws(() => renderSentence('bootstrap', { application: detail('a') }), RenderError);
});

test('an unknown detail becomes an unresolved marker with its reason, and dispatchMode survives', () => {
  const sentence = renderSentence('http-create', {
    method: detail('GET'), urlExpression: unresolvedDetail('assigned outside the scope'),
    requestType: detail('void'), responseType: detail('Result'),
  });
  assert(sentence.text.includes('（未解決: urlExpression）'), sentence.text);
  assert(!sentence.text.includes('assigned outside the scope'), 'the reason belongs at the end of the sentence');
  assert.deepEqual(sentence.unresolved, ['urlExpression: assigned outside the scope']);
  const missingReason = renderSentence('http-consume', { request: { value: null, unresolvedReason: null }, consumer: detail('X') });
  assert.deepEqual(missingReason.unresolved, ['request: 理由の記録なし']);

  const { report } = buildReport();
  const markdown = render(report).text;
  assert(markdown.includes('（named-dispatcher）'), 'dispatchMode is shown in Markdown');
  const json = JSON.parse(renderJson({ report }).text);
  const dispatched = json.edges.find((edge) => edge.kind === 'event-dispatch');
  assert.equal(dispatched.details.dispatchMode.value, 'named-dispatcher');
});

test('conditions are shown from the recorded expression without new causality', () => {
  const conditions = new Map([
    ['cond:t', { id: 'cond:t', kind: 'true' }],
    ['cond:p', { id: 'cond:p', kind: 'predicate', expression: 'value.length >= min', scope: 'SearchComponent', evidenceId: 'ev:1' }],
    ['cond:f', { id: 'cond:f', kind: 'phase', phase: 'defer', detail: 'on viewport', evidenceId: null }],
    ['cond:a', { id: 'cond:a', kind: 'all', operandIds: ['cond:p', 'cond:f'] }],
    ['cond:o', { id: 'cond:o', kind: 'any', operandIds: ['cond:p', 'cond:t'] }],
    ['cond:n', { id: 'cond:n', kind: 'not', operandIds: ['cond:p'] }],
    ['cond:x', { id: 'cond:x', kind: 'false', reason: 'proved unreachable' }],
  ]);
  assert.equal(renderCondition(conditions, null), null);
  assert.equal(renderCondition(conditions, 'cond:t'), null);
  assert.equal(renderCondition(conditions, 'cond:p'), 'value.length &gt;= min（scope: SearchComponent）');
  assert.equal(renderCondition(conditions, 'cond:f'), 'phase defer（on viewport）');
  assert.equal(renderCondition(conditions, 'cond:a'), '（value.length &gt;= min（scope: SearchComponent） かつ phase defer（on viewport））');
  assert.equal(renderCondition(conditions, 'cond:o'), '（value.length &gt;= min（scope: SearchComponent） または true）');
  assert.equal(renderCondition(conditions, 'cond:n'), 'not（value.length &gt;= min（scope: SearchComponent））');
  assert.equal(renderCondition(conditions, 'cond:x'), 'false（proved unreachable）');
  assert(renderCondition(conditions, 'cond:missing').startsWith('未知の条件参照'));
});

test('the report head carries the target, settings, candidate, coverage and the partial status', () => {
  const { report } = buildReport();
  const { text, problems } = render(report);
  assert.deepEqual(problems, []);
  const head = text.slice(0, text.indexOf('## 1. 表示経路'));
  assert(head.startsWith('# ng-wiring 経路資料: SearchComponent.data-id="searchInputField"'));
  // §3.3 P14-22 a partial result says so at the top of the document and in the JSON status.
  assert(head.includes('- status: **partial**'), head);
  assert(head.includes('data-id="searchInputField"'));
  assert(head.includes(`- 所有者: ${owner.replace(/_/g, '\\_')}`) || head.includes('- 所有者: src/app/search.component.ts#SearchComponent'));
  assert(head.includes('- project: app（application） / tsconfig: tsconfig.app.json'));
  assert(head.includes('TypeScript 6.0.3'));
  assert(head.includes(`snapshot: \`${hex('c')}\``));
  assert(head.includes(`候補 ID: \`cand:${hex('d')}\`（分類 bootstrap）`));
  assert(head.includes('- 表示経路: 2 件（終端 bootstrap, cycle）'));
  assert(head.includes('- イベント: input'));
  assert(head.includes('- confidence: 表示経路 conditional / input unresolved'));
  assert(head.includes('- coverage: 全体 partial / 表示経路 partial / input partial'));
  assert(head.includes('- 未適用の設定: budgets'));
  assert(head.includes('- ファイル名元文字列: SearchComponent.data-id=searchInputField'));
  assert(head.includes('- 重要な未解決理由:'));
  assert(head.includes('The runtime client behind SearchComponent.load was not resolved'));
  assert(head.includes('bootstrap: Application'));
  assert.equal(JSON.parse(renderJson({ report }).text).status, 'partial');
});

test('sections run from the child to the root, numbered and told apart by their path', () => {
  const { report, ids } = buildReport();
  const text = render(report).text;
  const body = text.slice(text.indexOf('## 2. コンポーネント節'));
  assert(body.includes('### 01. input\\[data-id="searchInputField"\\]'), body.slice(0, 400));
  // §8 the same class name in two files is shown with its path; each use site keeps its own number.
  assert(body.includes('### 02. SearchComponent（src/app/search.component.ts）'), body.slice(0, 900));
  assert(body.includes('### 03. SearchComponent（src/app/widgets/search.component.ts）'), body.slice(0, 1200));
  assert(!body.includes('### 04.'), 'a root that has no use site is not given a numbered section');
  assert(!/### \d+\. RootComponent/.test(text), 'the bootstrapped root is referenced, not invented as a section');
  assert(body.includes('/ 投影先: search-button'));
  assert(body.includes('- 宣言元: SearchComponent（src/app/search.component.ts）'));

  const paths = text.slice(text.indexOf('## 1. 表示経路'), text.indexOf('## 2. コンポーネント節'));
  assert(paths.includes('- 節: 節 01 input\\[data-id="searchInputField"\\] → 節 02 SearchComponent（src/app/search.component.ts）'));
  assert(paths.includes('- 終端: bootstrap — RootComponent is bootstrapped in src/main.ts'));
  // §8 the cycle tail shows what it referred to and that the walk was cut off.
  assert(paths.includes('- 終端: cycle（参照先で循環したため打ち切り） — The walk returned to input'), paths);
  assert(paths.includes('→ 節 03 SearchComponent（src/app/widgets/search.component.ts） → 節 01 '), paths);
  assert(paths.includes('src/main.ts が RootComponent を起動する。'), 'an edge between definitions stays with its path');
  assert.equal(ids.displayPath.startsWith('path:'), true);
});

test('every sentence ends with evidence links and its conditions or unresolved reasons', () => {
  const { report } = buildReport();
  const text = render(report).text;
  const sentences = text.split('\n').filter((line) => /^- `[a-z-]+`（/.test(line));
  assert.equal(sentences.length, report.edges.length + 2, 'each edge is stated once, plus the two restated requests');
  for (const line of sentences) {
    assert(/根拠: (\[|.*相対リンク不可)/.test(line), `no evidence link: ${line}`);
    assert(/確定度: (confirmed|conditional|unresolved)。/.test(line), `no confidence: ${line}`);
    if (line.includes('（未解決: ')) assert(line.includes('未解決: '), line);
  }
  const listener = sentences.find((line) => line.startsWith('- `dom-listener`'));
  assert(listener.includes('条件: （phase lifecycle（after the view is created） かつ value.length &gt;= minimumChars（scope: SearchComponent））'), listener);
  const http = sentences.find((line) => line.startsWith('- `http-create`'));
  assert(http.includes('GET （未解決: urlExpression） の要求を作る'), http);
  assert(http.includes('未解決: urlExpression: this.endpoint is assigned outside the analyzed scope。'), http);
  // §8 an unconfirmed display parent is never given a placeholder name.
  const parent = sentences.filter((line) => line.startsWith('- `display-parent`'))
    .find((line) => line.includes('（未解決: parent）'));
  assert(parent.includes('SearchComponent の表示上の親は （未解決: parent）'), parent);
  assert(parent.includes('未解決: parent: The widget host is picked at runtime。'), parent);
});

test('source links are relative to the output file and percent encoded', () => {
  const { report } = buildReport();
  const text = render(report).text;
  assert(text.includes('[src/app/root.component.html:1](../src/app/root.component.html#L1)'), text.slice(0, 600));
  assert(text.includes('[src/app/odd name#1.ts:1](../src/app/odd%20name%231.ts#L1)'), 'space and # are encoded');
  assert.equal(encodeLinkPath('a %#b/c.ts'), 'a%20%25%23b/c.ts');
  assert.equal(encodeLinkPath('src/app/日本語.ts'), 'src/app/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts');
  assert.equal(relativeLinkTarget('/ws/out', '/ws/src/a.ts'), '../src/a.ts');
  assert.equal(relativeLinkTarget('/ws', '/ws/src/a.ts'), './src/a.ts');
  // §8 a link that cannot be made relative is written as absolute text with a diagnostic.
  assert.equal(relativeLinkTarget('C:\\out', 'D:\\ws\\a.ts', path.win32), null);
  const crossDrive = renderMarkdown({ report, outputDir: 'C:\\out', fileNameSource: 'x', heading: 'x', platform: path.win32 });
  assert(crossDrive.problems.some((problem) => problem.includes('No relative source link')), crossDrive.problems);
  assert(crossDrive.text.includes('相対リンク不可・絶対パス'), 'the absolute path is text, not a broken link');
  assert(!crossDrive.text.includes('](C:'), 'no link is invented');
});

test('source text is escaped so it cannot act as Markdown or HTML', () => {
  assert.equal(escapeInline('[x](y)'), '\\[x\\]\\(y\\)');
  assert.equal(escapeInline('<script>a && b</script>'), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt;');
  assert.equal(escapeInline('a\nb\r\nc'), 'a b c');
  assert.equal(escapeInline('`code` *bold* _it_ |cell| ~s~ !x'), '\\`code\\` \\*bold\\* \\_it\\_ \\|cell\\| \\~s\\~ \\!x');
  const { report } = buildReport();
  const text = render(report).text;
  assert(text.includes('\\[click me\\]\\(javascript:alert\\(1\\)\\)'), 'a link in a source excerpt stays text');
  assert(!text.includes('<script>'), 'raw HTML never reaches the document');
  assert(text.includes('&lt;script&gt;x&lt;/script&gt;'));
});

test('events, communication, background input, excluded branches and diagnostics each get a block', () => {
  const { report } = buildReport();
  const text = render(report).text;
  const events = text.slice(text.indexOf('## 3. イベント別の処理'), text.indexOf('## 4. 背景入力'));
  assert(events.includes('### input'), events.slice(0, 200));
  assert(events.includes('- confidence: unresolved / coverage: partial'));
  assert(events.includes('- coverage 理由: The runtime client behind SearchComponent.load was not resolved'));
  assert(events.includes('### 通信'));
  assert(events.includes('この起点から検出した要求（再掲）:'));

  const background = text.slice(text.indexOf('## 4. 背景入力'), text.indexOf('## 5. 除外した枝'));
  assert(background.includes('- `di-resolve`（サービス）SEARCH\\_CLIENT は providers in AppConfig により HttpSearchClient に解決される。'), background);

  const dropped = text.slice(text.indexOf('## 5. 除外した枝'), text.indexOf('## 6. 診断と制限'));
  assert(dropped.includes('- `projection`（関連）'));
  assert(dropped.includes('除外理由: excluded-branch: The search-button slot cannot match app-search'), dropped);

  const tail = text.slice(text.indexOf('## 6. 診断と制限'));
  assert(tail.includes('- [warning] config-unapplied: budgets was not applied 根拠: ソース位置なし'));
  assert(tail.includes('関連する未検出:'));
  assert(tail.includes('- unresolved-provider: No provider found for SEARCH\\_CLIENT'));
  assert(tail.includes('解析全体の未検出範囲:'));
  assert(tail.includes('- unknown-owner: A template was skipped in an unidentified file'));
  assert(tail.includes('対象外の未検出（コード別件数）:'));
  assert(tail.includes('- dynamic-import: 2 件'));
  assert(tail.includes('- view-depth: 上限 200 / 停止 1 / 未探索 0'));
  assert(tail.includes('- 打ち切り view-depth: The widget cycle was cut at depth 200'));
});

test('a report with no request says so with its coverage instead of denying the API', () => {
  const { report } = buildReport();
  const quiet = { ...report, edges: report.edges.filter((edge) => !edge.kind.startsWith('http')) };
  quiet.operations = report.operations.map((item) => ({ ...item,
    edgeIds: item.edgeIds.filter((id) => quiet.edges.some((edge) => edge.id === id)) }));
  const text = renderMarkdown({ report: quiet, outputDir, fileNameSource: 'x', heading: 'x' }).text;
  assert(text.includes('この探索範囲で通信への接続は未検出。'), text.slice(text.indexOf('### 通信'), text.indexOf('## 4.')));
  assert(text.includes('アプリに通信が無いことを示すものではない。'));
  assert(text.includes('停止理由: bootstrap: RootComponent is bootstrapped in src/main.ts'));
});

test('both renderers read the same model and cover the same edges', () => {
  const { report } = buildReport();
  const markdown = renderReport({ report, outputDir, fileNameSource: 'x', heading: 'x', json: false });
  const json = renderReport({ report, outputDir, fileNameSource: 'x', heading: 'x', json: true });
  assert.deepEqual(markdown.edgeIds, json.edgeIds);
  assert.deepEqual(markdown.edgeIds, [...report.edges.map((edge) => edge.id)].sort());
  assert.deepEqual(markdown.problems, []);
  const parsed = JSON.parse(json.text);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.generatedAt, report.generatedAt);
  assert(markdown.text.includes(report.generatedAt), 'the ISO time with its offset stays in the Markdown body');
});

const nameInput = { target: query.target, ownerClass: 'SearchComponent', ownerId: owner };
const temp = () => mkdtemp(path.join(tmpdir(), 'ng-wiring-p14-'));

test('the process name keeps the value the file name needs and the heading shows it quoted', () => {
  // §3.4-1 the outer syntactic quotes are already gone; quotes inside the value belong to the value.
  const plain = processName(nameInput);
  assert.equal(plain.raw, 'SearchComponent.data-id=searchInputField');
  assert.equal(plain.heading, 'SearchComponent.data-id="searchInputField"');
  const quoted = processName({ ...nameInput, target: { kind: 'attribute', name: 'data-id', value: 'a"b\'c' } });
  assert.equal(quoted.raw, 'SearchComponent.data-id=a"b\'c');
  assert.equal(quoted.heading, 'SearchComponent.data-id="a"b\'c"');

  // §3.4-1 a --source target is named by the owning class, the element, the line and the path hash.
  const source = processName({ ...nameInput, elementName: 'input',
    target: { kind: 'source', file: 'src/app/search.component.ts', line: 2 } });
  const expected = createHash('sha256').update(`${owner}\nsrc/app/search.component.ts`, 'utf8').digest('hex').slice(0, 12);
  assert.equal(expected.length, 12);
  assert.equal(source.raw, `SearchComponent.input-L2-${expected}`);
  assert.equal(pathHash(owner, 'src/app/search.component.ts'), expected);
  assert.equal(pathHash('src\\app\\search.component.ts#SearchComponent', 'src\\app\\search.component.ts'), expected);
  assert.throws(() => processName({ ...nameInput, target: { kind: 'source', file: 'a.ts', line: 2 } }), RenderError);
});

test('only the file name string is normalized and percent encoded', () => {
  const decomposed = `${String.fromCharCode(0x304B, 0x3099)}`;
  const composed = String.fromCharCode(0x304C);
  assert.notEqual(decomposed, composed);
  // §3.4-2 NFC applies to the file name string alone; the value used for matching is left untouched.
  assert.equal(encodeName(decomposed), '%E3%81%8C');
  assert.equal(encodeName(composed), '%E3%81%8C');
  assert.equal(processName({ ...nameInput, target: { kind: 'attribute', name: 'k', value: decomposed } }).raw,
    `SearchComponent.k=${decomposed}`, 'the raw string keeps the form it was read in');
  assert.equal(encodeName('Search.data-id=a_b-c.d'), 'Search.data-id=a_b-c.d');
  assert.equal(encodeName('a%b c/d"e'), 'a%25b%20c%2Fd%22e');
  assert(/^[\x20-\x7e]*$/.test(encodeName('日本語 "x"')), 'the encoded name is ASCII only');
});

test('an over-long name is shortened without splitting an escape and keeps the original in the body', () => {
  const short = 'a'.repeat(160);
  assert.equal(shortenName(encodeName(short), short), short, 'exactly the limit is left alone');
  const long = 'a'.repeat(161);
  const cut = shortenName(encodeName(long), long);
  const digest = createHash('sha256').update(long, 'utf8').digest('hex').slice(0, 12);
  assert.equal(cut, `${'a'.repeat(nameKept)}-h${digest}`);
  assert.equal(nameLimit, 160);
  assert.equal(nameKept, 140);

  // §3.4-3 a `%HH` escape is never cut in half.
  for (const prefix of [137, 138, 139]) {
    const raw = 'a'.repeat(prefix) + 'あ'.repeat(20);
    const kept = shortenName(encodeName(raw), raw).split('-h')[0];
    assert(kept.length <= nameKept, kept.length);
    assert(!/%[0-9A-F]?$/.test(kept), `a %HH escape was split: ${kept.slice(-6)}`);
    assert.equal(kept.length % 1, 0);
  }
  const { report } = buildReport();
  const long2 = `SearchComponent.data-id=${'値'.repeat(40)}`;
  const text = renderMarkdown({ report, outputDir, fileNameSource: long2, heading: 'x' }).text;
  assert(text.includes(`- ファイル名元文字列: ${long2}`), 'the original string stays in the document without loss');
});

test('the file name is built in the order §3.4 fixes and stays decomposable', () => {
  assert.equal(timestamp(startedAt), '260924.130024');
  assert.equal(timestamp(new Date(2100, 0, 2, 3, 4, 5)), '000102.030405');
  const name = buildFileName({ raw: 'SearchComponent.data-id=searchInputField', startedAt, json: false });
  assert.equal(name, 'ngwi-SearchComponent.data-id=searchInputField-260924.130024.md');
  const json = buildFileName({ raw: 'SearchComponent.data-id=searchInputField', startedAt, json: true });
  assert.equal(json, 'ngwi-SearchComponent.data-id=searchInputField-260924.130024.json');
  assert.equal(buildFileName({ raw: 'A.b=c', startedAt, json: false, collision: 2 }), 'ngwi-A.b=c-c2-260924.130024.md');
  const match = fileNamePattern.exec(name);
  assert.deepEqual([match[1], match[2], match[3]], ['SearchComponent.data-id=searchInputField', '260924.130024', 'md']);
  assert(fileNamePattern.exec(buildFileName({ raw: 'a-b.c=d', startedAt, json: false })),
    'a process name holding - and . is still decomposable from the fixed-width stamp');
});

test('a complete report is written once, with the path only returned after the file exists', async () => {
  const directory = await temp();
  const { report } = buildReport();
  const result = await produceReport({ report, outDir: directory, json: false, startedAt, name: nameInput });
  assert.equal(result.partial, true, 'a partial model is reported as partial');
  assert.deepEqual(result.problems, []);
  assert.equal(path.isAbsolute(result.path), true);
  assert.equal(path.basename(result.path), 'ngwi-SearchComponent.data-id=searchInputField-260924.130024.md');
  assert.deepEqual(await readdir(directory), [path.basename(result.path)], 'one file and no leftover lock');
  const written = await readFile(result.path, 'utf8');
  assert.equal(written, renderMarkdown({ report, outputDir: directory,
    fileNameSource: 'SearchComponent.data-id=searchInputField',
    heading: 'SearchComponent.data-id="searchInputField"' }).text);
  assert(written.includes('2026-09-24T13:00:24.000+09:00'), 'the body keeps ISO 8601 with its UTC offset');

  // §3.4-5 an existing name is never overwritten; the collision suffix goes on the process name side.
  const second = await produceReport({ report, outDir: directory, json: false, startedAt, name: nameInput });
  assert.equal(path.basename(second.path), 'ngwi-SearchComponent.data-id=searchInputField-c1-260924.130024.md');
  assert.equal(await readFile(result.path, 'utf8'), written);
});

test('--json writes exactly one file that differs only in its extension', async () => {
  const directory = await temp();
  const { report } = buildReport();
  const result = await produceReport({ report, outDir: directory, json: true, startedAt, name: nameInput });
  assert.equal(path.basename(result.path), 'ngwi-SearchComponent.data-id=searchInputField-260924.130024.json');
  assert.deepEqual(await readdir(directory), [path.basename(result.path)]);
  const parsed = JSON.parse(await readFile(result.path, 'utf8'));
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.status, 'partial');
});

test('a name that differs only in case counts as a collision', async () => {
  const directory = await temp();
  const { report } = buildReport();
  await writeFile(path.join(directory, 'NGWI-searchcomponent.DATA-ID=searchinputfield-260924.130024.md'), 'taken');
  const result = await produceReport({ report, outDir: directory, json: false, startedAt, name: nameInput });
  assert.equal(path.basename(result.path), 'ngwi-SearchComponent.data-id=searchInputField-c1-260924.130024.md');
});

test('output is serialized through a lock that another run keeps', async () => {
  const directory = await temp();
  const { report } = buildReport();
  const lock = path.join(directory, outputLockName);
  await writeFile(lock, 'held by another run');
  await assert.rejects(() => produceReport({ report, outDir: directory, json: false, startedAt, name: nameInput }),
    (error) => error instanceof OutputLockError && /Retry once it finishes/.test(error.message));
  // §3.4-5 the lock another process holds is left alone and nothing is written.
  assert.equal(await readFile(lock, 'utf8'), 'held by another run');
  assert.deepEqual(await readdir(directory), [outputLockName]);
});

test('a failed write removes the incomplete file and always releases the lock', async () => {
  const directory = await temp();
  await assert.rejects(() => writeOutput({ directory, name: () => 'ngwi-x-260924.130024.md', content: 42 }));
  assert.deepEqual(await readdir(directory), [], 'neither the half-written file nor the lock is left behind');
  const written = await writeOutput({ directory, name: () => 'ngwi-x-260924.130024.md', content: 'body' });
  assert.equal(await readFile(written, 'utf8'), 'body');
  assert.deepEqual(await readdir(directory), ['ngwi-x-260924.130024.md']);
});

test('the document is verified before anything is written', async () => {
  const directory = await temp();
  const { report } = buildReport();
  const broken = { ...report, status: 'complete-within-scope' };
  await assert.rejects(() => produceReport({ report: broken, outDir: directory, json: false, startedAt, name: nameInput }),
    /status does not match/);
  assert.deepEqual(await readdir(directory), [], 'no file and no lock are created for a report that fails validation');

  const missingKind = { ...report, edges: report.edges.map((edge, index) => index ? edge : { ...edge, kind: 'made-up' }) };
  await assert.rejects(() => produceReport({ report: missingKind, outDir: directory, json: false, startedAt, name: nameInput }));
  assert.deepEqual(await readdir(directory), []);
});

test('the CLI writes one --json file and prints only its path', async () => {
  const directory = await temp();
  const { report } = buildReport();
  const target = makeCandidate({
    contextId: hex('a'), ownerId: owner, element: { path: 'src/app/search.component.ts', start: 0, end: 1 },
    usages: [], routes: [], bootstrapId: null, insertion: null,
  }, { snapshotId: hex('c'), class: 'bootstrap', parentIds: [owner], routePattern: null, events: ['input'], partialReasons: [] });
  let captured = '';
  const sink = (keep) => new Writable({ write(chunk, _encoding, done) { keep(chunk.toString()); done(); } });
  const io = { stdin: Readable.from([]), stdout: sink((value) => { captured += value; }), stderr: sink(() => undefined) };
  const code = await runCli(['data-id=searchInputField', '--out-dir', directory, '--json'], {
    async analyze() { return { candidates: [target], truncated: false, targetDetectionIncomplete: false }; },
    async write(_item, options) {
      return produceReport({ report, outDir: options.outDir, json: options.json, startedAt, name: nameInput });
    },
  }, io);
  // §3.3 a partial report exits 5; stdout carries the finished path and nothing else.
  assert.equal(code, 5);
  const written = await readdir(directory);
  assert.equal(written.length, 1, written.join(', '));
  assert(written[0].endsWith('.json'));
  assert.equal(captured, `${path.join(directory, written[0])}\n`);
  assert(!captured.includes('schemaVersion'), 'the JSON body is never streamed to stdout');
});
