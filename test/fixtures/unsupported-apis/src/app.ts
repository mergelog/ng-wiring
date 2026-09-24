import { Component } from '@angular/core';
import { EntitiesComponent } from './entities';
import { ResourceExtensionComponent } from './resource-extension';
import { ComponentStoreComponent } from './component-store';
import { AngularResourceComponent } from './angular-resource';
import { RxResourceComponent } from './rx-resource';
import { HttpResourceComponent } from './http-resource';
import { WithEffectsComponent } from './with-effects';
import { UnknownFeatureComponent } from './unknown-feature';

/** §7.6 R16: every child uses one range that has no semantic model in this version. */
@Component({
  selector: 'app-root',
  imports: [EntitiesComponent, ResourceExtensionComponent, ComponentStoreComponent, AngularResourceComponent,
    RxResourceComponent, HttpResourceComponent, WithEffectsComponent, UnknownFeatureComponent],
  template: `
    <app-entities></app-entities>
    <app-resource-extension></app-resource-extension>
    <app-component-store></app-component-store>
    <app-angular-resource></app-angular-resource>
    <app-rx-resource></app-rx-resource>
    <app-http-resource></app-http-resource>
    <app-with-effects></app-with-effects>
    <app-unknown-feature></app-unknown-feature>
  `,
})
export class AppComponent {}
