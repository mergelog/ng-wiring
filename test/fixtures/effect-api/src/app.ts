import { Component } from '@angular/core';
import { SearchComponent } from './search';

@Component({ selector: 'app-root', imports: [SearchComponent], template: '<app-search></app-search>' })
export class AppComponent {}
