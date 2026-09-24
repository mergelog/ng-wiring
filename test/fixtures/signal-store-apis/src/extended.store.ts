import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withFeature, withMethods, withState } from '@ngrx/signals';
import { withCatalogState } from './feature';

/** A generated Store reached through a class declaration rather than a variable. */
export class ExtendedCatalogStore extends signalStore(
  withCatalogState,
  // A deferred feature: it sees the members composed before it.
  withFeature(store => withComputed(() => ({
    shouted: computed(() => store.term().toUpperCase()),
  }))),
  withMethods(store => ({
    shout(term: string): void {
      patchState(store, { term });
    },
  })),
) {}

/** Provided but never injected: its hooks and members are not running. */
export const ProvidedOnlyStore = signalStore(
  withState({ idle: true }),
  withMethods(store => ({
    touch(): void {
      patchState(store, { idle: false });
    },
  })),
);
