import { Component } from '@angular/core';
import { CounterComponent } from './counter';

@Component({ selector: 'app-root', imports: [CounterComponent], template: '<app-counter></app-counter>' })
export class AppComponent {}
