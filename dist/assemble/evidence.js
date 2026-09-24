import path from 'node:path';
import { EvidenceTable } from '../model/evidence.js';
/**
 * §5 the one place the assembly turns a source position into evidence. Template spans arrive already
 * mapped onto their TS or HTML file by the template index, so an inline template needs no extra table;
 * the `file:line:column` strings the operation layers record resolve to that line and are approximate.
 */
export class SourceEvidence {
    context;
    table;
    texts = new Map();
    lineStarts = new Map();
    constructor(context) {
        this.context = context;
        this.table = new EvidenceTable({ workspaceRoot: context.workspaceRoot, read: file => this.read(file) });
    }
    read(file) {
        const absolute = path.resolve(this.context.workspaceRoot, file);
        if (this.texts.has(absolute))
            return this.texts.get(absolute);
        const source = this.context.program.getSourceFile(absolute);
        const text = source?.text ?? this.context.toolchain.typescript.sys.readFile(absolute);
        this.texts.set(absolute, text);
        return text;
    }
    starts(file, text) {
        const cached = this.lineStarts.get(file);
        if (cached)
            return cached;
        const starts = [0];
        for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1))
            starts.push(at + 1);
        this.lineStarts.set(file, starts);
        return starts;
    }
    span(span, precision = 'exact', symbolId = null) {
        if (!span)
            return null;
        return this.table.tryAdd({ file: span.file, start: span.start, end: span.end, precision, symbolId });
    }
    node(node, precision = 'exact', symbolId = null) {
        const file = node.getSourceFile();
        return this.table.tryAdd({ file: file.fileName, start: node.getStart(file), end: node.getEnd(), precision, symbolId });
    }
    /**
     * The operation layers record `relative/path.ts:line:column`. Only that line is known, so the evidence
     * covers the line and is marked approximate rather than claiming a node-exact span.
     */
    location(text, symbolId = null) {
        const match = /^(.+):(\d+):(\d+)$/.exec(text);
        if (!match)
            return null;
        const file = match[1];
        const body = this.read(file);
        if (body === undefined)
            return null;
        const starts = this.starts(file, body);
        const line = Number(match[2]) - 1;
        if (line < 0 || line >= starts.length)
            return null;
        const start = starts[line] + Number(match[3]) - 1;
        const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : body.length;
        const end = Math.max(start + 1, lineEnd);
        if (start < 0 || end > body.length)
            return null;
        return this.table.tryAdd({ file, start, end, precision: 'approximate', symbolId });
    }
    /** Resolves `relative/path.ts:line:column` to a workspace-relative file and a UTF-16 offset. */
    offsetOf(text) {
        const match = /^(.+):(\d+):(\d+)$/.exec(text);
        if (!match)
            return null;
        const file = match[1];
        const body = this.read(file);
        if (body === undefined)
            return null;
        const starts = this.starts(file, body);
        const line = Number(match[2]) - 1;
        if (line < 0 || line >= starts.length)
            return null;
        return { file, offset: starts[line] + Number(match[3]) - 1 };
    }
    /** Evidence for a whole class declaration, named by the symbol it declares. */
    declaration(node, symbolId) {
        return this.node(node.name ?? node, 'exact', symbolId);
    }
}
