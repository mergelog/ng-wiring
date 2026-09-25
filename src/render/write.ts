import { randomUUID } from 'node:crypto';
import { open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { outputLockName } from './filename.js';

/** §3.4-5 a lock held by another run is not removed; the CLI turns this into exit code 4. */
export class OutputLockError extends Error {}
export class OutputWriteError extends Error {}

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === code;

const sequencePattern = /^ngwi-(\d+)-/i;

export interface WriteOutputInput {
  directory: string;
  /** The Angular workspace root. Defaults to the output directory for direct callers. */
  sequenceRoot?: string;
  name: (sequence: number) => string;
  content: string;
  signal?: AbortSignal;
}

/**
 * Number allocation and creation are serialized through `.ng-wiring-output.lock` at the sequence root.
 * The completed report is renamed into place, so a same-name file is replaced only after writing succeeds.
 */
export async function writeOutput(input: WriteOutputInput): Promise<string> {
  const sequenceRoot = input.sequenceRoot ?? input.directory;
  const lockPath = path.join(sequenceRoot, outputLockName);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (isCode(error, 'EEXIST')) {
      throw new OutputLockError(`Another ng-wiring run holds ${lockPath}. Retry once it finishes.`);
    }
    throw error;
  }
  try {
    const rootEntries = await readdir(sequenceRoot, { withFileTypes: true });
    const outputEntries = sequenceRoot === input.directory ? rootEntries :
      await readdir(input.directory, { withFileTypes: true });
    let highest = 0;
    for (const entry of [...rootEntries, ...outputEntries]) {
      if (!entry.isFile()) continue;
      const match = sequencePattern.exec(entry.name);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isSafeInteger(value)) highest = Math.max(highest, value);
    }
    const sequence = highest + 1;
    if (!Number.isSafeInteger(sequence)) {
      throw new OutputWriteError(`No safe sequence number remains in ${sequenceRoot}`);
    }
    input.signal?.throwIfAborted();
    const target = path.join(input.directory, input.name(sequence));
    const temporary = path.join(input.directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(input.content, 'utf8');
      await handle.close();
      input.signal?.throwIfAborted();
      await rename(temporary, target);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return target;
  } finally {
    // §3.4-5 the lock this run created is released on success, on failure and on SIGINT alike.
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}
