import { Component } from '@angular/core';
import { withValueOnError } from '@ngrx/signals/resource';

@Component({
  selector: 'app-resource-extension',
  template: '<button data-id="resourceExtensionButton" (click)="configure()">configure</button>',
})
export class ResourceExtensionComponent {
  private readonly extension = withValueOnError(() => 'fallback');

  configure(): void {
    this.extension.toString();
  }
}
