import { Component, inject } from '@angular/core';
// Not installed in this workspace: the import is unresolved and the range has no semantic model.
import { ComponentStore } from '@ngrx/component-store';

@Component({
  selector: 'app-component-store',
  template: '<button data-id="componentStoreButton" (click)="update()">update</button>',
})
export class ComponentStoreComponent {
  private readonly store = inject(ComponentStore);

  update(): void {
    this.store.setState({ ready: true });
  }
}
