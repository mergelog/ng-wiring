import { Component, inject } from '@angular/core';
import { signalStore, withState } from '@ngrx/signals';
import { featuresFrom } from './toolkit';

/** A feature this version cannot identify may add or replace members, so it is not transparent. */
export const ToolkitStore = signalStore(
  withState({ term: '' }),
  ...(featuresFrom('search') as never[]),
);

@Component({
  selector: 'app-unknown-feature',
  providers: [ToolkitStore],
  template: '<button data-id="unknownFeatureButton" (click)="reset()">reset</button>',
})
export class UnknownFeatureComponent {
  private readonly store = inject(ToolkitStore);

  reset(): void {
    this.store.resetTerm();
  }
}
