import type ts from 'typescript';
import type { AnalysisContext } from '../../workspace/context.js';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'JSONP' | 'unknown';
export type HttpTransport = 'http-client' | 'fetch' | 'rxjs-fetch';
export interface UrlSegment {
    kind: 'literal' | 'expression';
    text: string;
}
/** A dynamic URL leaves only the URL unresolved; the method and the types keep their own confidence. */
export interface UrlResolution {
    status: 'static' | 'partial' | 'unresolved';
    text: string | null;
    segments: UrlSegment[];
    reason: string | null;
}
export type TypeRole = 'response' | 'request-body' | 'parameter' | 'url';
/** Only types that carried a value, an argument or a return at this call site are listed. */
export interface TypeUse {
    id: string;
    name: string;
    role: TypeRole;
    origin: 'type-argument' | 'declared' | 'inferred';
    source: string;
}
export interface HttpBranch {
    operator: string;
    location: string;
    effect: string;
}
export interface HttpRequestSite {
    id: string;
    transport: HttpTransport;
    method: HttpMethod;
    methodReason: string | null;
    url: UrlResolution;
    /** `body`, `response` or `events` when the option is statically readable. */
    observe: string | null;
    types: TypeUse[];
    owner: string | null;
    member: string | null;
    source: string;
    branches: HttpBranch[];
    conditions: string[];
    gaps: string[];
}
export interface HttpInterceptor {
    id: string;
    name: string;
    kind: 'function' | 'class';
    source: string | null;
}
export interface HttpEnvironment {
    registered: boolean;
    source: string | null;
    features: string[];
    interceptors: HttpInterceptor[];
    conditions: string[];
    gaps: string[];
}
export interface HttpCatalog {
    requests: HttpRequestSite[];
    environment: HttpEnvironment;
    diagnostics: string[];
}
export declare function httpBranchEffect(operator: string): string | null;
/** Names the export only when it really comes from rxjs, so a same-named local helper never matches. */
export declare function rxjsExport(context: AnalysisContext, node: ts.Node): string | null;
export declare function httpApiExport(context: AnalysisContext, node: ts.Node): string | null;
/** Keeps the static parts of a URL even when an interpolation or a variable cannot be resolved. */
export declare function resolveUrl(context: AnalysisContext, expression: ts.Expression | undefined): UrlResolution;
/** Collects the named types a value actually carried, including generic arguments; imports are never listed. */
export declare function collectTypes(context: AnalysisContext, type: ts.Type, role: TypeRole, origin: TypeUse['origin'], into: Map<string, TypeUse>, depth?: number): void;
/** Reads one `HttpClient` member call or one `fetch` call into a request site. */
export declare function requestSiteAt(context: AnalysisContext, call: ts.CallExpression): HttpRequestSite | null;
/** Registration of the client and of its interceptor chain; without it the HTTP boundary stays unknown. */
export declare function analyzeHttpEnvironment(context: AnalysisContext): HttpEnvironment;
/** Catalogs every request site in the context. Reaching one is decided by the caller, not by this listing. */
export declare function analyzeHttp(context: AnalysisContext): HttpCatalog;
