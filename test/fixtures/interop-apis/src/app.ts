import { Component, signal } from '@angular/core';
import { FieldComponent } from './field.component';

@Component({
  selector: 'app-root',
  imports: [FieldComponent],
  template: `
    <app-field [label]="caption()" name="term" [(value)]="term"></app-field>
    <span class="parent">{{ term() }}</span>
  `,
})
export class AppComponent {
  readonly caption = signal('Search');
  readonly term = signal('');
}
