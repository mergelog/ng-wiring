import { Component, inject } from '@angular/core';
import { FilterStore } from './store';

@Component({
  selector: 'app-filter',
  providers: [FilterStore],
  template: `
    <input data-id="filterField" (input)="onInput($event)">
    <span class="term">{{ store.term() }}</span>
  `,
})
export class FilterComponent {
  readonly store = inject(FilterStore);

  onInput(event: Event): void {
    this.store.setTerm((event.target as HTMLInputElement).value);
  }
}
