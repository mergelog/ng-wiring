import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { catalogActions } from './actions';

@Component({ selector: 'app-catalog', templateUrl: './catalog.html' })
export class CatalogComponent {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} });

  constructor() {
    effect(() => {
      this.queryParams();
      this.store.dispatch(catalogActions.openList());
    });
  }

  apply() { this.store.dispatch(catalogActions.filterChanged()); }
  project() { this.store.dispatch(catalogActions.openProjectList()); }
}
