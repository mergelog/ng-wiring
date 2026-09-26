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
    eventHandlers: string[];
    eventStops: {
        event: string;
        definite: boolean;
    }[];
    eventSpans: (Span | null)[];
    references: string[];
    lexical: Map<string, LexicalBinding>;
    repeated: boolean;
    parent: IndexedElement | null;
    fallbackSlot: IndexedSlot | null;
    component: string | null;
    directives: string[];
    appliedInputs: Map<string, string[]>;
    appliedOutputs: Map<string, string[]>;
    origin: 'ngmaze' | 'ng-wiring' | null;
    gaps: string[];
    controlFlow: ControlFlowFrame[];
}
export interface LexicalBinding {
    kind: 'let' | 'loop' | 'fragment' | 'reference';
    value: string;
    element: IndexedElement | null;
}
export interface IndexedSlot {
    owner: Declaration;
    node: TmplAstNode;
    selector: string;
    span: Span;
    parent: IndexedElement | null;
    order: number;
}
export type DeferPhase = 'main' | 'placeholder' | 'loading' | 'error';
export type DeferTriggerGroup = 'trigger' | 'prefetch' | 'hydrate';
export interface DeferTrigger {
    group: DeferTriggerGroup;
    kind: string;
    detail: string | null;
    text: string;
}
export interface DeferInfo {
    id: string;
    triggers: DeferTrigger[];
    placeholderMinimumMs: number | null;
    loadingAfterMs: number | null;
    loadingMinimumMs: number | null;
}
export type ControlFlowKind = 'if' | 'for' | 'for-empty' | 'switch' | 'defer';
/** One enclosing control-flow branch. Outer frames combine with inner frames by AND (§6.3). */
export interface ControlFlowFrame {
    kind: ControlFlowKind;
    id: string;
    label: string;
    condition: string;
    notes: string[];
    span: Span | null;
    phase: DeferPhase | null;
    repeated: boolean;
    alias: string | null;
    defer: DeferInfo | null;
}
export interface IndexedLet {
    owner: Declaration;
    name: string;
    value: string;
    span: Span | null;
}
export interface UnsupportedRegion {
    ownerId: string;
    kind: string;
    reason: string;
    span: Span | null;
}
export interface TemplateIndex {
    elements: IndexedElement[];
    slots: IndexedSlot[];
    byOwner: Map<string, IndexedElement[]>;
    diagnostics: string[];
    verifiedMazeEdges: MazeEdge[];
    unmatchedMazeEdges: MazeEdge[];
    lets: IndexedLet[];
    unsupported: UnsupportedRegion[];
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
