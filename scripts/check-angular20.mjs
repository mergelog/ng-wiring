#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const profiles = [
  { angular: '20.0.7', typescript: '5.8.3', ngrx: '20.0.0' },
  { angular: '20.3.33', typescript: '5.9.3', ngrx: '20.1.0' },
];
for (const profile of profiles) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-angular20-'));
  try {
    const dependencies = { typescript: profile.typescript, rxjs: '7.8.2' };
    for (const name of ['common', 'compiler', 'core', 'forms', 'platform-browser', 'router'])
      dependencies[`@angular/${name}`] = profile.angular;
    for (const name of ['store', 'effects', 'signals', 'operators']) dependencies[`@ngrx/${name}`] = profile.ngrx;
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies }, null, 2));
    console.log(`Angular ${profile.angular}, TypeScript ${profile.typescript}, NgRx ${profile.ngrx}, Node ${process.version}`);
    const installed = spawnSync(windows ? 'npm.cmd' : 'npm',
      ['install', '--engine-strict', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: windows });
    if (installed.error) throw installed.error;
    if (installed.status !== 0) throw new Error(`Toolchain installation exited ${installed.status}`);
    const tested = spawnSync(process.execPath, ['--test', 'test/angular20.integration.test.mjs'],
      { cwd: repo, stdio: 'inherit', env: { ...process.env, NGWI_ANGULAR20_ROOT: root } });
    if (tested.error) throw tested.error;
    if (tested.status !== 0) throw new Error(`Angular 20 integration tests exited ${tested.status}`);
  } finally { await rm(root, { recursive: true, force: true }); }
}
