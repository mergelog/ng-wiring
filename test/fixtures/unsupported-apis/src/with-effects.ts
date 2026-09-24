import { Component, inject } from '@angular/core';
import { signalStore, withState } from '@ngrx/signals';
// The published docs still show this name; it is not exported by this version of the package.
import { withEffects } from '@ngrx/signals/events';

export const LegacyStore = signalStore(withState({ ready: false }), withEffects());

@Component({
  selector: 'app-with-effects',
  providers: [LegacyStore],
  template: '<button data-id="withEffectsButton" (click)="run()">run</button>',
})
export class WithEffectsComponent {
  private readonly store = inject(LegacyStore);

  run(): void {
    this.store.runEffects();
  }
}
