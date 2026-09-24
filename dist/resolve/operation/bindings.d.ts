import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span } from '../../index/templates.js';
export interface BindingRelation {
    kind: 'input-binding' | 'input-change' | 'output-subscription' | 'form-accessor';
    alias: string;
    member: string | null;
    targetId: string | null;
    expression: string;
    source: 'property' | 'attribute' | 'event' | 'two-way' | 'default' | 'form';
    span: Span | null;
    conditions: string[];
    diagnostics: string[];
}
export interface BindingResolution {
    relations: BindingRelation[];
    diagnostics: string[];
}
/** Resolves only inputs/outputs exposed at this exact template occurrence. */
export declare function resolveElementBindings(element: IndexedElement, context: AnalysisContext, catalog: Catalog): BindingResolution;
