import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
import type { Declaration } from '../../index/catalog.js';
export type ProviderKind = 'class' | 'existing' | 'value' | 'factory' | 'implicit';
export interface ProviderBinding {
    token: string;
    kind: ProviderKind;
    implementation: string | null;
    source: string;
    multi: boolean;
    status: 'resolved' | 'boundary';
    reason: string | null;
}
export interface InjectorLayer {
    id: string;
    kind: 'root' | 'route' | 'component' | 'view' | 'template';
    providers: ts.Expression[];
    host?: boolean;
    visibleToContent?: boolean;
}
export interface InjectionRequest {
    token: ts.Expression;
    optional?: boolean;
    self?: boolean;
    skipSelf?: boolean;
    host?: boolean;
    projected?: boolean;
    templateInjector?: InjectorLayer | null;
}
export interface InjectionResolution {
    token: string;
    bindings: ProviderBinding[];
    status: 'resolved' | 'boundary' | 'missing';
    reasons: string[];
    searched: string[];
}
export declare function tokenId(context: AnalysisContext, node: ts.Node): string;
/** Layers are ordered from the injection site outward. An explicit template injector is inserted at the site. */
export declare function resolveInjection(context: AnalysisContext, request: InjectionRequest, layers: InjectorLayer[]): InjectionResolution;
/** Reads the public Angular inject options or constructor parameter decorators. */
export declare function injectionRequestFor(context: AnalysisContext, node: ts.CallExpression | ts.ParameterDeclaration): InjectionRequest | null;
export declare function componentInjectorLayers(owner: Declaration, parents?: Declaration[], rootProviders?: ts.Expression[], routeProviders?: ts.Expression[]): InjectorLayer[];
