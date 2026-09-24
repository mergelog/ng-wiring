import { Component } from '@angular/core';
import { CatalogComponent } from './catalog.component';
import { StateComponent } from './state.component';
import { MethodsComponent } from './methods.component';

@Component({
  selector: 'app-root',
  imports: [CatalogComponent, StateComponent, MethodsComponent],
  template: '<app-catalog></app-catalog><app-state></app-state><app-methods></app-methods>',
})
export class AppComponent {}
