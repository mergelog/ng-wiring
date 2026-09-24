import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-search',
  template: '<input data-id="searchInputField" (input)="onValueChange($event)"><span class="result">{{ value() }}</span>',
})
export class SearchComponent {
  readonly value = signal('');

  onValueChange(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
