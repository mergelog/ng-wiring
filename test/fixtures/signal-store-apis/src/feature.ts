import { computed } from '@angular/core';
import { signalStoreFeature, withComputed, withHooks, withLinkedState, withProps, withState } from '@ngrx/signals';

/** A reusable feature: every built-in kind of member in one place. */
export const withCatalogState = signalStoreFeature(
  withState({ term: '', hits: 0 }),
  withComputed(state => ({
    label: computed(() => `${state.term()}: ${state.hits()}`),
  })),
  withLinkedState(state => ({
    draft: () => state.term(),
  })),
  withProps(() => ({ pageSize: 20 })),
  withHooks({
    onInit: () => undefined,
    onDestroy: () => undefined,
  }),
);
