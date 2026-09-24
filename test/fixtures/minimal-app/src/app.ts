import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<main class="shell"><router-outlet></router-outlet></main>',
})
export class AppComponent {}
