import { Component } from '@angular/core';
import { CatalogComponent } from './catalog.component';
import { StateComponent } from './state.component';
import { MethodsComponent } from './methods.component';
import { ExtendedComponent } from './extended.component';
import { CatalogPeerComponent } from './catalog-peer.component';

@Component({
  selector: 'app-root',
  imports: [CatalogComponent, CatalogPeerComponent, StateComponent, MethodsComponent, ExtendedComponent],
  template: `
    <app-catalog></app-catalog>
    <app-catalog-peer></app-catalog-peer>
    <app-state></app-state>
    <app-methods></app-methods>
    <app-extended></app-extended>
  `,
})
export class AppComponent {}
