import {Component} from '@angular/core';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
    <input data-id="form-bound" [ngModel]="value" (ngModelChange)="modelChanged($event)"
      (input)="inputChanged($event)" />
    <input data-id="plain-input" (input)="inputChanged($event)" />
  `,
})
export class AppRoot {
  value = '';
  lastModelValue = '';
  lastInputValue = '';

  modelChanged(value: string) { this.lastModelValue = value; }
  inputChanged(event: Event) { this.lastInputValue = (event.target as HTMLInputElement).value; }
}
