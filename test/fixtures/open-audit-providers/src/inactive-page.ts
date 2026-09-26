import {Component, inject} from '@angular/core';
import {Store} from '@ngrx/store';
import {increment} from './actions';

@Component({selector: 'inactive-page', template: '<button data-id="inactiveTarget" (click)="dispatch()">Increment</button>'})
export class InactivePage {
  private readonly store = inject(Store);

  dispatch() { this.store.dispatch(increment()); }
}
