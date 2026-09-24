import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
export interface ExpressionReference {
    name: string;
    kind: 'local' | 'event' | 'pipe' | 'member' | 'reference' | 'unknown';
    origin: string;
    symbol: ts.Symbol | null;
    targetIds: string[];
    conditions: string[];
    diagnostics: string[];
}
export interface QueryResolution {
    member: string;
    kind: 'viewChild' | 'contentChild' | 'viewChildren' | 'contentChildren';
    targetIds: string[];
    read: string | null;
    occurrences: Span[];
    conditions: string[];
    diagnostics: string[];
}
export interface CallResolution {
    callee: string;
    receiver: ExpressionReference;
    symbol: ts.Symbol | null;
    target: string | null;
    status: 'resolved' | 'conditional' | 'unresolved';
    conditions: string[];
    diagnostics: string[];
}
export interface ExpressionResolution {
    references: ExpressionReference[];
    calls: CallResolution[];
    queries: QueryResolution[];
    diagnostics: string[];
}
export declare function resolveTemplateExpressions(element: IndexedElement, context: AnalysisContext, catalog: Catalog, index: TemplateIndex): ExpressionResolution;
