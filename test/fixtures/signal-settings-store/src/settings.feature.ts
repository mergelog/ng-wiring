import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { forkJoin, lastValueFrom, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from './environment';
import { MetricsApiService, type MetricResult } from './metrics-api';

interface SettingsState {
  scalars: MetricResult[];
  workspaceId: string | null;
  readOnly: boolean;
}

const initialState: SettingsState = { scalars: [], workspaceId: null, readOnly: false };

/** §7.6 R15: withMethods -> lastValueFrom(forkJoin) -> patchState, behind an unidentified feature. */
export const withSettingsStore = signalStoreFeature(
  environment.storeDevToolsFeature('workspace-settings'),
  withState(initialState),
  withComputed(({ readOnly }) => ({
    isReadOnly: computed(() => readOnly()),
  })),
  withMethods((store, workspacesApi = inject(MetricsApiService)) => ({
    async loadScalars(): Promise<void> {
      const groupMetrics: Observable<MetricResult[]> = workspacesApi
        .getUniqueMetrics({ workspace: store.workspaceId(), include_subworkspaces: false })
        .pipe(map(response => response.metrics));
      const modelMetrics: Observable<MetricResult[]> = workspacesApi
        .getUniqueMetrics({ workspace: store.workspaceId(), include_subworkspaces: false,
          include_models: true })
        .pipe(map(response => response.metrics));
      const scalars = await lastValueFrom(forkJoin([groupMetrics, modelMetrics]));
      patchState(store, { scalars: scalars.flat() });
    },

    setWorkspace(workspaceId: string): void {
      patchState(store, () => ({ workspaceId }));
    },
  })),
);
