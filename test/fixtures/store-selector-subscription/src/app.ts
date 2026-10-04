import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { EMPTY, combineLatest, distinctUntilChanged, of, filter, switchMap } from 'rxjs';
import { changeOther, changeStatus, changeTerm, loadResults, loadStatus } from './actions';
import { selectStatus, selectTerm } from './state';

@Component({ selector: 'app-root', templateUrl: './app.html' })
export class AppComponent {
  private readonly store = inject(Store);
  private readonly statusChanges = this.store.select(selectStatus);

  constructor() {
    combineLatest([this.store.select(selectTerm), this.store.select(selectStatus), of(true)]).pipe(
      filter(([, status, ready]) => ready && status === 'ready'),
      switchMap(() => {
        this.store.dispatch(loadResults());
        return EMPTY;
      })
    ).subscribe();
  }

  ngOnInit() {
    this.statusChanges.pipe(
      distinctUntilChanged(),
      filter(status => status === 'ready')
    ).subscribe(() => this.store.dispatch(loadStatus()));
  }

  change() { this.store.dispatch(changeTerm({ term: 'new' })); }
  status() { this.store.dispatch(changeStatus()); }
  other() { this.store.dispatch(changeOther()); }
}
