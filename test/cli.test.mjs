import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable, Readable, PassThrough } from 'node:stream';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArguments, parseAttribute, parseDomSelector, parseSource, resolveWorkspacePath, UsageError } from '../dist/cli/arguments.js';
import { makeCandidate, sortCandidates, filterCandidates, selectCandidate, canonicalJson, formatCandidateList } from '../dist/cli/candidates.js';
import { runCli } from '../dist/cli/run.js';

test('attribute and source grammar retain exact values', () => {
  assert.deepEqual(parseAttribute('data-id="a=b"'), { kind: 'attribute', raw: 'data-id="a=b"', name: 'data-id', value: 'a=b' });
  assert.equal(parseAttribute('data-id="a\"b"').value, 'a"b');
  assert.equal(parseAttribute('存在=').value, '');
  assert.equal(parseAttribute('key=é').value, 'é');
  assert.equal(parseSource('C:\\src\\app.html:51').file, 'C:\\src\\app.html');
  assert.equal(parseSource('/tmp/a.html:51').line, 51);
  for (const raw of ['', '=x']) assert.throws(() => parseAttribute(raw), UsageError);
  for (const raw of ['file:0', 'file:-1', 'file:1.2', 'C:\\file']) assert.throws(() => parseSource(raw), UsageError);
});

test('argument validation occurs before analysis', () => {
  assert.throws(() => parseArguments(['x=y', '--source', 'file:1']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--project', 'x', '--tsconfig', 'y']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--project', 'x', '--project', 'y']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--candidate', 'cand:short']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--selector', 'body input']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--selector', 'body > > input']), UsageError);
  assert.throws(() => parseArguments(['x=y', '--unknown']), UsageError);
  assert.equal(parseArguments(['--help']).kind, 'help');
  assert.equal(parseArguments(['--version']).kind, 'version');
  const parsed = parseArguments(['--source', 'src/view.html:1', '--tsconfig', 'config/tsconfig.json', '--out-dir', 'reports', '--json'], '/work');
  assert.equal(parsed.options.tsconfig, '/work/config/tsconfig.json');
  assert.equal(parsed.options.outDir, '/work/reports');
  assert.equal(parsed.options.json, true);
  assert.equal(parseArguments(['x=y', '--selector', 'body > sm-root > input']).options.selector,
    'body > sm-root > input');
  assert.equal(resolveWorkspacePath('/workspace', 'src/view.html'), '/workspace/src/view.html');
  assert.equal(resolveWorkspacePath('/workspace', 'C:\\src\\view.html'), 'C:\\src\\view.html');
});

test('simple is the default and detail and belowData have distinct contracts', () => {
  assert.equal(parseArguments(['x=y']).options.detail, undefined);
  assert.equal(parseArguments(['x=y', '--detail']).options.detail, true);
  assert.equal(parseArguments(['x=y', '--belowData']).options.belowData, true);
  for (const args of [['--detail', '--json'], ['--belowData', '--detail'], ['--belowData', '--json'],
    ['--detail', '--detail'], ['--belowData', '--belowData']]) {
    assert.throws(() => parseArguments(['x=y', ...args]), UsageError);
  }
});

const point = (offset) => ({ path: 'src/owner.ts', line: 1, column: offset, offset });
const candidate = (start, owner = 'src/owner.ts#Owner') => makeCandidate({
  contextId: 'context', ownerId: owner, element: { path: 'src/owner.html', start, end: start + 1 },
  usages: [point(start)], routes: [], bootstrapId: null, insertion: null,
}, { snapshotId: 'snapshot', class: 'declaration', parentIds: [owner], routePattern: '/a/:id', events: ['keydown.enter'], partialReasons: [] });

test('DevTools selector chooses the matching component display path', () => {
  const copied = 'body > sm-root > sm-app-shell > div > sm-common-experiments > as-split-area:nth-child(2) > ' +
    'sm-experiment-output > sm-experiment-info-header > sm-inline-edit > div.input > form > input';
  assert.deepEqual(parseDomSelector(copied), ['body', 'sm-root', 'sm-app-shell', 'div',
    'sm-common-experiments', 'as-split-area', 'sm-experiment-output', 'sm-experiment-info-header',
    'sm-inline-edit', 'div', 'form', 'input']);
  assert.deepEqual(parseDomSelector('#app > sm-inline-edit > input'), ['sm-inline-edit', 'input']);
  const shared = ['sm-root', 'sm-app-shell'];
  const header = ['sm-experiment-output', 'sm-experiment-info-header', 'sm-inline-edit'];
  const insideExperiments = { ...candidate(2), dom: { componentTags: [...shared, 'sm-common-experiments', ...header],
    targetTag: 'input' } };
  const directOutput = { ...candidate(3), dom: { componentTags: [...shared, ...header], targetTag: 'input' } };
  assert.deepEqual(filterCandidates([insideExperiments, directOutput], { selector: copied }), [insideExperiments]);
  assert.deepEqual(filterCandidates([insideExperiments, directOutput], {
    selector: 'sm-inline-edit > div > form > input',
  }), [insideExperiments, directOutput]);
  assert.deepEqual(filterCandidates([insideExperiments], { selector: 'sm-inline-edit > span' }), []);
  assert.throws(() => filterCandidates([insideExperiments], { selector: 'body > div > input' }), UsageError);
});

