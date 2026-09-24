import { signalStore, withMethods } from '@ngrx/signals';
import { withProjectSettingsStore } from './settings.feature';

export const ProjectSettingsStore = signalStore(
  withProjectSettingsStore,
  withMethods(() => ({
    checkPermissions(): boolean {
      return false;
    },
  })),
);
