import { Component, inject } from '@angular/core';
import { signalStore, withState } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';

export const ItemStore = signalStore(withState({ ready: false }), withEntities<{ id: string }>());

@Component({
  selector: 'app-entities',
  providers: [ItemStore],
  template: '<button data-id="entitiesButton" (click)="show()">show</button>',
})
export class EntitiesComponent {
  private readonly store = inject(ItemStore);

  show(): void {
    this.store.entities();
  }
}
