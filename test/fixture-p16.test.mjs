import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture, edgeKeys } from './fixtures/harness.mjs';

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

// P16-02: the expected relations of the displayed search input, as an exact set.
const searchInputEdges = [
  'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
  'display-parent|<main>|EditableSectionComponent',
  'display-parent|<section>|ng-content select="[search-button]"',
  'display-parent|EditableSectionComponent|<section>',
  'display-parent|SearchComponent|<input>',
  'display-parent|bootstrapApplication(src/main.ts)|<main>',
  'dom-listener|<input>|input → onValueChange($event)',
  'projection|ng-content select="[search-button]"|SearchComponent',
  'route-outlet|route /search|EditableSectionComponent',
  'state-read|value|<span>',
  'state-write|input → onValueChange($event)|value',
  'template-use|src/search-page.ts#SearchPageComponent|EditableSectionComponent',
  'template-use|src/search-page.ts#SearchPageComponent|SearchComponent',
];

/**
 * §10 relations that must not appear. The exact set above already excludes them; they are named so the
 * mistake each one stands for stays recorded when the expected set grows.
 */
const searchInputForbidden = [
  // A14: the save request is in the workspace but no operation from this input reaches it.
  { reason: 'an unrelated request is attributed to the search input', match: edge => edge.startsWith('http-') },
  { reason: 'the save service appears in the search input report', match: edge => /Save|\/api\/documents/.test(edge) },
  { reason: 'a component with no display use is pulled into this path', match: edge => edge.includes('Unused') },
  { reason: 'the same-named class in another file is mixed in', match: edge => edge.includes('src/legacy/') },
  // §6.1 the outlet host is not the direct display parent of what a nested component renders.
  { reason: 'a display parent skips the components between it and the element', match: edge => edge === 'display-parent|<main>|<input>' },
  // §6.1 the component that projects content does not declare what was projected into it.
  { reason: 'the projection host is credited with declaring the projected child',
    match: edge => edge === 'template-use|src/section.ts#EditableSectionComponent|SearchComponent' },
  { reason: 'a component other than the bootstrapped one is bootstrapped', match: edge => /^bootstrap\|/.test(edge) && !edge.endsWith('AppComponent') },
];

test('the displayed search input produces exactly the expected parent and causal edges', async () => {
  const { report } = await analyzeFixture('minimal-app', { target: 'data-id=searchInputField',
    pick: bootstrapped });
  const keys = edgeKeys(report).sort();
  assert.deepEqual(keys, [...searchInputEdges].sort());
  for (const rule of searchInputForbidden) {
    const hit = keys.filter(rule.match);
    assert.deepEqual(hit, [], `${rule.reason}: ${hit.join(', ')}`);
  }
  // Every edge carries source evidence and a recorded origin; none is asserted without a position (§5).
  for (const edge of report.edges) {
    assert(edge.evidenceIds.length > 0, `${edge.kind} has no evidence`);
    assert(['ngmaze', 'ngmaze-verified', 'ng-wiring'].includes(edge.origin), `${edge.kind} has origin ${edge.origin}`);
  }
});

// P16-02: the undisplayed twin must not acquire the other one's root.
test('the same-named class that is never displayed gets no root, route or projection edge', async () => {
  const { report } = await analyzeFixture('minimal-app', { target: 'data-id=searchInputField', pick: orphan });
  const keys = edgeKeys(report);
  for (const kind of ['bootstrap', 'route-outlet', 'projection', 'template-use', 'display-parent']) {
    assert.deepEqual(keys.filter(key => key.startsWith(`${kind}|`)), [],
      `${kind} was asserted for a component with no display use`);
  }
  assert.deepEqual(keys, ['boundary|<input>|boundary'], keys.join(', '));
  assert.equal(report.paths[0].end, 'root-unresolved');
});
