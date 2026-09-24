import { Component, signal } from '@angular/core';

/** The handler does not type-check. The analysis still runs and reports the error (§10, P16-14). */
@Component({
  selector: 'app-broken',
  template: `
    <input data-id="brokenField" (input)="onInput($event)">
    <span class="value">{{ value() }}</span>
  `,
})
export class BrokenComponent {
  readonly value = signal('');

  onInput(event: Event): void {
    this.value.set(event.target.value);
  }
}