test('candidate identity is stable, numeric positions sort numerically and filters are exact', () => {
  const a = candidate(2), b = candidate(10);
  assert.equal(a.id, candidate(2).id);
  assert.equal(a.id, makeCandidate(a.tuple, { ...a, snapshotId: 'other' }).id);
  assert.deepEqual(sortCandidates([b, a]).map(c => c.tuple.element.start), [2, 10]);
  assert.equal(selectCandidate([a, b], '1'), a);
  assert.equal(selectCandidate([a, b], b.id), b);
  assert.throws(() => selectCandidate([a, b], '3'), UsageError);
  assert.equal(filterCandidates([a], { event: 'keydown' })[0].events.length, 1);
  assert.equal(filterCandidates([a], { event: 'keydown.escape' })[0].eventFilterReason, 'No listener matched keydown.escape');
  assert.equal(filterCandidates([a], { route: '/a/123' }).length, 0);
  assert.equal(filterCandidates([a], { through: 'src/owner.ts#Owner' }).length, 1);
  assert.throws(() => filterCandidates([a, candidate(3, 'src/other.ts#Owner')], { through: 'Owner' }), /Ambiguous/);
  assert.equal(canonicalJson({ '\u{10000}': 1, '\ue000': 2 }), '{"\ue000":2,"\u{10000}":1}');
  assert.match(formatCandidateList([a]), /\[declaration\]/);
});

test('candidate list exposes route and parent path when the target location is shared', () => {
  const base = candidate(726, 'src/inline-edit.ts#InlineEditComponent');
  const bootstrapId = 'app:src/main.ts#10';
  const makeChoice = (parent, use) => makeCandidate({ ...base.tuple,
    usages: [{ path: `src/${use}.html`, line: 5, column: 1, offset: 0 }], bootstrapId,
  }, { snapshotId: 'snapshot', class: 'bootstrap',
    parentIds: [base.tuple.ownerId, `src/${parent}.ts#${parent}`, 'src/app.ts#AppComponent', bootstrapId],
    routePattern: '/settings/profile', events: [], partialReasons: [] });
  const profile = makeChoice('ProfileNameComponent', 'profile');
  const account = makeChoice('AccountNameComponent', 'account');
  const list = formatCandidateList([profile, account]);
  assert.match(list, /1\. \[bootstrap\] route: \/settings\/profile/);
  assert.match(list, /path: AppComponent -> ProfileNameComponent -> InlineEditComponent/);
  assert.match(list, /path: AppComponent -> AccountNameComponent -> InlineEditComponent/);
  assert.match(list, /use: src\/profile\.html:5/);
  assert.match(list, /use: src\/account\.html:5/);
  assert.match(list, /target: src\/owner\.html \(offset 726\); ID: cand:[0-9a-f]{64}/);
  assert(!list.includes('-> 10'), 'bootstrap position is not a component name');
  assert.match(formatCandidateList([{ ...base, routePattern: null, tuple: { ...base.tuple, usages: [] } }]),
    /route: \(none\)[\s\S]*use: \(none\)/);
});

function capturedIo() {
  let stdout = '', stderr = '';
  const sink = (set) => new Writable({ write(chunk, _encoding, done) { set(chunk.toString()); done(); } });
  return { io: { stdin: Readable.from([]), stdout: sink(s => stdout += s), stderr: sink(s => stderr += s) }, output: () => ({ stdout, stderr }) };
}

test('non-TTY ambiguity emits IDs on stderr without creating output', async () => {
  const { io, output } = capturedIo();
  let writes = 0;
  const code = await runCli(['x=y'], {
    async analyze() { return { candidates: [candidate(10), candidate(2)], truncated: false, targetDetectionIncomplete: false }; },
    async write() { writes++; return { path: '/tmp/file.md', partial: false }; },
  }, io);
  assert.equal(code, 2);
  assert.equal(writes, 0);
  assert.equal(output().stdout, '');
  assert.match(output().stderr, /cand:[0-9a-f]{64}/);
});

