import type ts from 'typescript';
import type { AnalysisContext } from '../workspace/context.js';
import type { Span } from '../index/templates.js';
import { EvidenceTable } from '../model/evidence.js';
import type { Precision } from '../model/types.js';
/**
 * §5 the one place the assembly turns a source position into evidence. Template spans arrive already
 * mapped onto their TS or HTML file by the template index, so an inline template needs no extra table;
 * the `file:line:column` strings the operation layers record resolve to that line and are approximate.
 */
export declare class SourceEvidence {
    private readonly context;
    readonly table: EvidenceTable;
    private readonly texts;
    private readonly lineStarts;
    constructor(context: AnalysisContext);
    private read;
    private starts;
    span(span: Span | null | undefined, precision?: Precision, symbolId?: string | null): string | null;
    node(node: ts.Node, precision?: Precision, symbolId?: string | null): string | null;
    /**
     * The operation layers record `relative/path.ts:line:column`. Only that line is known, so the evidence
     * covers the line and is marked approximate rather than claiming a node-exact span.
     */
    location(text: string, symbolId?: string | null): string | null;
    /** Resolves `relative/path.ts:line:column` to a workspace-relative file and a UTF-16 offset. */
    offsetOf(text: string): {
        file: string;
        offset: number;
    } | null;
    /** Evidence for a whole class declaration, named by the symbol it declares. */
    declaration(node: ts.ClassDeclaration, symbolId: string): string | null;
}
