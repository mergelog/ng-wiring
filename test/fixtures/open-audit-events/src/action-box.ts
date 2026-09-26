import {Component, output} from '@angular/core';

@Component({
  selector: 'action-box',
  template: `
    <div (click)="rowClick()">
      <button data-id="stopped" (click)="$event.stopPropagation(); openContext()">Open</button>
      <button data-id="bubbles" (click)="openContext()">Open with bubbling</button>
      <button data-id="conditional" (click)="canStop() && $event.stopPropagation(); openContext()">Conditional</button>
    </div>
  `,
})
export class ActionBox {
  selected = output<string>();

  openContext() {
    this.selected.emit('row');
  }

  rowClick() {}

  canStop() { return false; }
}
