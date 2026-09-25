import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { renderSimple } from '../dist/render/simple.js';

const field = (value) => ({ value, unresolvedReason: null });

test('the short map follows output subscriptions before a propagated HTTP request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-simple-'));
  try {
    const files = {
      'view.html': '<form></form>\n',
      'input.html': '(keydown.enter)="save()"\n',
      'input.ts': 'this.changed.emit(value)\n',
      'host.html': '(changed)="onChanged($event)"\n',
      'host.ts': 'this.saved.emit(value)\n',
      'parent.html': '(saved)="onSaved($event)"\n',
      'parent.ts': 'this.store.dispatch(updated())\n',
      'effect.ts': 'updateDetails$ = createEffect(() => {})\nthis.apiRecords.recordsUpdate({})\n',
      'records.service.ts': 'return this.apiRequest.post(`${basePath}/api/items/update`)\n',
    };
    await Promise.all(Object.entries(files).map(([file, source]) => writeFile(path.join(root, file), source)));
    const evidence = [];
    const edges = [];
    const add = (kind, from, to, file, line, details = {}) => {
      const id = `edge:${edges.length}`;
      const evidenceId = `ev:${evidence.length}`;
      evidence.push({ id: evidenceId, file, startLine: line, startOffset: 0, endOffset: 1 });
      edges.push({ id, kind, from, to, evidenceIds: [evidenceId], details: Object.fromEntries(
        Object.entries(details).map(([key, value]) => [key, field(value)])) });
      return id;
    };
    const listener = add('dom-listener', 'input', 'first', 'input.html', 1, { handler: 'save()' });
    const emitChanged = add('output-emit', 'first', 'changed', 'input.ts', 1, { output: 'changed' });
    const subscribeChanged = add('output-subscription', 'changed', 'second', 'host.html', 1,
      { output: 'changed', subscriber: 'onChanged($event)' });
    const emitSaved = add('output-emit', 'second', 'saved', 'host.ts', 1, { output: 'saved' });
    const subscribeSaved = add('output-subscription', 'saved', 'third', 'parent.html', 1,
      { output: 'saved', subscriber: 'onSaved($event)' });
    const dispatch = add('action-dispatch', 'third', 'action', 'parent.ts', 1);
    const consume = add('action-consume', 'action', 'effect', 'parent.ts', 1,
      { consumer: 'effect.ts#updateDetails$' });
    const call = add('call', 'effect', 'service', 'effect.ts', 2, { callee: 'apiRecords.recordsUpdate' });
    const request = add('http-create', 'service', 'http', 'records.service.ts', 1,
      { method: 'POST', urlExpression: '${basePath}/api/items/update' });
    evidence.push({ id: 'ev:view', file: 'view.html', startLine: 1, startOffset: 0, endOffset: 13 });
    const op = (id, event, file, edgeIds) => ({ id, event, listenerId: `def:${file}#${id}.${event}:handler`, edgeIds });
    const report = {
      context: { workspaceRoot: root }, query: { raw: 'data-id=x', target: { kind: 'attribute', value: 'x' },
        filters: { project: null, tsconfig: null, through: null, route: null, candidate: null, event: null } },
      selection: { candidateId: 'candidate' }, paths: [{ occurrenceIds: ['node:view'] }],
      nodes: [{ id: 'node:view', kind: 'element', evidenceIds: ['ev:view'],
        details: { label: field('<form>'), relation: field('element') } }], edges, evidence,
      operations: [op('Input', 'keydown.enter', 'input.ts', [listener, emitChanged, request]),
        op('Host', 'changed', 'host.ts', [subscribeChanged, emitSaved, request]),
        op('Parent', 'saved', 'parent.ts', [subscribeSaved, dispatch, consume, call, request])],
    };
    const result = renderSimple({ report, outputDir: root, fileNameSource: '', heading: '' });
    const rows = result.text.split('\n').filter(line => /^- \d\d\./.test(line));
    assert.equal(rows.length, 10);
    assert(rows[0].includes('&lt;form&gt;'));
    assert(rows[2].includes('this.changed.emit'));
    assert(rows[3].includes('Host.onChanged'));
    assert(rows[4].includes('this.saved.emit'));
    assert(rows[5].includes('Parent.onSaved'));
    assert(rows.at(-1).includes('api/items/update'));
    const below = renderSimple({ report, outputDir: root, fileNameSource: '', heading: '', belowData: true });
    assert.equal(below.text.split('\n').filter(line => /^- \d\d\./.test(line)).length, 9);
    report.query.filters.event = 'keydown.enter';
    assert.equal(renderSimple({ report, outputDir: root, fileNameSource: '', heading: '' }).text
      .split('\n').filter(line => /^- \d\d\./.test(line)).length, 10);
  } finally { await rm(root, { recursive: true, force: true }); }
});
