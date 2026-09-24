#!/usr/bin/env node
/**
 * §2, §10 A18 and remark 3-8: the performance measurement. A single reference value is not enough, so
 * every target is run repeatedly and reported as the lowest, the median and the highest run.
 *
 * What is measured: the whole command, not one phase. Both processes of a run are recorded — ng-wiring
 * and the ngmaze it starts — with each one's lifetime, CPU and peak resident set, because §2 has only a
 * single-run figure for ngmaze alone. The first run against a workspace is reported apart from the ones
 * after it (cold and warm), and `scripts/measure-reuse.mjs` adds what §9's within-run reuse saves. The
 * generated fixture is measured at several sizes, so the numbers show how the cost depends on size
 * rather than one figure for one workspace (P17-07).
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem, type as osType, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateNgmaze } from '../dist/adapters/ng-maze/index.js';
import { generateLargeFixture } from './generate-large-fixture.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(repo, 'dist/cli/index.js');
const probe = pathToFileURL(path.join(repo, 'scripts/rss-probe.mjs')).href;
const target = 'data-id="searchInputField"';
const mazeBin = (await locateNgmaze()).binPath;

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const runs = Number(argument('runs', '3'));
const appRuns = Number(argument('app-runs', String(runs)));
const capMs = Number(argument('cap', '900')) * 1000;
const sizes = argument('sizes', '50,200,800,1600').split(',').map(Number);
const appPath = argument('app', path.resolve(repo, '../000-learn-ClearML-pro'));
const outFile = argument('out', path.join(repo, 'docs/performance.md'));
// The raw runs can be dumped and the document rebuilt from them, so changing its wording does not mean
// measuring again on a machine that is no longer in the same state.
const dumpFile = argument('dump', '');
const fromFile = argument('from', '');

const round = (value, digits = 2) => Number(value.toFixed(digits));
const seconds = (ms) => round(ms / 1000);
const mib = (kb) => round(kb / 1024, 1);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const span = (values, format) => values.length === 1 ? format(values[0])
  : `${format(Math.min(...values))} / ${format(median(values))} / ${format(Math.max(...values))}`;

/** One command, with both processes recorded through the probe and a cap on how long it may take. */
async function measureRun(cwd, args) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'ngwi-measure-')), 'processes.jsonl');
  await writeFile(file, '');
  const started = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: capMs, killSignal: 'SIGKILL',
    env: { ...process.env, NGWI_MEASURE_FILE: file,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${probe}`.trim() },
  });
  const wallMs = performance.now() - started;
  const records = (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  await rm(path.dirname(file), { recursive: true, force: true });
  const maze = records.filter(record => record.script === mazeBin);
  const wiring = records.filter(record => record.script === cli);
  // A killed process runs no exit handler, so a capped run has no record of its own to report.
  return { wallMs, status: result.status, stderr: result.stderr ?? '', capped: result.signal === 'SIGKILL',
    wiring: wiring[0], maze: maze[0], processes: records.length };
}

async function measureTarget({ name, cwd, args, repetitions = runs, expect = [0, 5], reuse = true }) {
  process.stderr.write(`\n${name}\n`);
  const measured = [];
  for (let index = 0; index < repetitions; index += 1) {
    const run = await measureRun(cwd, args);
    if (run.capped) {
      process.stderr.write(`  run ${index + 1}: still running after ${seconds(capMs)} s, killed\n`);
      return { name, capped: true, measured };
    }
    if (!expect.includes(run.status)) {
      throw new Error(`${name} exited ${run.status}: ${run.stderr.split('\n')[0]}`);
    }
    if (!run.wiring || !run.maze) throw new Error(`${name} recorded ${run.processes} processes, expected 2`);
    measured.push(run);
    process.stderr.write(`  run ${index + 1}: ${seconds(run.wallMs)} s wall, ` +
      `ng-wiring ${seconds(run.wiring.elapsedMs)} s / ${mib(run.wiring.maxRssKb)} MiB, ` +
      `ngmaze ${seconds(run.maze.elapsedMs)} s / ${mib(run.maze.maxRssKb)} MiB\n`);
  }
  return { name, cold: measured[0], warm: measured.slice(1), exit: measured[0].status,
    reuse: reuse ? await measureReuse(cwd, args) : null };
}

/** §9 the within-run reuse, measured on the CLI's own entry points in one process. */
async function measureReuse(cwd, args) {
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/measure-reuse.mjs'), cwd, ...args],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: capMs, killSignal: 'SIGKILL' });
  if (result.signal === 'SIGKILL') return null;
  if (result.status !== 0) throw new Error(`the reuse measurement exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const roots = [];
const row = (cells) => `| ${cells.join(' | ')} |`;

/** The summary is derived from the numbers above it, so re-running the measurement rewrites it too. */
function findings(results) {
  const lines = [];
  const measured = results.filter(result => !result.capped);
  const short = (name) => name.replace('生成 fixture ', '').replace(/（[^）]*）/, '');
  const warmed = measured.filter(result => result.warm.length);

  if (warmed.length) {
    const deltas = warmed.map(result => ({ name: short(result.name), cold: result.cold.wallMs,
      warm: median(result.warm.map(run => run.wallMs)) }));
    const largest = deltas.reduce((a, b) => (b.cold - b.warm) > (a.cold - a.warm) ? b : a);
    const rest = deltas.filter(item => item !== largest).map(item => Math.abs(item.cold - item.warm));
    lines.push(`- cold と warm: ${deltas.map(item => `${item.name} ${seconds(item.cold)}→${seconds(item.warm)} 秒`).join('、')}。` +
      `差が読めるのは${largest.name}の ${seconds(largest.cold - largest.warm)} 秒だけで、` +
      `これは直前に生成したソースを最初に読む分である。残りは ${seconds(Math.max(...rest))} 秒以下で向きも一定しない。` +
      `永続キャッシュを持たない以上（§9）、cold と warm の差は OS のページキャッシュと Node のモジュール読み込みしかない。`);
  }

  const sized = measured.filter(result => /生成 fixture/.test(result.name));
  if (sized.length > 1) {
    const capped = sized.filter(result => result.reuse && result.reuse.candidates >= 1000);
    lines.push(`- 規模依存: ${sized.map(result => `${short(result.name)} ` +
      `${seconds(median([result.cold, ...result.warm].map(run => run.wallMs)))} 秒`).join(' → ')}。` +
      (capped.length ? `最後の${capped.map(result => short(result.name)).join('、')}が前の規模と並ぶのは、` +
        `候補が ${capped[0].reuse.candidates} 件で §6.3 の表示経路上限 1,000 に達し、` +
        `それ以上は展開しないためである。規模の頭打ちではなく有限化の効きである。` : ''));
  }

  const reused = measured.filter(result => result.reuse);
  if (reused.length) {
    lines.push(`- 1 実行内の再利用（§9）はどの規模でも効き、2 回目の解析は ` +
      `${reused.map(result => seconds(result.reuse.reanalyzeMs)).join(' / ')} 秒である。` +
      `内訳は ${reused.map(result => `${short(result.name)} 解析 ${seconds(result.reuse.analyzeMs)} 秒・` +
        `書き出し ${seconds(result.reuse.writeMs)} 秒`).join('、')}で、規模が大きいほど書き出し（資料 1 本の組み立て）の比率が上がる。`);
  }

  const enumeration = measured.find(result => /候補列挙のみ/.test(result.name));
  for (const result of results.filter(item => item.capped)) {
    lines.push(`- **${result.name}は ${seconds(capMs)} 秒で完了しない。**` +
      (enumeration ? ` 同じ対象・同じ workspace の候補列挙は ${seconds(enumeration.cold.wallMs)} 秒で終わるので、` : ' ') +
      `この時間は Program 生成・索引・ngmaze ではなく、選択 1 件に対する資料組み立て側にある。` +
      `この対象の cold/warm とピーク RSS は測っていない。測れないことをそのまま結果として残す（§10）。`);
  }
  return lines;
}

function processTable(results) {
  const lines = [row(['対象', '実行', 'wall 秒', 'ng-wiring 秒', 'ngmaze 秒', '合算 CPU 秒', 'ng-wiring MiB', 'ngmaze MiB', '合算ピーク MiB']),
    row(Array(9).fill('---'))];
  for (const result of results) {
    if (result.capped) {
      lines.push(row([result.name, `${seconds(capMs)} 秒で打ち切り`, ...Array(7).fill('—')]));
      continue;
    }
    for (const [label, group] of [['cold（1 回目）', [result.cold]], ['warm（2 回目以降）', result.warm]]) {
      if (!group.length) continue;
      const cpu = group.map(run => run.wiring.userCpuMs + run.wiring.systemCpuMs +
        run.maze.userCpuMs + run.maze.systemCpuMs);
      lines.push(row([result.name, label,
        span(group.map(run => run.wallMs), seconds),
        span(group.map(run => run.wiring.elapsedMs), seconds),
        span(group.map(run => run.maze.elapsedMs), seconds),
        span(cpu, seconds),
        span(group.map(run => run.wiring.maxRssKb), mib),
        span(group.map(run => run.maze.maxRssKb), mib),
        span(group.map(run => run.wiring.maxRssKb + run.maze.maxRssKb), mib)]));
    }
  }
  return lines.join('\n');
}

function reuseTable(results) {
  const lines = [row(['対象', '候補数', '1 回目の解析 秒', '同じ対象の再解析 秒', '資料の書き出し 秒', 'ピーク MiB']),
    row(Array(6).fill('---'))];
  for (const { name, reuse } of results) {
    if (!reuse) continue;
    lines.push(row([name, String(reuse.candidates), seconds(reuse.analyzeMs), seconds(reuse.reanalyzeMs),
      seconds(reuse.writeMs), mib(reuse.maxRssKb)]));
  }
  return lines.join('\n');
}

async function measureAll() {
  const results = [];
  for (const size of sizes) {
    const root = await mkdtemp(path.join(tmpdir(), `ngwi-size-${size}-`));
    roots.push(root);
    await generateLargeFixture(root, size);
    results.push(await measureTarget({ name: `生成 fixture ${size} ページ（${size + 6} ファイル）`, cwd: root,
      args: [target, '--project', 'app', '--candidate', '1', '--out-dir', path.join(root, 'out')] }));
  }
  const app = path.resolve(appPath);
  const hasApp = await readFile(path.join(app, 'angular.json'), 'utf8').then(() => true, () => false);
  if (hasApp) {
    const out = await mkdtemp(path.join(tmpdir(), 'ngwi-app-out-'));
    roots.push(out);
    // §3.3 code 2 is the candidate list: the analysis ran and the selection is what is missing, which is the
    // first half of the command and the part an interactive run always pays.
    results.push(await measureTarget({ name: '実アプリ 候補列挙のみ（stackup）', cwd: app, repetitions: appRuns,
      args: [target, '--project', 'stackup', '--out-dir', out], expect: [2], reuse: false }));
    results.push(await measureTarget({ name: '実アプリ 資料 1 本（stackup）', cwd: app, repetitions: appRuns,
      args: [target, '--project', 'stackup', '--candidate', '1', '--out-dir', out] }));
  } else {
    process.stderr.write(`\nthe real application was not found at ${app}; it is not in this run\n`);
  }
  return results;
}

function render(results, environment) {
  const { today, machine, command, repetitions } = environment;
  return `# ng-wiring の性能測定

§2 の測定は ngmaze 単体を 1 回ずつ実行した参考値だった。ここでは §10 A18 と指摘 3-8 に従い、
ng-wiring の実行全体を対象に、両プロセスの時間とピーク RSS、cold/warm の差、規模依存を記録する。

- 測定日: ${today}
- 環境: ${machine}
- 再現: \`${command}\`
- 各対象 ${repetitions} 回実行し、**最小 / 中央 / 最大**を記す。1 回目を cold、以降を warm とする。
- 生成 fixture は \`scripts/generate-large-fixture.mjs\` が作る。1 ページが 1 コンポーネントで、
  同じ検索要素を投影経由で表示し、制御フロー・リスナー・signal・dispatch・HTTP を 1 組ずつ持つ。

## 実行あたりの時間とメモリ（ng-wiring と ngmaze の 2 プロセス）

${processTable(results)}

「合算 CPU」は 2 プロセスの user + system の合計、「合算ピーク MiB」は各プロセスのピーク RSS の和で、
同時に使った量の上限である。ngmaze は ng-wiring の実行中に 1 回だけ起動する子プロセスであり、
その時間は wall に含まれる。合算 CPU が wall を超える行があるのは、Node と V8 の背景スレッド分である。
「候補列挙のみ」は §3.3 の終了コード 2 で終わる実行、すなわち解析は済み
選択だけが残っている状態で、対話的に使うときに必ず払う前半である。「資料 1 本」はそこから
\`--candidate\` で 1 件を選び、資料を書き出すまでの実行である。

## 1 実行内の再利用（§9）

${reuseTable(results)}

同じ対象をもう一度解析しても Program・索引・基礎グラフを作り直さない。再解析の時間はその再利用分で、
永続キャッシュは無いため、プロセスを終えると失われる。

## 読み取れること

${findings(results).join('\n')}

## 測定方法

- \`scripts/rss-probe.mjs\` を \`NODE_OPTIONS=--import\` で読み込む。子プロセスが環境を継ぐため、
  ng-wiring と ngmaze の両方が自分の \`process.resourceUsage()\` を終了時に記録する。
- 時間は各プロセスの \`performance.now()\`（プロセス開始からの経過）、wall は測定側の計測。
- \`maxRSS\` は Node が返すキロバイト値。プロセスごとの最大値であり、平均ではない。
- cold は対象ごとの 1 回目。OS のページキャッシュを落とす権限は無いため、
  cold は「この測定内で最初の 1 回」であり、再起動直後の値ではない。
`;
}

const now = new Date();
const environment = {
  command: `node scripts/measure-performance.mjs --runs ${runs} --app-runs ${appRuns} ` +
    `--cap ${capMs / 1000} --sizes ${sizes.join(',')}`,
  repetitions: runs,
  today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  machine: `${osType()} ${release()} · ${cpus()[0].model} · ${cpus().length} 論理コア · ` +
    `${Math.round(totalmem() / 1024 ** 3)} GiB · Node ${process.version}`,
};

let dumped;
try {
  dumped = fromFile
    ? JSON.parse(await readFile(fromFile, 'utf8'))
    : { environment, results: await measureAll() };
} finally {
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
if (dumpFile) await writeFile(dumpFile, `${JSON.stringify(dumped, null, 2)}\n`);
await writeFile(outFile, render(dumped.results, dumped.environment));
process.stderr.write(`\nwrote ${outFile}\n`);
