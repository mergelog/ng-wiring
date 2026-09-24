import { createHash } from 'node:crypto';
import path from 'node:path';
import { evidenceId, slash } from './ids.js';
import type { Evidence, Precision } from './types.js';

/** §5 one inline template segment: template offsets `[from, to)` sit at `sourceStart` in the TS file. */
export interface InlineSegment { from: number; to: number; sourceStart: number }
export interface InlineMapping { file: string; segments: InlineSegment[] }
export interface EvidenceInput { file: string; start: number; end: number; precision?: Precision; symbolId?: string | null }

export class ModelError extends Error {}

/**
 * §5 evidence store. Offsets are UTF-16 code units over half-open ranges, lines and columns start at 1,
 * and an inline template is recorded against its TS file through the registered mapping table.
 */
export class EvidenceTable {
  private readonly byId = new Map<string, Evidence>();
  private readonly lineStarts = new Map<string, number[]>();
  private readonly inline = new Map<string, InlineMapping>();
  constructor(private readonly input: { workspaceRoot: string; read: (file: string) => string | undefined }) {}

  /** Register where an inline template body lives inside its TS file; `virtualFile` is the template key. */
  registerInline(virtualFile: string, mapping: InlineMapping): void {
    this.inline.set(this.relative(virtualFile), { file: this.relative(mapping.file), segments: [...mapping.segments] });
  }

  /** Map a span onto the real source file, or null when the inline offsets cannot be converted (§3.1). */
  map(input: EvidenceInput): { file: string; start: number; end: number } | null {
    const file = this.relative(input.file);
    const mapping = this.inline.get(file);
    if (!mapping) return { file, start: input.start, end: input.end };
    const segment = mapping.segments.find(item => input.start >= item.from && input.end <= item.to);
    if (!segment) return null;
    const shift = segment.sourceStart - segment.from;
    return { file: mapping.file, start: input.start + shift, end: input.end + shift };
  }

  add(input: EvidenceInput): string {
    const result = this.tryAdd(input);
    if (!result) throw new ModelError(`Cannot place ${input.file} [${input.start}, ${input.end}) in a source file`);
    return result;
  }

  tryAdd(input: EvidenceInput): string | null {
    const mapped = this.map(input);
    if (!mapped) return null;
    const text = this.input.read(mapped.file);
    if (text === undefined) return null;
    if (!Number.isSafeInteger(mapped.start) || !Number.isSafeInteger(mapped.end)) return null;
    if (mapped.start < 0 || mapped.end > text.length || mapped.start >= mapped.end) return null;
    const starts = this.starts(mapped.file, text);
    const at = (offset: number): { line: number; column: number } => {
      let low = 0, high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle]! <= offset) low = middle; else high = middle - 1;
      }
      return { line: low + 1, column: offset - starts[low]! + 1 };
    };
    const start = at(mapped.start), end = at(mapped.end);
    const body: Omit<Evidence, 'id'> = {
      file: mapped.file, startOffset: mapped.start, endOffset: mapped.end,
      startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
      precision: input.precision ?? 'exact', symbolId: input.symbolId ?? null,
      contentHash: createHash('sha256').update(text.slice(mapped.start, mapped.end), 'utf8').digest('hex'),
    };
    const id = evidenceId(body);
    if (!this.byId.has(id)) this.byId.set(id, { ...body, id });
    return id;
  }

  private starts(file: string, text: string): number[] {
    const cached = this.lineStarts.get(file);
    if (cached) return cached;
    const starts = [0];
    for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
    this.lineStarts.set(file, starts);
    return starts;
  }

  private relative(file: string): string {
    return slash(path.isAbsolute(file) ? path.relative(this.input.workspaceRoot, file) : file);
  }

  get(id: string): Evidence | undefined { return this.byId.get(id); }
  list(): Evidence[] {
    return [...this.byId.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1
      : a.startOffset - b.startOffset || a.endOffset - b.endOffset || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
