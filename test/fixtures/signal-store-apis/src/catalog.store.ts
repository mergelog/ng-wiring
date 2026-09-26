import { inject } from '@angular/core';
import { patchState, signalStore, withMethods } from '@ngrx/signals';
import { CatalogApi } from './api';
import { withCatalogState } from './feature';

export const CatalogStore = signalStore(
  withCatalogState,
  withMethods((store, api = inject(CatalogApi)) => ({
    setTerm(term: string): void {
      patchState(store, { term });
    },
    setDraft(draft: string): void {
      patchState(store, { draft });
    },
    clear(): void {
      patchState(store, () => ({ term: '' }), () => ({ hits: 0 }));
    },
    reset(): void {
      patchState(store, { term: '', hits: 0 });
      void api;
    },
  })),
);

/** The same Store reached through another name; an alias must not make it a second Store. */
export { CatalogStore as ProductCatalogStore };
