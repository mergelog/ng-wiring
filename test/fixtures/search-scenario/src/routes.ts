import {Routes} from '@angular/router';
import {AppComponent} from './app';
import {SearchFormComponent} from './container';
export const routes: Routes = [{path: '', component: AppComponent, children: [
  {path: 'search', component: SearchFormComponent}
]}];
