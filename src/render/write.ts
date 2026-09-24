import { open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { outputLockName } from './filename.js';

/** §3.4-5 a lock held by another run is not removed; the CLI turns this into exit code 4. */
export class OutputLockError extends Error {}
export class OutputWriteError extends Error {}

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === code;

const collisionAttempts = 1_000;

export interface WriteOutputInput {
  directory: string;
  /** Builds the name for attempt 0, 1, 2… so the collision suffix stays on the process name side. */
  name: (collision: number) => string;
  content: string;
  signal?: AbortSignal;
}

/**
 * §3.4-5 comparison and creation are serialized through `.ng-wiring-output.lock`, both the lock and the
 * report are created with `wx`, and an existing file is never overwritten. §3.4 the caller has already
 * verified the whole document, so a failure here only has to remove the incomplete file this run made.
 */
export async function writeOutput(input: WriteOutputInput): Promise<string> {
  const lockPath = path.join(input.directory, outputLockName);
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
    const existing = new Set((await readdir(input.directory)).map(entry => entry.toLowerCase()));
    for (let collision = 0; collision < collisionAttempts; collision++) {
      input.signal?.throwIfAborted();
      const name = input.name(collision);
      if (existing.has(name.toLowerCase())) continue;
      const target = path.join(input.directory, name);
      let handle;
      try {
        handle = await open(target, 'wx');
      } catch (error) {
        if (isCode(error, 'EEXIST')) continue;
        throw error;
      }
      try {
        await handle.writeFile(input.content, 'utf8');
      } catch (error) {
        await handle.close();
        await unlink(target).catch(() => undefined);
        throw error;
      }
      await handle.close();
      return target;
    }
    throw new OutputWriteError(`No free output name after ${collisionAttempts} collisions in ${input.directory}`);
  } finally {
    // §3.4-5 the lock this run created is released on success, on failure and on SIGINT alike.
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}
