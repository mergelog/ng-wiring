import { Component, inject } from '@angular/core';
import { ProductCatalogStore } from './catalog.store';

@Component({
  selector: 'app-catalog',
  providers: [ProductCatalogStore],
  template: `
    <button data-id="setTermButton" (click)="setTerm()">set</button>
    <button data-id="clearButton" (click)="clear()">clear</button>
    <button data-id="resetButton" (click)="reset()">reset</button>
    <span class="term">{{ store.term() }}</span>
    <span class="label">{{ store.label() }}</span>
    <span class="draft">{{ store.draft() }}</span>
    <span class="page">{{ store.pageSize }}</span>
  `,
})
export class CatalogComponent {
  readonly store = inject(ProductCatalogStore);

  setTerm(): void {
    this.store.setTerm('shoes');
  }

  clear(): void {
    this.store.clear();
  }

  reset(): void {
    this.store.reset();
  }
}
