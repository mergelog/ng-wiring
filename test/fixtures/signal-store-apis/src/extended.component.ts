import { Component, inject } from '@angular/core';
import { ExtendedCatalogStore, ProvidedOnlyStore } from './extended.store';

@Component({
  selector: 'app-extended',
  // Both are provided; only one is injected, so only one exists.
  providers: [ExtendedCatalogStore, ProvidedOnlyStore],
  template: `
    <button data-id="shoutButton" (click)="shout()">shout</button>
    <span class="term">{{ store.term() }}</span>
    <span class="shouted">{{ store.shouted() }}</span>
  `,
})
export class ExtendedComponent {
  readonly store = inject(ExtendedCatalogStore);

  shout(): void {
    this.store.shout('boots');
  }
}
