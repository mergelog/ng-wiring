import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture } from './fixtures/harness.mjs';

const bootstrapped = (candidates) => candidates.find(item => item.candidate.class === 'bootstrap');
const orphan = (candidates) => candidates.find(item => item.candidate.tuple.ownerId.startsWith('src/legacy/'));

// P16-01
test('the minimal Angular 22 fixture enumerates the displayed use and the false-positive twin', async () => {
  const { analysis } = await analyzeFixture('minimal-app', { target: 'data-id=searchInputField' });
  const ids = analysis.candidates.map(item => item.candidate.tuple.ownerId);
  assert.deepEqual([...ids].sort(), ['src/legacy/search.ts#SearchComponent', 'src/search.ts#SearchComponent']);
  // The two candidates share a class name; only the declaring path tells them apart (§8, A04).
  const displayed = bootstrapped(analysis.candidates);
  assert.equal(displayed.candidate.tuple.ownerId, 'src/search.ts#SearchComponent');
  assert.equal(displayed.path.end, 'bootstrap');
  assert.deepEqual(displayed.candidate.events, ['input']);
  // The same-named class is never displayed, so its path stops instead of borrowing the other root.
  const unused = orphan(analysis.candidates);
  assert.equal(unused.path.end, 'root-unresolved');
  assert.deepEqual(unused.candidate.events, []);
  assert.equal(analysis.truncated, false);
});

// P16-01: the element that is declared but never used is a missing case, not an error.
test('a component with no display use is reported as a candidate without a root', async () => {
  const { analysis, report } = await analyzeFixture('minimal-app', { target: 'data-id=unusedMarker' });
  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].path.end, 'root-unresolved');
  assert.equal(report.status, 'partial');
  assert.equal(report.paths[0].coverage, 'partial');
  assert(report.paths[0].coverageReasons.some(reason => reason.includes('root-unresolved')),
    report.paths[0].coverageReasons.join(' | '));
  assert(report.nodes.some(node => node.kind === 'boundary'), 'the unresolved root ends at a boundary node');
});
