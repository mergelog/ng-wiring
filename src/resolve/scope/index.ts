import type { Catalog, Declaration } from '../../index/catalog.js';

export interface Scope { ids: Set<string>; complete: boolean; reasons: string[] }
const empty = (): Scope => ({ ids: new Set(), complete: true, reasons: [] });

export class ScopeResolver {
  private readonly declaring = new Map<string, string[]>();
  private readonly exportCache = new Map<string, Scope>();
  private readonly activeExports = new Set<string>();
  constructor(private readonly catalog: Catalog) {
    for (const declaration of catalog.declarations.values()) {
      if (declaration.kind !== 'module') continue;
      for (const id of declaration.declarations) {
        const modules = this.declaring.get(id) ?? [];
        modules.push(declaration.id);
        this.declaring.set(id, modules);
      }
    }
  }

  scopeOf(component: Declaration): Scope {
    const result = empty();
    if (component.standalone) this.addRefs(component.imports, result);
    else {
      const modules = this.declaring.get(component.id) ?? [];
      if (!modules.length) { result.complete = false; result.reasons.push(`No NgModule declares ${component.id}`); }
      if (modules.length > 1) { result.complete = false; result.reasons.push(`Multiple NgModules declare ${component.id}`); }
      for (const id of modules) {
        const module = this.catalog.declarations.get(id);
        if (!module) continue;
        this.addRefs(module.declarations, result);
        this.addRefs(module.imports, result);
      }
    }
    if (component.gaps.some(gap => gap.startsWith('imports:'))) {
      result.complete = false;
      result.reasons.push(...component.gaps.filter(gap => gap.startsWith('imports:')));
    }
    return result;
  }

  private exportsOf(id: string): Scope {
    const cached = this.exportCache.get(id);
    if (cached) return cached;
    const result = empty();
    if (this.activeExports.has(id)) {
      result.complete = false;
      result.reasons.push(`NgModule export cycle at ${id}`);
      return result;
    }
    const declaration = this.catalog.declarations.get(id) ?? this.catalog.external.get(id);
    if (!declaration || declaration.kind !== 'module') return result;
    this.activeExports.add(id);
    try {
      this.addRefs(declaration.exports, result);
      const gaps = this.catalog.declarations.get(id)?.gaps ?? [];
      if (gaps.some(gap => gap.startsWith('exports:'))) {
        result.complete = false;
        result.reasons.push(...gaps.filter(gap => gap.startsWith('exports:')));
      }
    } finally { this.activeExports.delete(id); }
    this.exportCache.set(id, result);
    return result;
  }

  private addRefs(ids: string[], scope: Scope): void {
    for (const id of ids) {
      const declaration = this.catalog.declarations.get(id) ?? this.catalog.external.get(id);
      if (!declaration) {
        scope.complete = false;
        scope.reasons.push(`Uncatalogued declaration ${id}`);
        continue;
      }
      if (declaration.kind === 'module') {
        const exports = this.exportsOf(id);
        for (const exported of exports.ids) scope.ids.add(exported);
        if (!exports.complete) { scope.complete = false; scope.reasons.push(...exports.reasons); }
      } else scope.ids.add(id);
    }
  }
}
