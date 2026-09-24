#!/usr/bin/env node
/**
 * §10 the CI cross-check: expectation ledger -> implementation registry -> executed fixture results.
 *
 * It fails when a required API of R01–R15 is missing or unsupported in the registry, when a ledger case
 * has no fixture, when a fixture is skipped or marked todo, when an expected relation is absent, when a
 * forbidden relation appears, or when a starting point or a source ground is wrong. R16 passes only on
 * the stated boundary, partial status and diagnostic; a word being present, a count matching or a
 * snapshot being refreshed is never enough (P16-07, P16-08).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { capabilities, capabilitiesForContract } from '../dist/adapters/reactive/index.js';
import { contractIds, reactiveCases } from '../test/contracts/reactive-cases.ts';
import { analyzeFixture, edgeKeys, fixtureRoot, repoRoot } from '../test/fixtures/harness.mjs';

const failures = [];
const fail = (area, message) => failures.push({ area, message });

const registered = capabilities();
/** Prefers the matcher filed under the same contract; `Store.dispatch` has one per R09 and R10 form. */
const matcherFor = (item) => {
  const same = registered.filter(entry => entry.module === item.package &&
    (entry.export ?? null) === (item.export ?? null) && (entry.member ?? null) === (item.member ?? null));
  return same.find(entry => entry.contracts.includes(item.contract)) ?? same[0];
};

// ---- 1. every contract exists on both sides --------------------------------------------------------
for (const id of contractIds) {
  if (!reactiveCases().some(item => item.contract === id)) fail('ledger', `${id} has no case`);
  if (!capabilitiesForContract(id).length) fail('registry', `${id} has no registered matcher`);
}

// ---- 2. the ledger against the implementation registry ---------------------------------------------
for (const item of reactiveCases()) {
  const matcher = matcherFor(item);
  if (item.kind === 'detect') {
    if (!matcher) {
      fail('registry', `${item.id}: no matcher is registered for ${item.package} ${item.export ?? '(module)'}` +
        `${item.member ? `.${item.member}` : ''}`);
      continue;
    }
    if (matcher.support !== 'supported') {
      fail('registry', `${item.id}: ${matcher.matcherId} is ${matcher.support} although R01-R15 require it`);
    }
    if (!matcher.semanticId) fail('registry', `${item.id}: ${matcher.matcherId} has no semantic model`);
    // R15 is the composite row: it reuses the APIs the other rows register, so it files nothing of its own.
    if (item.contract !== 'R15' && !matcher.contracts.includes(item.contract)) {
      fail('registry', `${item.id}: ${matcher.matcherId} is filed under ${matcher.contracts.join(', ')}`);
    }
  }
  if (item.kind === 'unsupported' && matcher && matcher.support !== 'unsupported') {
    fail('registry', `${item.id}: ${matcher.matcherId} claims support for a range with no semantic model`);
  }
  // A counter-example is about a form, not about the API: `patchState` is registered and still must not
  // turn a deep mutation into a notification. The assertion for it lives in the fixture's forbidden edges.
}

// ---- 3. fixtures the ledger names, and the ones it does not ----------------------------------------
const reports = new Map();
const reportFor = async (fixture) => {
  const key = `${fixture.id}|${fixture.target}`;
  if (!reports.has(key)) {
    const run = await analyzeFixture(fixture.id, { target: fixture.target });
    reports.set(key, run.report);
  }
  return reports.get(key);
};

const labelOf = (report, id) => {
  const node = report.nodes.find(item => item.id === id);
  if (!node) return id;
  return node.details.label?.value ?? node.details.name?.value ??
    (node.role === 'definition' ? node.id.slice('def:'.length) : node.kind);
};

