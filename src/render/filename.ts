import { createHash } from 'node:crypto';
import { slash } from '../model/ids.js';
import type { QueryTarget } from '../model/types.js';
import { RenderError } from './text.js';

export const outputLockName = '.ng-wiring-output.lock';

export interface ProcessNameInput {
  target: QueryTarget;
  /** The class that owns the selected element; the file name and the heading both start from it. */
  ownerClass: string;
  /** `workspace relative TS path#ClassName` of that owner, used for the `--source` path hash. */
  ownerId: string;
  /** Tag name of the selected element, required for a `--source` target. */
  elementName?: string;
}

/** §3.4-1 the path hash of a `--source` name: the owning ComponentId and the source path. */
export function pathHash(ownerId: string, file: string): string {
  return createHash('sha256').update(`${slash(ownerId)}\n${slash(file)}`, 'utf8').digest('hex').slice(0, 12);
}

/**
 * §3.4-1 step 1. The file name keeps the attribute value without the outer syntactic quotes, while the
 * heading shows it quoted. Quotes inside the value are part of the value and stay in both.
 */
export function processName(input: ProcessNameInput): { raw: string; heading: string } {
  if (input.target.kind === 'attribute') {
    const { name, value } = input.target;
    return { raw: `${input.ownerClass}.${name}=${value}`, heading: `${input.ownerClass}.${name}="${value}"` };
  }
  if (!input.elementName) throw new RenderError('A --source file name needs the selected element name');
  const { file, line } = input.target;
  const raw = `${input.ownerClass}.${input.elementName}-L${line}-${pathHash(input.ownerId, file)}`;
  return { raw, heading: `${input.ownerClass}.${input.elementName}（${slash(file)}:${line}）` };
}

const keptInName = /[A-Za-z0-9_\-.=]/;
/**
 * §3.4-2 step 2. Only the string used for the file name is NFC normalized; the matching value and the
 * identifiers in the document are left as they were read.
 */
export function encodeName(raw: string): string {
  let encoded = '';
  for (const char of raw.normalize('NFC')) {
    if (keptInName.test(char)) { encoded += char; continue; }
    for (const byte of Buffer.from(char, 'utf8')) encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

export const nameLimit = 160;
export const nameKept = 140;

/** §3.4-3 step 3. Shortening never splits a `%HH` triple, and the original stays in the document. */
export function shortenName(encoded: string, raw: string): string {
  if (encoded.length <= nameLimit) return encoded;
  let taken = 0;
  while (taken < encoded.length) {
    const width = encoded[taken] === '%' ? 3 : 1;
    if (taken + width > nameKept) break;
    taken += width;
  }
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
  return `${encoded.slice(0, taken)}-h${digest}`;
}

/** §3.4-4 step 4. The local time the analysis started, as the fixed-width `YYMMDD.HHMMSS` stamp. */
export function timestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}.` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export interface FileNameInput { raw: string; startedAt: Date; json: boolean; collision?: number }

/** §3.4 `ngwi-{process name}-{YYMMDD.HHMMSS}.md`; step 5 adds `-c1`, `-c2`… on the process name side. */
export function buildFileName(input: FileNameInput): string {
  const shortened = shortenName(encodeName(input.raw), input.raw);
  const collision = input.collision && input.collision > 0 ? `-c${input.collision}` : '';
  return `ngwi-${shortened}${collision}-${timestamp(input.startedAt)}.${input.json ? 'json' : 'md'}`;
}

/** §3.4 the fixed-width stamp keeps the name decomposable even when the process name holds `-` or `.`. */
export const fileNamePattern = /^ngwi-(.+)-(\d{6}\.\d{6})\.(md|json)$/;
