import { inject } from '@angular/core';
import { patchState, signalMethod, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { CatalogApi } from './api';

export const MethodsStore = signalStore(
  withState({ hits: 0, last: '' }),
  withMethods((store, api = inject(CatalogApi)) => ({
    /** Takes a value, a Signal or an Observable; the API result writes the state. */
    load: rxMethod<string>(pipe(
      switchMap((term: string) => api.search(term)),
      tap((hits: number) => patchState(store, { hits })),
    )),
    /** Takes a value or a Signal; it has no Observable form. */
    remember: signalMethod<string>(value => patchState(store, { last: value })),
    /** Defined and never called. */
    unused: rxMethod<string>(tap(() => patchState(store, { hits: -1 }))),
  })),
);
