import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatMap, switchMap } from 'rxjs';
import { catalogActions } from './actions';
import { CatalogApi } from './api';

@Injectable()
export class CatalogEffects {
  private readonly actions = inject(Actions);
  private readonly router = inject(Router);
  private readonly api = inject(CatalogApi);

  readonly syncUrl = createEffect(() => this.actions.pipe(
    ofType(catalogActions.filterChanged),
    concatMap(() => this.router.navigate(['/catalog'], { queryParams: { q: 'term' } }))
  ), { dispatch: false });

  readonly loadList = createEffect(() => this.actions.pipe(
    ofType(catalogActions.openList),
    switchMap(() => this.api.search(''))
  ), { dispatch: false });

  readonly loadProjectList = createEffect(() => this.actions.pipe(
    ofType(catalogActions.openProjectList),
    switchMap(() => this.api.search('demo'))
  ), { dispatch: false });

  readonly unrelated = createEffect(() => this.actions.pipe(
    ofType(catalogActions.unrelated),
    switchMap(() => this.api.unrelated())
  ), { dispatch: false });
}
