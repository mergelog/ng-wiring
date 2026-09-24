import { Component } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';

@Component({
  selector: 'app-rx-resource',
  template: '<button data-id="rxResourceButton" (click)="reload()">reload</button>',
})
export class RxResourceComponent {
  private readonly data = rxResource({ stream: () => of('value') });

  reload(): void {
    this.data.reload();
  }
}
