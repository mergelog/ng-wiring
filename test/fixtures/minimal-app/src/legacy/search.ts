import { Component } from '@angular/core';

/** Same class name and same attribute as `src/search.ts`, in another file and never displayed. */
@Component({ selector: 'app-legacy-search', template: '<input data-id="targetInput">' })
export class SearchComponent {}
