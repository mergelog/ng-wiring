import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeFixture, withFixture, optionsFor, edgeKeys } from './fixtures/harness.mjs';
import { analyzeWorkspace, assembleReport, contextOf } from '../dist/assemble/index.js';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { renderSimple } from '../dist/render/simple.js';

// check:angular20 installs an actual isolated toolchain; no metadata substitution or bundled fallback.
const toolchainRoot = process.env.NGWI_ANGULAR20_ROOT;
const dependencies = toolchainRoot
  ? JSON.parse(await readFile(path.join(toolchainRoot, 'package.json'), 'utf8')).dependencies : undefined;
const enabled = { skip: !toolchainRoot };
const toolchain = { toolchainRoot, dependencies };
const analyze = (name, input) => analyzeFixture(name, { ...input, ...toolchain });

test('Angular 20 loads its own TypeScript/compiler and verifies ngmaze edges', enabled, async () => {
  await analyze('minimal-app', { target: 'data-id=targetInput', pick: candidates => candidates[1], then: async ({ report, root }) => {
    assert(report);
    const resolved = await resolveToolchain(root);
    assert.match(resolved.compiler.version, /^20\./);
    assert.match(resolved.ts.version, /^5\.[89]\./);
    assert.equal(resolved.core.version, resolved.compiler.version);
    assert.deepEqual(resolved.unsupportedReactive, []);
    assert.equal(report.context.toolchain.angularCompiler, resolved.compiler.version);
    assert.equal(report.context.toolchain.typescript, resolved.ts.version);
    assert(report.edges.some(edge => edge.origin === 'ngmaze-verified'));
  } });
});

test('Angular 20 @switch cases/default retain their conditions in reports', enabled, async () => {
  await withFixture('signal-write', async root => {
    await writeFile(path.join(root, 'src/counter.ts'), `import {Component, signal} from '@angular/core';
@Component({selector:'app-counter', template: \`
@if (visible) { @switch (mode) {
  @case ('edit') { <button data-id="edit" (click)="increment()">edit</button> }
  @case ('view') { <button data-id="view" (click)="increment()">view</button> }
  @default { <button data-id="fallback" (click)="increment()">fallback</button> }
} } <span>{{count()}}</span>\`})
export class CounterComponent { visible=true; mode='edit'; count=signal(0); increment(){this.count.update(n=>n+1);} }
`);
    for (const [target, condition] of [['edit', "mode === 'edit'"], ['view', "mode === 'view'"],
      ['fallback', "mode matches no @case ('edit', 'view')"]]) {
      const options = optionsFor({ target: `data-id=${target}` });
      const analysis = await analyzeWorkspace({ options, cwd: root });
      assert.equal(analysis.candidates.length, 1);
      const selected = analysis.candidates[0];
      const report = assembleReport({ analysis: contextOf(analysis, selected), selected,
        candidates: analysis.candidates, options, toolVersion: '0.1.0', startedAt: new Date(), enumerationComplete: true });
      const text = renderSimple({ report, outputDir: root }).text;
      assert(report.conditions.some(item => item.expression === condition), JSON.stringify(report.conditions));
      assert(text.includes('@if (visible)'), text);
      assert(report.edges.some(edge => edge.kind === 'state-write'));
    }
  }, toolchain);
});

test('Angular 20/NgRx 20 SignalStore patchState reaches its rendered state', enabled, async () => {
  const { report } = await analyze('signal-store-patch', { target: 'data-id=filterField' });
  assert(report);
  assert(report.edges.some(edge => edge.kind === 'state-write'));
  assert(report.edges.some(edge => edge.kind === 'state-read'));
  assert(!report.edges.some(edge => edge.kind === 'http-create'));
});

test('Angular 20 model signals propagate to their parent two-way binding', enabled, async () => {
  const { report } = await analyze('interop-apis', { target: 'data-id=commitButton' });
  assert(report);
  assert(report.edges.some(edge => edge.kind === 'state-write'));
  const emitted = report.edges.find(edge => edge.kind === 'output-subscription');
  assert(emitted);
  assert.equal(emitted.confidence, 'conditional');
  assert(edgeKeys(report).includes('input-binding|FieldComponent|value'));
});

test('Angular 20 Signal writes reach computed values and display without HTTP', enabled, async () => {
  const { report } = await analyze('signal-write', { target: 'data-id=incrementButton' });
  assert(report);
  const keys = edgeKeys(report).join('\n');
  assert.match(keys, /state-write/);
  assert.match(keys, /reactive-link.*doubled/);
  assert(!report.edges.some(edge => edge.kind === 'http-create'));
});

test('Angular 20/NgRx 20 selector subscriptions reach the correct HTTP endpoint', enabled, async () => {
  const { report } = await analyze('store-selector-subscription', { target: 'data-id=changeTerm' });
  assert(report);
  assert(report.edges.some(edge => edge.kind === 'action-dispatch' && edge.details.action?.value?.endsWith('#loadResults')));
  assert(report.edges.some(edge => edge.kind === 'http-create' && edge.details.urlExpression?.value === '/api/results'));
  assert(!report.edges.some(edge => edge.kind === 'http-create' && edge.details.urlExpression?.value === '/api/status'));
});

test('Angular 20 route queryParams, toSignal and effect reach follow-up HTTP', enabled, async () => {
  const { report } = await analyze('catalog-route-bridge', { target: 'data-id=catalogApply' });
  assert(report);
  for (const url of ['/api/tasks.get_all_ex', '/api/models.get_all_ex'])
    assert(report.edges.some(edge => edge.kind === 'http-create' && edge.details.urlExpression?.value === url), url);
  assert(!report.edges.some(edge => edge.kind === 'http-create' &&
    ['/api/projects.get_all_ex', '/api/unrelated.get_all_ex'].includes(edge.details.urlExpression?.value)));
});
