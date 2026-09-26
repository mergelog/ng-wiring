import { Component, inject } from '@angular/core';
import { Dispatcher, injectDispatch, toScope } from '@ngrx/signals/events';
import { gridEvents, rowSelected } from './events';
import { GridStore } from './grid.store';

@Component({
  selector: 'app-grid',
  providers: [GridStore],
  template: `
    <button data-id="pageButton" (click)="changePage()">page</button>
    <button data-id="parentButton" (click)="changePageInParent()">parent</button>
    <button data-id="globalButton" (click)="clearGlobally()">global</button>
    <button data-id="directButton" (click)="selectRow()">select</button>
    <button data-id="scopedButton" (click)="selectRowInParent()">scoped</button>
    <span class="page">{{ store.page() }}</span>
    <span class="selected">{{ store.selected() }}</span>
    <span class="noted">{{ store.noted() }}</span>
  `,
})
export class GridComponent {
  readonly store = inject(GridStore);
  private readonly dispatch = injectDispatch(gridEvents);
  private readonly dispatcher = inject(Dispatcher);

  /** self: the dispatcher this component injected. */
  changePage(): void {
    this.dispatch.pageChanged(2);
  }

  /** parent: the bus above the injected dispatcher. */
  changePageInParent(): void {
    injectDispatch(gridEvents)({ scope: 'parent' }).pageChanged(3);
  }

  /** global: the root bus. */
  clearGlobally(): void {
    injectDispatch(gridEvents)({ scope: 'global' }).filterCleared();
  }

  /** The direct entry point, with no named dispatcher in between. */
  selectRow(): void {
    this.dispatcher.dispatch(rowSelected({ id: 'row-1' }));
  }

  /** The same direct entry point, with an explicit scope configuration. */
  selectRowInParent(): void {
    this.dispatcher.dispatch(rowSelected({ id: 'row-2' }), toScope('parent'));
  }
}
