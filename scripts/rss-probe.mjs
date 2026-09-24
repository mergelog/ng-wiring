/**
 * §2 both processes of a run are measured, not only ng-wiring. The probe is loaded through
 * `NODE_OPTIONS=--import`, which the ngmaze child inherits, so each process records its own lifetime,
 * CPU and peak resident set to one file as it exits (P17-07).
 */
import { appendFileSync } from 'node:fs';

const file = process.env.NGWI_MEASURE_FILE;
if (file) {
  process.on('exit', () => {
    const usage = process.resourceUsage();
    try {
      appendFileSync(file, `${JSON.stringify({
        script: process.argv[1] ?? '', pid: process.pid,
        elapsedMs: Math.round(performance.now()),
        userCpuMs: Math.round(usage.userCPUTime / 1000),
        systemCpuMs: Math.round(usage.systemCPUTime / 1000),
        maxRssKb: usage.maxRSS,
      })}\n`);
    } catch { /* a measurement must not change how the run ends */ }
  });
}