for (const item of reactiveCases()) {
  if (!item.fixture) {
    fail('fixture', `${item.id}: no fixture covers it — ${item.missingFixture}`);
    continue;
  }
  const report = await reportFor(item.fixture);
  if (!report) { fail('fixture', `${item.id}: ${item.fixture.id} produced no report`); continue; }
  const keys = edgeKeys(report);
  for (const expected of item.expectedEdges) {
    if (!keys.includes(expected)) fail('edge', `${item.id}: expected ${expected} in ${item.fixture.id}`);
  }
  for (const node of item.expectedNodes) {
    const found = report.nodes.some(entry => entry.kind === node.kind && labelOf(report, entry.id) === node.label);
    if (!found) fail('node', `${item.id}: expected a ${node.kind} node named ${node.label} in ${item.fixture.id}`);
  }
  for (const pattern of item.forbiddenEdges) {
    const hit = report.edges.filter(edge => (!pattern.kind || edge.kind === pattern.kind) &&
      (!pattern.from || labelOf(report, edge.from) === pattern.from) &&
      (!pattern.to || labelOf(report, edge.to) === pattern.to));
    if (hit.length) {
      fail('edge', `${item.id}: forbidden ${hit.map(edge => `${edge.kind}|${labelOf(report, edge.from)}|` +
        `${labelOf(report, edge.to)}`).join(', ')} — ${pattern.reason}`);
    }
  }
  // §7.6 what must hold for a relation is written on its condition, so it is checked with the relation.
  if (item.expectedConditions.length) {
    const conditions = new Map(report.conditions.map(entry => [entry.id, entry]));
    const text = (id) => {
      const condition = conditions.get(id);
      if (!condition) return '';
      if (condition.kind === 'predicate') return condition.expression;
      if (condition.kind === 'all' || condition.kind === 'any') return condition.operandIds.map(text).join(' && ');
      if (condition.kind === 'phase') return `phase ${condition.phase} ${condition.detail ?? ''}`;
      return condition.kind;
    };
    const written = report.edges
      .filter(edge => item.expectedEdges.includes(`${edge.kind}|${labelOf(report, edge.from)}|${labelOf(report, edge.to)}`))
      .map(edge => text(edge.conditionId)).join(' | ');
    for (const expected of item.expectedConditions) {
      if (!written.includes(expected)) {
        fail('condition', `${item.id}: expected the condition "${expected}" on its relations in ${item.fixture.id}`);
      }
    }
  }
  for (const expected of item.expectedDetails) {
    const edge = report.edges.find(entry =>
      `${entry.kind}|${labelOf(report, entry.from)}|${labelOf(report, entry.to)}` === expected.edge);
    if (!edge) { fail('detail', `${item.id}: ${expected.edge} is not in ${item.fixture.id}`); continue; }
    const field = edge.details[expected.key];
    if ((field?.value ?? null) !== expected.value) {
      fail('detail', `${item.id}: ${expected.edge} has ${expected.key}=${field?.value ?? 'null'}, ` +
        `expected ${expected.value}`);
    }
  }
  for (const code of item.expectedDiagnostics) {
    if (!report.diagnostics.some(entry => entry.code === code)) {
      fail('diagnostic', `${item.id}: expected the diagnostic ${code} in ${item.fixture.id}`);
    }
  }
  // Every relation names where it was read; a starting point or a ground that is missing is a failure.
  for (const edge of report.edges) {
    if (!edge.evidenceIds.length) fail('evidence', `${item.id}: ${edge.kind} has no source ground`);
  }
  for (const operation of report.operations) {
    if (operation.eventId !== report.selection.targetNodeId) {
      fail('evidence', `${item.id}: operation ${operation.event} does not start at the selected element`);
    }
  }
  // P16-08: an unsupported range passes only on the boundary, the partial status and the diagnostic.
  if (item.kind === 'unsupported') {
    const diagnosed = report.diagnostics.filter(entry => item.expectedDiagnostics.includes(entry.code));
    if (!diagnosed.some(entry => entry.stopReason)) {
      fail('unsupported', `${item.id}: the diagnostic records no stop reason`);
    }
    if (report.status !== 'partial') {
      fail('unsupported', `${item.id}: an unsupported range must leave the report partial`);
    }
    if (!report.nodes.some(entry => entry.kind === 'boundary')) {
      fail('unsupported', `${item.id}: an unsupported range must end at a boundary node`);
    }
  }
}

// ---- 4. no fixture is skipped, marked todo, or left unregistered ------------------------------------
const named = new Set(reactiveCases().flatMap(item => item.fixture ? [item.fixture.id] : []));
const testDirectory = path.join(repoRoot, 'test');
const testFiles = (await readdir(testDirectory)).filter(name => name.endsWith('.test.mjs'));
const usedInTests = new Set();
for (const name of testFiles) {
  const text = await readFile(path.join(testDirectory, name), 'utf8');
  if (/\b(?:test|it|describe)\.(?:skip|todo)\b|[,{]\s*(?:skip|todo)\s*:\s*true/.test(text)) {
    fail('fixture', `${name} skips or marks todo a test; the contract check requires every case to run`);
  }
  for (const match of text.matchAll(/analyzeFixture\(\s*'([^']+)'/g)) usedInTests.add(match[1]);
}
for (const entry of await readdir(fixtureRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!named.has(entry.name) && !usedInTests.has(entry.name)) {
    fail('fixture', `test/fixtures/${entry.name} is registered nowhere in the ledger or the tests`);
  }
  const workspace = path.join(fixtureRoot, entry.name, 'angular.json');
  if (!await stat(workspace).then(item => item.isFile(), () => false)) {
    fail('fixture', `test/fixtures/${entry.name} has no angular.json and cannot be analysed`);
  }
}

// ---- report ----------------------------------------------------------------------------------------
const cases = reactiveCases();
const covered = cases.filter(item => item.fixture).length;
process.stdout.write(`contract cases: ${cases.length}, with a fixture: ${covered}, ` +
  `without: ${cases.length - covered}\n`);
if (!failures.length) {
  process.stdout.write('contract check: every ledger case is registered and green\n');
  process.exit(0);
}
const byArea = new Map();
for (const item of failures) byArea.set(item.area, [...(byArea.get(item.area) ?? []), item.message]);
for (const [area, messages] of [...byArea].sort()) {
  process.stdout.write(`\n${area} (${messages.length}):\n`);
  for (const message of messages) process.stdout.write(`  - ${message}\n`);
}
process.stdout.write(`\ncontract check failed with ${failures.length} problems\n`);
process.exit(1);
