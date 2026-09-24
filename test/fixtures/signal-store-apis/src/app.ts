import { Component } from '@angular/core';
import { CatalogComponent } from './catalog.component';
import { StateComponent } from './state.component';
import { MethodsComponent } from './methods.component';
import { ExtendedComponent } from './extended.component';

@Component({
  selector: 'app-root',
  imports: [CatalogComponent, StateComponent, MethodsComponent, ExtendedComponent],
  template: `
    <app-catalog></app-catalog>
    <app-state></app-state>
    <app-methods></app-methods>
    <app-extended></app-extended>
  `,
})
export class AppComponent {}
