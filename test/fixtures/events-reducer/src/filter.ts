import { Component, inject } from '@angular/core';
import { injectDispatch } from '@ngrx/signals/events';
import { searchEvents } from './events';
import { SearchStore } from './store';

@Component({
  selector: 'app-filter',
  template: `
    <input data-id="termField" (input)="onInput($event)">
    <span class="term">{{ store.term() }}</span>
  `,
})
export class FilterComponent {
  readonly store = inject(SearchStore);
  private readonly dispatch = injectDispatch(searchEvents);

  onInput(event: Event): void {
    this.dispatch.termChanged((event.target as HTMLInputElement).value);
  }
}
