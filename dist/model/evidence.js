import { createHash } from 'node:crypto';
import path from 'node:path';
import { evidenceId, slash } from './ids.js';
export class ModelError extends Error {
}
/**
 * §5 evidence store. Offsets are UTF-16 code units over half-open ranges, lines and columns start at 1,
 * and an inline template is recorded against its TS file through the registered mapping table.
 */
export class EvidenceTable {
    input;
    byId = new Map();
    lineStarts = new Map();
    inline = new Map();
    constructor(input) {
        this.input = input;
    }
    /** Register where an inline template body lives inside its TS file; `virtualFile` is the template key. */
    registerInline(virtualFile, mapping) {
        this.inline.set(this.relative(virtualFile), { file: this.relative(mapping.file), segments: [...mapping.segments] });
    }
    /** Map a span onto the real source file, or null when the inline offsets cannot be converted (§3.1). */
    map(input) {
        const file = this.relative(input.file);
        const mapping = this.inline.get(file);
        if (!mapping)
            return { file, start: input.start, end: input.end };
        const segment = mapping.segments.find(item => input.start >= item.from && input.end <= item.to);
        if (!segment)
            return null;
        const shift = segment.sourceStart - segment.from;
        return { file: mapping.file, start: input.start + shift, end: input.end + shift };
    }
    add(input) {
        const result = this.tryAdd(input);
        if (!result)
            throw new ModelError(`Cannot place ${input.file} [${input.start}, ${input.end}) in a source file`);
        return result;
    }
    tryAdd(input) {
        const mapped = this.map(input);
        if (!mapped)
            return null;
        const text = this.input.read(mapped.file);
        if (text === undefined)
            return null;
        if (!Number.isSafeInteger(mapped.start) || !Number.isSafeInteger(mapped.end))
            return null;
        if (mapped.start < 0 || mapped.end > text.length || mapped.start >= mapped.end)
            return null;
        const starts = this.starts(mapped.file, text);
        const at = (offset) => {
            let low = 0, high = starts.length - 1;
            while (low < high) {
                const middle = (low + high + 1) >> 1;
                if (starts[middle] <= offset)
                    low = middle;
                else
                    high = middle - 1;
            }
            return { line: low + 1, column: offset - starts[low] + 1 };
        };
        const start = at(mapped.start), end = at(mapped.end);
        const body = {
            file: mapped.file, startOffset: mapped.start, endOffset: mapped.end,
            startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column,
            precision: input.precision ?? 'exact', symbolId: input.symbolId ?? null,
            contentHash: createHash('sha256').update(text.slice(mapped.start, mapped.end), 'utf8').digest('hex'),
        };
        const id = evidenceId(body);
        if (!this.byId.has(id))
            this.byId.set(id, { ...body, id });
        return id;
    }
    starts(file, text) {
        const cached = this.lineStarts.get(file);
        if (cached)
            return cached;
        const starts = [0];
        for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1))
            starts.push(index + 1);
        this.lineStarts.set(file, starts);
        return starts;
    }
    relative(file) {
        return slash(path.isAbsolute(file) ? path.relative(this.input.workspaceRoot, file) : file);
    }
    get(id) { return this.byId.get(id); }
    list() {
        return [...this.byId.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1
            : a.startOffset - b.startOffset || a.endOffset - b.endOffset || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
}
