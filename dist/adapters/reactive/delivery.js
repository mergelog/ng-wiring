/** Builds the event-bus half of the delivery model, keeping the bus instance and scope on every step. */
export function eventDeliverySteps(graph, dispatch, resolution) {
    const delivery = (registration) => ({ bus: 'signal-store-event',
        busId: resolution.busId, form: dispatch.form, scope: dispatch.scope, registration });
    const steps = [{ kind: 'event-dispatch', source: dispatch.owner ?? dispatch.source,
            target: dispatch.creatorType ?? dispatch.creatorId ?? 'unresolved event', location: dispatch.source,
            conditions: resolution.conditions, capability: dispatch.form === 'named-event'
                ? 'signals-events/injectDispatch' : 'signals-events/Dispatcher.dispatch',
            detail: dispatch.reason, delivery: delivery(dispatch.conditions) }];
    if (dispatch.status === 'boundary' || resolution.status === 'boundary')
        for (const reason of [...(dispatch.reason ? [dispatch.reason] : []), ...resolution.reasons])
            steps.push({ kind: 'boundary', source: dispatch.creatorType ?? dispatch.source, target: resolution.busId,
                location: dispatch.source, conditions: resolution.conditions, capability: null, detail: reason });
    for (const consumer of resolution.consumers) {
        steps.push({ kind: 'event-consume', source: dispatch.creatorType ?? dispatch.creatorId ?? 'unresolved event',
            target: consumer.id, location: consumer.source, conditions: [...resolution.conditions, ...consumer.conditions],
            capability: consumer.kind === 'reducer' ? 'signals-events/withReducer' :
                consumer.kind === 'handler' ? 'signals-events/withEventHandlers' : 'signals-events/Events.on',
            detail: consumer.kind === 'reducer' ? 'ReducerEvents delivers before Events handlers' : null,
            delivery: delivery(consumer.conditions) });
        for (const key of consumer.writes)
            steps.push({ kind: 'state-write', source: consumer.id, target: key, location: consumer.source,
                conditions: [...resolution.conditions, ...consumer.conditions], capability: 'signals-events/withReducer',
                detail: 'the case reducer result replaces this state key',
                state: { framework: 'signal-store', declaration: consumer.storeId ?? consumer.id,
                    instance: consumer.owner, key } });
        for (const again of consumer.redelivers)
            steps.push({ kind: 'event-dispatch', source: consumer.id, target: again.creatorType ?? again.creatorId ?? 'unresolved event',
                location: again.source, conditions: [...resolution.conditions, ...consumer.conditions],
                capability: 'signals-events/withEventHandlers',
                detail: 'the handler output is a new event and is dispatched again',
                delivery: { bus: 'signal-store-event', busId: again.scope === 'global' ? 'root' : resolution.busId,
                    form: 'handler-redelivery', scope: again.scope, registration: consumer.conditions } });
        for (const gap of consumer.gaps)
            steps.push({ kind: 'boundary', source: consumer.id, target: gap, location: consumer.source,
                conditions: consumer.conditions, capability: null, detail: gap });
    }
    for (const bridge of graph.bridges.filter(item => resolution.consumers.some(consumer => consumer.id === item.fromConsumer)))
        steps.push({ kind: 'action-dispatch', source: bridge.fromConsumer, target: bridge.target,
            location: bridge.source, conditions: [...resolution.conditions, ...bridge.conditions],
            capability: 'ngrx-store/Store.dispatch', detail: 'an explicit bridge forwards the event to the NgRx action bus',
            delivery: { bus: 'ngrx-action', busId: 'root', form: 'action-instance', scope: 'root',
                registration: bridge.conditions } });
    return steps;
}
/** Builds the action-bus half. The bus instance is the root Store; a feature is a slice of it, not a bus. */
export function actionDeliverySteps(graph, action, source, form = 'action-instance', conditions = []) {
    const rootActive = graph.registrations.some(item => item.kind === 'root' && item.status === 'resolved');
    const registration = rootActive ? [] : ['root Store is not registered in the selected injector'];
    const delivery = (extra) => ({ bus: 'ngrx-action', busId: 'root', form,
        scope: 'root', registration: [...registration, ...extra] });
    const steps = [{ kind: 'action-dispatch', source, target: action.type ?? action.id,
            location: action.source, conditions, capability: form === 'observer-next' ? 'ngrx-store/Store.next' :
                form === 'effect-return' ? 'ngrx-effects/createEffect' : form === 'reactive-registration'
                    ? 'ngrx-store/Store.dispatch#thunk' : 'ngrx-store/Store.dispatch',
            detail: action.type ? null : 'the action type is not a static string', delivery: delivery([]) }];
    for (const reducer of graph.reducers.filter(item => item.actions.includes(action.id)))
        steps.push({ kind: 'action-consume', source: action.type ?? action.id, target: reducer.id,
            location: reducer.source, conditions: [...conditions, ...reducer.conditions],
            capability: 'ngrx-store/createReducer',
            detail: reducer.registered ? null : 'the reducer is not registered in the selected injector',
            delivery: delivery(reducer.registered ? [] : ['reducer registration was not confirmed']) });
    for (const effect of graph.effects.filter(item => item.listens.includes(action.id) ||
        (!!action.type && item.listens.includes(`type:${action.type}`))))
        steps.push({ kind: 'action-consume', source: action.type ?? action.id, target: effect.id,
            location: effect.source, conditions: [...conditions, ...effect.conditions],
            capability: 'ngrx-effects/createEffect',
            detail: effect.registered ? null : 'the effect is not registered in the selected injector',
            delivery: delivery(effect.registered ? [] : ['effect registration was not confirmed']) });
    return steps;
}
