import type { Catalog, Declaration } from '../../index/catalog.js';
export interface Scope {
    ids: Set<string>;
    complete: boolean;
    reasons: string[];
}
export declare class ScopeResolver {
    private readonly catalog;
    private readonly declaring;
    private readonly exportCache;
    private readonly activeExports;
    constructor(catalog: Catalog);
    scopeOf(component: Declaration): Scope;
    private exportsOf;
    private addRefs;
}
