import type ts from 'typescript';
import type { AnalysisContext } from '../workspace/context.js';
export type DeclarationKind = 'component' | 'directive' | 'pipe' | 'module';
export interface Declaration {
    id: string;
    kind: DeclarationKind;
    className: string;
    node: ts.ClassDeclaration;
    selector: string | null;
    standalone: boolean;
    metadata: ts.ObjectLiteralExpression;
    imports: string[];
    declarations: string[];
    exports: string[];
    hostDirectives: string[];
    hostDirectiveExposures: Map<string, {
        inputs: Map<string, string>;
        outputs: Map<string, string>;
    }>;
    inputs: Map<string, string>;
    outputs: Map<string, string>;
    template: {
        kind: 'inline' | 'external' | 'none';
        text: string;
        file: string;
        expression?: ts.StringLiteralLike;
    };
    gaps: string[];
}
export interface ExternalDeclaration {
    id: string;
    kind: DeclarationKind;
    selector: string | null;
    standalone: boolean;
    declarations: string[];
    imports: string[];
    exports: string[];
    inputs: Map<string, string>;
    outputs: Map<string, string>;
}
export interface Catalog {
    declarations: Map<string, Declaration>;
    external: Map<string, ExternalDeclaration>;
    byNode: Map<ts.ClassDeclaration, Declaration>;
    gaps: string[];
}
export declare function buildCatalog(context: AnalysisContext): Promise<Catalog>;
