import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  process.loadEnvFile(path.join(repo, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const configuredPath = process.env.NGWI_TEST_PROJECT_PATH;
const target = process.env.NGWI_TEST_TARGET;
const project = process.env.NGWI_TEST_PROJECT;
const candidate = process.env.NGWI_TEST_CANDIDATE;

test('configured Angular workspace can resolve a target candidate', {
  skip: !configuredPath || !target,
}, async () => {
  const workspace = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(repo, configuredPath);
  const outputDir = await mkdtemp(path.join(tmpdir(), 'ng-wiring-workspace-test-'));
  try {
    const args = [path.join(repo, 'dist/cli/index.js'), target, '--out-dir', outputDir];
    if (project) args.push('--project', project);
    if (candidate) args.push('--candidate', candidate);
    const result = spawnSync(process.execPath, args, {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    assert.equal(result.error, undefined, result.error?.message);
    if (!candidate) {
      assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
      assert.match(`${result.stdout}\n${result.stderr}`, /cand:/, 'the target query should return candidates');
    } else {
      assert([0, 5].includes(result.status), `${result.stderr}\n${result.stdout}`);
      assert((await readdir(outputDir)).some(name => name.endsWith('.md')),
        'the selected candidate should produce a Markdown report');
    }
  } finally {
    await rm(outputDir, {recursive: true, force: true});
  }
});
