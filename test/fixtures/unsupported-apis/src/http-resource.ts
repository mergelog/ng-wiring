import { httpResource } from '@angular/common/http';
import { Component } from '@angular/core';

@Component({
  selector: 'app-http-resource',
  template: '<button data-id="httpResourceButton" (click)="reload()">reload</button>',
})
export class HttpResourceComponent {
  private readonly data = httpResource<string>(() => '/api/value');

  reload(): void {
    this.data.reload();
  }
}
