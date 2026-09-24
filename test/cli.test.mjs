import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable, Readable, PassThrough } from 'node:stream';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArguments, parseAttribute, parseSource, resolveWorkspacePath, UsageError } from '../dist/cli/arguments.js';
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
  assert.throws(() => parseArguments(['x=y', '--unknown']), UsageError);
  assert.equal(parseArguments(['--help']).kind, 'help');
  assert.equal(parseArguments(['--version']).kind, 'version');
  const parsed = parseArguments(['--source', 'src/view.html:1', '--tsconfig', 'config/tsconfig.json', '--out-dir', 'reports', '--json'], '/work');
  assert.equal(parsed.options.tsconfig, '/work/config/tsconfig.json');
  assert.equal(parsed.options.outDir, '/work/reports');
  assert.equal(parsed.options.json, true);
  assert.equal(resolveWorkspacePath('/workspace', 'src/view.html'), '/workspace/src/view.html');
  assert.equal(resolveWorkspacePath('/workspace', 'C:\\src\\view.html'), 'C:\\src\\view.html');
});

const point = (offset) => ({ path: 'src/owner.ts', line: 1, column: offset, offset });
const candidate = (start, owner = 'src/owner.ts#Owner') => makeCandidate({
  contextId: 'context', ownerId: owner, element: { path: 'src/owner.html', start, end: start + 1 },
  usages: [point(start)], routes: [], bootstrapId: null, insertion: null,
}, { snapshotId: 'snapshot', class: 'declaration', parentIds: [owner], routePattern: '/a/:id', events: ['keydown.enter'], partialReasons: [] });

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
