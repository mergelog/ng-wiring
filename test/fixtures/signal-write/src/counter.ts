import { Component, computed, signal } from '@angular/core';

/** P16-09 case 1: UI -> signal.set/update -> display, with no effect anywhere in the file. */
@Component({
  selector: 'app-counter',
  template: `
    <button data-id="incrementButton" (click)="increment()">+</button>
    <input data-id="countField" (input)="setCount($event)">
    <span class="count">{{ count() }}</span>
    <span class="doubled">{{ doubled() }}</span>
  `,
})
export class CounterComponent {
  readonly count = signal(0);
  readonly doubled = computed(() => this.count() * 2);

  increment(): void {
    this.count.update(value => value + 1);
  }

  setCount(event: Event): void {
    this.count.set(Number((event.target as HTMLInputElement).value));
  }
}
