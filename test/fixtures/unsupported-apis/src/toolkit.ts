/** Stands in for an external toolkit: the feature it returns is not one of the known @ngrx features. */
export const featuresFrom = (name: string): unknown[] => [name];
