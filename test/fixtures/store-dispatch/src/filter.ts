import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { termChanged } from './actions';
import { selectTerm } from './reducer';

@Component({
  selector: 'app-filter',
  template: `
    <input data-id="termField" (input)="onInput($event)">
    <span class="term">{{ term() }}</span>
  `,
})
export class FilterComponent {
  private readonly store = inject(Store);
  readonly term = this.store.selectSignal(selectTerm);

  onInput(event: Event): void {
    this.store.dispatch(termChanged({ term: (event.target as HTMLInputElement).value }));
  }
}
