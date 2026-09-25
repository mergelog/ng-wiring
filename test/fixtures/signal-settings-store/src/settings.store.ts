import { signalStore, withMethods } from '@ngrx/signals';
import { withSettingsStore } from './settings.feature';

export const SettingsStore = signalStore(
  withSettingsStore,
  withMethods(() => ({
    checkPermissions(): boolean {
      return false;
    },
  })),
);
