import {Routes} from '@angular/router';
import {AppComponent} from './app';
import {ExperimentInfoHyperParametersFormContainerComponent} from './container';
export const routes: Routes = [{path: '', component: AppComponent, children: [
  {path: 'tasks/:id/hyper-params', component: ExperimentInfoHyperParametersFormContainerComponent}
]}];
