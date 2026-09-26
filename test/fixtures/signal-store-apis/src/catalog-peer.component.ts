import { Component, inject } from '@angular/core';
import { CatalogStore } from './catalog.store';

/** A separate provider of the same Store declaration must own independent state. */
@Component({
  selector: 'app-catalog-peer',
  providers: [CatalogStore],
  template: `
    <button data-id="peerSetTermButton" (click)="setTerm()">set peer</button>
    <span class="term">{{ store.term() }}</span>
  `,
})
export class CatalogPeerComponent {
  readonly store = inject(CatalogStore);

  setTerm(): void {
    this.store.setTerm('boots');
  }
}
