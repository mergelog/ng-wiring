import { Component, EffectRef, afterRenderEffect, computed, effect, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ClockService } from './clock.service';

@Component({
  selector: 'app-field',
  template: `
    <button data-id="commitButton" (click)="commit()">commit</button>
    <button data-id="stopButton" (click)="stop()">stop</button>
    <button data-id="bumpButton" (click)="bump()">bump</button>
    <span class="label">{{ label() }}</span>
    <span class="name">{{ name() }}</span>
    <span class="value">{{ value() }}</span>
    <span class="summary">{{ summary() }}</span>
    <span class="tick">{{ tick() }}</span>
    <span class="renders">{{ renders() }}</span>
  `,
})
export class FieldComponent {
  private readonly clock = inject(ClockService);
  /** Bound by the parent. */
  readonly label = input<string>('');
  readonly name = input.required<string>();
  /** Two-way: a write here goes back to the parent binding. */
  readonly value = model<string>('');
  readonly renders = signal(0);

  /** The read is conditional, so the dependency on `name` only exists while the branch is taken. */
  readonly summary = computed(() => this.value().length > 0 ? `${this.name()}=${this.value()}` : '');
  /** An Observable consumed as a Signal: the subscription starts on creation. */
  readonly tick = toSignal(this.clock.stream, { initialValue: 0 });
  /** A Signal exposed as an Observable: each notification follows change detection. */
  readonly value$ = toObservable(this.value);

  private readonly watcher: EffectRef = effect(() => {
    this.value();
  });

  constructor() {
    afterRenderEffect(() => {
      this.renders.set(this.renders() + 1);
    });
  }

  commit(): void {
    this.value.set('committed');
  }

  /** Writes the state the after-render effect tracks. */
  bump(): void {
    this.renders.set(0);
  }

  /** The effect is destroyed explicitly, which ends its lifetime. */
  stop(): void {
    this.watcher.destroy();
  }
}
