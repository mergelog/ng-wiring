import { signalStoreFeature, withProps } from '@ngrx/signals';

/**
 * Stands for a build-time environment object. The feature it returns is
 * produced by a call this analysis cannot identify, so it is a boundary rather than a transparent one.
 */
export const environment = {
  storeDevToolsFeature: (name: string) => signalStoreFeature(withProps(() => ({ devtools: name }))),
};
