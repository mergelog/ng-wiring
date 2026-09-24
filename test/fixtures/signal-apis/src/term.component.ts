import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { TermService } from './term.service';

@Component({
  selector: 'app-term',
  template: `
    <input data-id="termField" (input)="onInput($event)">
    <button data-id="draftButton" (click)="stageDraft()">stage</button>
    <button data-id="silentButton" (click)="countSilently()">silent</button>
    <span class="upper">{{ upper() }}</span>
    <span class="draft">{{ draft() }}</span>
    <span class="shared">{{ service.currentTerm() }}</span>
    <span class="hits">{{ hits() }}</span>
  `,
})
export class TermComponent {
  readonly service = inject(TermService);
  readonly term = signal('');
  /** A custom comparison decides whether consumers re-run at all. */
  readonly upper = computed(() => this.term().toUpperCase(),
    { equal: (left: string, right: string) => left.length === right.length });
  /** Recomputed when its source changes, and replaceable by an explicit write. */
  readonly draft = linkedSignal(() => this.term());
  readonly hits = signal(0);

  constructor() {
    effect(onCleanup => {
      const value = this.term();
      onCleanup(() => value.length);
    });
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.term.set(value);
    this.service.setTerm(value);
  }

  stageDraft(): void {
    this.draft.set('staged');
  }

  /** The read inside untracked is no dependency, but the write it guards still happens. */
  countSilently(): void {
    const current = untracked(() => this.term());
    this.hits.set(current.length);
  }
}
