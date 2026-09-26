import {Component} from '@angular/core';
import {ActionBox} from './action-box';

@Component({
  selector: 'app-root',
  imports: [ActionBox],
  template: '<action-box (selected)="handleSelection($event)"></action-box>',
})
export class AppRoot {
  handleSelection(_value: string) {}
}
