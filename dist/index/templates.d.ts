import type { TmplAstNode, TmplAstElement, TmplAstTemplate } from '@angular/compiler';
import type { AnalysisContext } from '../workspace/context.js';
import type { Catalog, Declaration } from './catalog.js';
import type { MazeGraph, MazeEdge } from '../adapters/ng-maze/index.js';
export interface Span {
    file: string;
    start: number;
    end: number;
    line: number;
    endLine: number;
    column: number;
}
export interface IndexedElement {
    owner: Declaration;
    node: TmplAstElement | TmplAstTemplate;
    tag: string;
    span: Span;
    staticAttributes: Map<string, string>;
    boundAttributes: string[];
    boundExpressions: Map<string, string>;
    boundSpans: Map<string, Span>;
    events: string[];
    references: string[];
    repeated: boolean;
    parent: IndexedElement | null;
    fallbackSlot: IndexedSlot | null;
    component: string | null;
    directives: string[];
    appliedInputs: Map<string, string[]>;
    appliedOutputs: Map<string, string[]>;
    origin: 'ngmaze' | 'ng-wiring' | null;
    gaps: string[];
}
export interface IndexedSlot {
    owner: Declaration;
    node: TmplAstNode;
    selector: string;
    span: Span;
    parent: IndexedElement | null;
    order: number;
}
export interface TemplateIndex {
    elements: IndexedElement[];
    slots: IndexedSlot[];
    byOwner: Map<string, IndexedElement[]>;
    diagnostics: string[];
    verifiedMazeEdges: MazeEdge[];
    unmatchedMazeEdges: MazeEdge[];
}
export declare function indexTemplates(context: AnalysisContext, catalog: Catalog, maze?: MazeGraph): Promise<TemplateIndex>;
export declare function matchingElements(index: TemplateIndex, target: {
    kind: 'attribute';
    name: string;
    value: string;
} | {
    kind: 'source';
    file: string;
    line: number;
}): IndexedElement[];
