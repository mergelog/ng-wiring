import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

/** P16-09 case 2: the Store method writes with patchState; nothing subscribes to an effect. */
export const FilterStore = signalStore(
  withState({ term: '' }),
  withMethods(store => ({
    setTerm(term: string): void {
      patchState(store, { term });
    },
  })),
);