test('CLI writes one path only after a selected candidate succeeds', async () => {
  const { io, output } = capturedIo();
  const code = await runCli(['x=y', '--candidate', '1'], {
    async analyze() { return { candidates: [candidate(2)], truncated: false, targetDetectionIncomplete: false }; },
    async write() { return { path: '/tmp/file.md', partial: false }; },
  }, io);
  assert.equal(code, 0);
  assert.equal(output().stdout, '/tmp/file.md\n');
});

test('truncated enumeration prevents automatic selection and explains missing ID', async () => {
  const backend = {
    async analyze() { return { candidates: [candidate(2)], truncated: true, targetDetectionIncomplete: false }; },
    async write() { throw Error('must not write'); },
  };
  const first = capturedIo();
  assert.equal(await runCli(['x=y'], backend, first.io), 2);
  assert.match(first.output().stderr, /Narrow with --through/);
  const second = capturedIo();
  assert.equal(await runCli(['x=y', '--candidate', `cand:${'f'.repeat(64)}`], backend, second.io), 3);
  assert.match(second.output().stderr, /Narrow with --through/);
});

test('candidate cap is applied after route filtering', async () => {
  const all = Array.from({ length: 1_001 }, (_, i) => candidate(i + 1));
  all[1000] = { ...all[1000], routePattern: '/unique' };
  const { io, output } = capturedIo();
  assert.equal(await runCli(['x=y'], {
    async analyze() { return { candidates: all, truncated: false, targetDetectionIncomplete: false }; },
    async write() { throw Error('must not write'); },
  }, io), 2);
  assert.match(output().stderr, /Candidate enumeration was truncated/);
  const narrowed = capturedIo();
  assert.equal(await runCli(['x=y', '--route', '/unique'], {
    async analyze() { return { candidates: all, truncated: false, targetDetectionIncomplete: false }; },
    async write() { return { path: '/tmp/unique.md', partial: false }; },
  }, narrowed.io), 0);
  assert.equal(narrowed.output().stdout, '/tmp/unique.md\n');
});

test('TTY EOF returns selection code and SIGINT never reports a path', async () => {
  const { io } = capturedIo();
  const input = new PassThrough();
  input.isTTY = true;
  io.stdin = input;
  io.stderr.isTTY = true;
  setImmediate(() => input.end());
  const backend = {
    async analyze() { return { candidates: [candidate(2), candidate(3)], truncated: false, targetDetectionIncomplete: false }; },
    async write() { throw Error('must not write'); },
  };
  assert.equal(await runCli(['x=y'], backend, io), 2);
  const aborted = new AbortController();
  aborted.abort();
  const next = capturedIo();
  assert.equal(await runCli(['x=y'], backend, next.io, process.cwd(), aborted.signal), 130);
  assert.equal(next.output().stdout, '');
});

test('exit codes distinguish no match, incomplete detection, partial output and runtime failure', async () => {
  const noMatch = (incomplete) => ({
    async analyze() { return { candidates: [], truncated: false, targetDetectionIncomplete: incomplete }; },
    async write() { throw Error('must not write'); },
  });
  assert.equal(await runCli(['x=y'], noMatch(false), capturedIo().io), 1);
  assert.equal(await runCli(['x=y'], noMatch(true), capturedIo().io), 5);
  assert.equal(await runCli(['x=y'], { async analyze() { throw Error('broken'); }, async write() {} }, capturedIo().io), 4);
  const partial = { ...candidate(2), partialReasons: ['unknown parent'] };
  const { io, output } = capturedIo();
  assert.equal(await runCli(['x=y'], {
    async analyze() { return { candidates: [partial], truncated: false, targetDetectionIncomplete: false }; },
    async write() { return { path: '/tmp/partial.md', partial: true }; },
  }, io), 5);
  assert.equal(output().stdout, '/tmp/partial.md\n');
});

test('output directory is created and --json is forwarded to renderer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-cli-'));
  try {
    const out = path.join(root, 'reports');
    const { io } = capturedIo();
    assert.equal(await runCli(['x=y', '--out-dir', out, '--json'], {
      async analyze() { return { candidates: [candidate(2)], truncated: false, targetDetectionIncomplete: false }; },
      async write(_item, options) { assert.equal(options.json, true); assert.equal(options.outDir, out); return { path: path.join(out, 'one.json'), partial: false }; },
    }, io), 0);
    assert((await stat(out)).isDirectory());
  } finally { await rm(root, { recursive: true, force: true }); }
});
