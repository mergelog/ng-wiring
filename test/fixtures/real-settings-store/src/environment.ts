import { signalStoreFeature, withProps } from '@ngrx/signals';

/**
 * Stands for the build-time environment object of the real application. The feature it returns is
 * produced by a call this analysis cannot identify, so it is a boundary rather than a transparent one.
 */
export const environment = {
  storeDevToolsFeature: (name: string) => signalStoreFeature(withProps(() => ({ devtools: name }))),
};
