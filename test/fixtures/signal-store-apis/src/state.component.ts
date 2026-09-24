import { Component, computed, signal } from '@angular/core';
import { deepComputed, getState, patchState, signalState, watchState } from '@ngrx/signals';

interface Filters { page: { index: number; size: number }; query: string }

@Component({
  selector: 'app-state',
  template: `
    <button data-id="pageButton" (click)="nextPage()">next</button>
    <button data-id="snapshotButton" (click)="snapshot()">snapshot</button>
    <button data-id="mutateButton" (click)="mutate()">mutate</button>
    <span class="index">{{ filters.page.index() }}</span>
    <span class="seen">{{ seen() }}</span>
  `,
})
export class StateComponent {
  /** A state source that is not a DI class. */
  readonly filters = signalState<Filters>({ page: { index: 0, size: 10 }, query: '' });
  readonly deep = deepComputed(() => this.filters.page());
  readonly seen = signal(0);
  readonly label = computed(() => this.filters.query());

  constructor() {
    watchState(this.filters, state => this.seen.set(state.page.index));
  }

  nextPage(): void {
    patchState(this.filters, state => ({ page: { ...state.page, index: state.page.index + 1 } }));
  }

  /** A snapshot read: it creates no dependency on one key. */
  snapshot(): void {
    const current = getState(this.filters);
    this.seen.set(current.page.size);
  }

  /** A deep mutation is not a notification and must not be read as a write. */
  mutate(): void {
    const current = getState(this.filters);
    current.page.index = 99;
  }
}
