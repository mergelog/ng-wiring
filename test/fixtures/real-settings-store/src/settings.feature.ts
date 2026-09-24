import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { forkJoin, lastValueFrom, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from './environment';
import { ApiProjectsService, type MetricVariantResult } from './projects-api';

interface ProjectSettingsState {
  scalars: MetricVariantResult[];
  projectId: string | null;
  readOnly: boolean;
}

const initialState: ProjectSettingsState = { scalars: [], projectId: null, readOnly: false };

/** §7.6 R15: withMethods -> lastValueFrom(forkJoin) -> patchState, behind an unidentified feature. */
export const withProjectSettingsStore = signalStoreFeature(
  environment.storeDevToolsFeature('project-settings'),
  withState(initialState),
  withComputed(({ readOnly }) => ({
    isReadOnly: computed(() => readOnly()),
  })),
  withMethods((store, projectsApi = inject(ApiProjectsService)) => ({
    async loadScalars(): Promise<void> {
      const experimentsMetrics: Observable<MetricVariantResult[]> = projectsApi
        .projectsGetUniqueMetricVariants({ project: store.projectId(), include_subprojects: false })
        .pipe(map(response => response.metrics));
      const modelsMetrics: Observable<MetricVariantResult[]> = projectsApi
        .projectsGetUniqueMetricVariants({ project: store.projectId(), include_subprojects: false,
          model_metrics: true })
        .pipe(map(response => response.metrics));
      const scalars = await lastValueFrom(forkJoin([experimentsMetrics, modelsMetrics]));
      patchState(store, { scalars: scalars.flat() });
    },

    setProject(projectId: string): void {
      patchState(store, () => ({ projectId }));
    },
  })),
);
