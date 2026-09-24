import { Component, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { auditEvents, searchRequested, termChanged } from './actions';
import { SearchFacade } from './facade';
import { selectHits, selectOpened, selectTerm } from './reducer';

@Component({
  selector: 'app-search-panel',
  template: `
    <button data-id="facadeButton" (click)="viaFacade()">facade</button>
    <button data-id="objectButton" (click)="viaObject()">object</button>
    <button data-id="thunkButton" (click)="viaThunk()">thunk</button>
    <button data-id="nextButton" (click)="viaNext()">next</button>
    <button data-id="subjectButton" (click)="viaSubject()">subject</button>
    <button data-id="effectButton" (click)="runSearch()">run</button>
    <button data-id="groupButton" (click)="openPanel()">open</button>
    <span class="term">{{ term() }}</span>
    <span class="hits">{{ hits() }}</span>
    <span class="opened">{{ opened() }}</span>
  `,
})
export class SearchPanelComponent {
  private readonly store = inject(Store);
  private readonly facade = inject(SearchFacade);
  private readonly local = new Subject<string>();
  readonly draft = signal('');
  readonly term = this.store.selectSignal(selectTerm);
  readonly hits = this.store.selectSignal(selectHits);
  readonly opened = this.store.selectSignal(selectOpened);
  /** The Observable form of the same read, with a live subscription. */
  private readonly watching = this.store.select(selectTerm).subscribe(value => this.draft.set(value));

  viaFacade(): void {
    this.facade.changeTerm('facade');
  }

  /** An action object with no creator call. */
  viaObject(): void {
    this.store.dispatch({ type: '[Search] term changed', term: 'object' });
  }

  /** The registration-shaped overload: it re-dispatches when the signals it reads change. */
  viaThunk(): void {
    this.store.dispatch(() => termChanged({ term: this.draft() }));
  }

  viaNext(): void {
    this.store.next(termChanged({ term: 'next' }));
  }

  /** A plain Subject: `next` here is not a Store dispatch. */
  viaSubject(): void {
    this.local.next('local');
  }

  runSearch(): void {
    this.store.dispatch(searchRequested({ term: 'run' }));
  }

  openPanel(): void {
    this.store.dispatch(auditEvents.panelClosed({ reason: 'done' }));
  }
}
