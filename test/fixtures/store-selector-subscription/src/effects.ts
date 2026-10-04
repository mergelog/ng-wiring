import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, switchMap } from 'rxjs';
import { loadResults, loadStatus } from './actions';
import { SearchApi } from './api';

@Injectable()
export class SearchEffects {
  private readonly actions = inject(Actions);
  private readonly api = inject(SearchApi);

  readonly load = createEffect(() => this.actions.pipe(
    ofType(loadResults),
    switchMap(() => this.api.search().pipe(map(() => ({ type: '[Search] Loaded' }))))
  ));

  readonly loadStatus = createEffect(() => this.actions.pipe(
    ofType(loadStatus),
    switchMap(() => this.api.status().pipe(map(() => ({ type: '[Search] Status loaded' }))))
  ));
}
