import type { StoreAction, StoreGraph } from '../../resolve/operation/store.js';
import type { DeliveryDetails, ReactiveStep } from './model.js';
import type { DeliveryResolution, EventDispatch, EventGraph } from './events.js';
/** Builds the event-bus half of the delivery model, keeping the bus instance and scope on every step. */
export declare function eventDeliverySteps(graph: EventGraph, dispatch: EventDispatch, resolution: DeliveryResolution): ReactiveStep[];
/** Builds the action-bus half. The bus instance is the root Store; a feature is a slice of it, not a bus. */
export declare function actionDeliverySteps(graph: StoreGraph, action: StoreAction, source: string, form?: DeliveryDetails['form'], conditions?: string[]): ReactiveStep[];
