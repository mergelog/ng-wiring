import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { MazeGraph } from '../../adapters/ng-maze/index.js';
export type ViewRelation = 'element' | 'component-use' | 'projection-slot' | 'fragment-declaration' | 'template-insertion' | 'structural-view' | 'dynamic-creation';
export interface ViewStep {
    number: string;
    relation: ViewRelation;
    ownerId: string;
    label: string;
    span: Span | null;
    displayParent: boolean;
    declarationOwnerId: string;
    expressionOwnerId: string;
    diOwnerId: string;
    diContextOverride: string | null;
    displayCondition: string | null;
    creationCondition: string | null;
    insertionContext: string | null;
}
export interface ViewPath {
    steps: ViewStep[];
    declarationRefs: {
        ownerId: string;
        span: Span | null;
    }[];
    end: 'root-unresolved' | 'unrendered' | 'projection-unresolved' | 'fragment-uninstantiated' | 'dynamic-boundary' | 'cycle' | 'limit';
    reason: string;
}
export interface ViewResolution {
    paths: ViewPath[];
    diagnostics: string[];
}
export declare function resolveViewPaths(target: IndexedElement, context: AnalysisContext, catalog: Catalog, index: TemplateIndex, limit?: number, maze?: MazeGraph): ViewResolution;
