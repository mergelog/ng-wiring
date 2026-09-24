import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { map, tap } from 'rxjs/operators';
import { panelOpened, searchRequested, searchSucceeded } from './actions';

@Injectable()
export class SearchEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);

  /** The returned action is dispatched automatically. */
  readonly runSearch$ = createEffect(() => this.actions$.pipe(
    ofType(searchRequested),
    map(({ term }) => searchSucceeded({ hits: term.length })),
  ));

  /** dispatch:false, and still an explicit dispatch inside the callback. */
  readonly auditSearch$ = createEffect(() => this.actions$.pipe(
    ofType(searchSucceeded),
    tap(() => this.store.dispatch(panelOpened())),
  ), { dispatch: false });
}

/** Registered through `provideEffects`, the standalone style. */
@Injectable()
export class AuditEffects {
  private readonly actions$ = inject(Actions);

  readonly recordOpen$ = createEffect(() => this.actions$.pipe(
    ofType(panelOpened),
    map(() => searchSucceeded({ hits: 0 })),
  ));
}

/** Never registered: it must not be treated as running. */
@Injectable()
export class OrphanEffects {
  private readonly actions$ = inject(Actions);

  readonly ignored$ = createEffect(() => this.actions$.pipe(
    ofType(searchRequested),
    map(() => searchSucceeded({ hits: -1 })),
  ));
}
