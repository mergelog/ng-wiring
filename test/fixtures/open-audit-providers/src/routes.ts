import {makeEnvironmentProviders} from '@angular/core';
import {Routes} from '@angular/router';
import {provideState} from '@ngrx/store';
import {ActivePage} from './active-page';
import {InactivePage} from './inactive-page';
import {featureReducers} from './reducers';

const sharedFeatureProviders = [provideState('feature', featureReducers)];
const activeRouteProviders = makeEnvironmentProviders([...sharedFeatureProviders]);

export const routes: Routes = [
  {path: 'active', component: ActivePage, providers: [activeRouteProviders]},
  {path: 'inactive', component: InactivePage},
];
