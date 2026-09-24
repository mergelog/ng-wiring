#!/usr/bin/env node
/**
 * §9 the built `dist` ships with the repository, so CI has to prove it is the build of these sources.
 *
 * The check removes `dist`, rebuilds it from `src` and requires the tracked tree to come back
 * unchanged. Rebuilding from an emptied directory is what makes a stale output detectable: a file whose
 * source was deleted or renamed stays byte-identical in an incremental build and only disappears here
 * (P17-02).
 */
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    process.exit(1);
  }
  return result.stdout;
};

const tracked = git('ls-files', 'dist').split('\n').filter(Boolean);
if (!tracked.length) {
  console.error('dist is not tracked; the distribution would ship without a build');
  process.exit(1);
}

await rm(path.join(repo, 'dist'), { recursive: true, force: true });
// The compiler is the pinned devDependency, started directly so no shell or npm wrapper is involved.
const build = spawnSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'),
  '-p', path.join(repo, 'tsconfig.build.json')], { cwd: repo, encoding: 'utf8', stdio: 'inherit' });
if (build.status !== 0) {
  git('checkout', '--', 'dist');
  console.error('build failed; the committed dist was restored');
  process.exit(1);
}

const changed = git('status', '--porcelain', '--', 'dist').split('\n').filter(Boolean);
if (changed.length) {
  console.error('The committed dist is not the build of these sources:');
  for (const line of changed) console.error(`  ${line}`);
  console.error('Commit the rebuilt dist, which is now in the working tree.');
  process.exit(1);
}
console.log(`dist matches a clean rebuild of src (${tracked.length} tracked files)`);
