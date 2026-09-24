import { Component, inject, signal } from '@angular/core';
import { SearchApi } from './api';

/** P16-10: one handler holds both routes — a direct state write and a write fed by a request. */
@Component({
  selector: 'app-search',
  template: `
    <input data-id="queryField" (input)="onInput($event)">
    <span class="term">{{ term() }}</span>
    <span class="results">{{ results().length }}</span>
  `,
})
export class SearchComponent {
  private readonly api = inject(SearchApi);
  readonly term = signal('');
  readonly results = signal<string[]>([]);

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.term.set(value);
    this.api.search(value).subscribe(items => this.results.set(items));
  }
}
