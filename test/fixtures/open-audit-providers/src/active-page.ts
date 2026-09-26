import {Component, inject} from '@angular/core';
import {Store} from '@ngrx/store';
import {increment} from './actions';

@Component({selector: 'active-page', template: '<button data-id="activeTarget" (click)="dispatch()">Increment</button>'})
export class ActivePage {
  private readonly store = inject(Store);

  dispatch() { this.store.dispatch(increment()); }
}
