import { Component, resource } from '@angular/core';

@Component({
  selector: 'app-angular-resource',
  template: '<button data-id="angularResourceButton" (click)="reload()">reload</button>',
})
export class AngularResourceComponent {
  private readonly data = resource({ loader: () => Promise.resolve('value') });

  reload(): void {
    this.data.reload();
  }
}
