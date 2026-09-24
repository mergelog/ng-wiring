import { Component } from '@angular/core';

/** Declared but never used in a template: its display path has no confirmed root. */
@Component({ selector: 'app-unused', template: '<p data-id="unusedMarker">not displayed</p>' })
export class UnusedComponent {}
