import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { termChanged } from './actions';

/** A facade whose receiver and callee both resolve, so the dispatch inside it is still the dispatch. */
@Injectable({ providedIn: 'root' })
export class SearchFacade {
  private readonly store = inject(Store);

  changeTerm(term: string): void {
    this.store.dispatch(termChanged({ term }));
  }
}
