#!/usr/bin/env node
/**
 * §10 A18 the distribution smoke test, run on Linux/WSL, macOS and Windows and on every supported Node
 * version (P17-05, P17-06).
 *
 * It starts the pinned ngmaze bin on a workspace, then runs the built ng-wiring over the same workspace
 * and requires a report that carries the pinned revision and edges ngmaze verified. Starting ngmaze
 * first separates the two failures: the adapter's process not starting on this system, and ng-wiring
 * not using what it returned.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateNgmaze, NGMAZE_REVISION } from '../dist/adapters/ng-maze/index.js';
import { linkTargetWorkspace } from '../test/fixtures/target.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const node = (args, options) => spawnSync(process.execPath, args,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false, ...options });

console.log(`ng-wiring distribution smoke test on ${process.platform}-${process.arch}, Node ${process.version}`);

const root = await mkdtemp(path.join(tmpdir(), 'ngwi-smoke-'));
try {
  await cp(path.join(repo, 'test/fixtures/minimal-app'), root, { recursive: true });
  await linkTargetWorkspace(root);

  const located = await locateNgmaze();
  console.log(`\n> ngmaze ${NGMAZE_REVISION}\n  ${located.binPath}`);
  const maze = node([located.binPath, '--project', root, '--angular-project', 'app', '--json'], { cwd: root });
  check(maze.status === 0, `the pinned ngmaze bin exited ${maze.status}: ${maze.stderr?.trim()}`);
  let document;
  try { document = JSON.parse(maze.stdout); } catch { check(false, 'the pinned ngmaze bin emitted no JSON'); }
  if (document) {
    check(document.ngmazeVersion === '0.1.0', `ngmaze reported version ${document.ngmazeVersion}`);
    check(document.error === null, `ngmaze reported ${JSON.stringify(document.error)}`);
    check(document.meta?.typescriptSource === 'project',
      `ngmaze used a ${document.meta?.typescriptSource} TypeScript instead of the workspace's own`);
    check(document.result?.components?.length > 0, 'ngmaze found no component in the fixture workspace');
  }

  const cli = path.join(repo, 'dist/cli/index.js');
  for (const [label, extra, extension] of [['markdown', ['--detail'], '.md'], ['json', ['--json'], '.json']]) {
    const outDir = path.join(root, `out-${label}`);
    console.log(`\n> ng-wiring (${label})`);
    const result = node([cli, 'data-id="targetInput"', '--project', 'app', '--candidate', '2',
      '--out-dir', outDir, ...extra], { cwd: root });
    // §3.3 code 5 is a partial report, which is a written file; only 0 and 5 write one.
    check(result.status === 0 || result.status === 5,
      `ng-wiring exited ${result.status}: ${result.stderr?.trim()}`);
    const written = await readdir(outDir).catch(() => []);
    check(written.length === 1 && written[0].endsWith(extension), `no ${label} report was written`);
    if (written.length !== 1) continue;
    check(result.stdout.trim() === path.join(outDir, written[0]),
      `stdout did not name the written file: ${result.stdout.trim()}`);
    const report = await readFile(path.join(outDir, written[0]), 'utf8');
    check(report.includes(NGMAZE_REVISION), `the ${label} report does not name the pinned ngmaze revision`);
    check(report.includes('ngmaze-verified'), `the ${label} report has no edge ngmaze verified`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  console.error('\nThe distribution smoke test failed:');
  for (const message of failures) console.error(`  ${message}`);
  process.exit(1);
}
console.log(`\nStarted the pinned ngmaze bin and wrote both reports on ${process.platform}, Node ${process.version}`);
