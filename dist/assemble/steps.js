import { detail, edgeContracts, unresolvedDetail } from '../model/types.js';
const end = (kind, id, label = id) => ({ kind, id, label });
const known = (value, reason) => value ? detail(value) : unresolvedDetail(reason);
/** §8 every required detail is present; one the layer did not report stays null with its reason. */
export function completeDetails(kind, provided) {
    const details = { ...provided };
    for (const key of edgeContracts[kind].details) {
        details[key] ??= unresolvedDetail(`${key} は解析層が記録していない`);
    }
    return details;
}
function traced(input) {
    return { ...input, details: completeDetails(input.kind, input.details) };
}
/** The live RxJS pipeline reached by Subject.next, including its operator sites and emitted values. */
export function operationTraceEdges(trace, ownerId, outputTypes, outputValues = new Map()) {
    const edges = [];
    let previous = null;
    for (const step of trace.steps) {
        const conditions = [...step.conditions];
        if (step.kind === 'subscription') {
            const source = end('state', `${ownerId}.${step.source}`, step.source);
            previous = end('symbol', `${ownerId}.${step.target}@${step.path.at(-1)}`, step.target);
            edges.push(traced({ kind: 'reactive-link', from: source, to: previous,
                location: step.path.at(-1) ?? step.location, conditions,
                capability: 'rxjs/subscribe', details: { source: detail(step.source),
                    consumer: detail(step.target), operator: detail('subscribe'), scheduling: detail('subscription') } }));
        }
        else if (step.kind === 'reactive-link') {
            const target = end('symbol', `${ownerId}.${step.target}@${step.location}`, step.target);
            const from = step.target !== 'timer' && previous
                ? previous : end('symbol', `${ownerId}.${step.source}`, step.source);
            edges.push(traced({ kind: 'reactive-link', from, to: target, location: step.location, conditions,
                capability: `rxjs/${step.target}`, details: { source: detail(step.source), consumer: detail(step.target),
                    operator: detail(step.target), scheduling: detail(step.timing) } }));
            if (step.target !== 'timer')
                previous = target;
        }
        else if (step.kind === 'output-emit') {
            edges.push(traced({ kind: 'output-emit',
                from: end('symbol', `${ownerId}.${step.source}`, step.source),
                to: end('event', `${ownerId}.${step.target}`, step.target), location: step.location, conditions,
                capability: 'angular/output', details: { output: detail(step.target),
                    valueExpression: known(outputValues.get(step.location) ?? step.detail, '送出値の式を確定できていない'),
                    declaredType: known(outputTypes.get(step.target), '宣言型を確定できていない') } }));
        }
    }
    return edges;
}
/** §7.4 the NgRx trace. Every step keeps the direction cause to receiver that §5 stores. */
export function storeTraceEdges(trace) {
    const edges = [];
    for (const step of trace.steps) {
        const common = { location: step.location, conditions: step.conditions, capability: null };
        switch (step.kind) {
            case 'call':
                edges.push(traced({ ...common, kind: 'call', from: end('symbol', step.source), to: end('symbol', step.target),
                    details: { caller: detail(step.source), callee: detail(step.target),
                        arguments: known(step.detail, '引数は trace に記録されていない') } }));
                break;
            case 'output-emit':
                edges.push(traced({ ...common, kind: 'output-emit', from: end('symbol', step.source), to: end('event', step.target),
                    details: { output: detail(step.target),
                        valueExpression: known(step.detail, '送出値の式は trace に記録されていない'),
                        declaredType: unresolvedDetail('宣言型は NgRx trace が記録していない') } }));
                break;
            case 'output-subscription':
                edges.push(traced({ ...common, kind: 'output-subscription', from: end('event', step.source),
                    to: end('symbol', step.target), details: { output: detail(step.source),
                        subscriber: detail(step.target) } }));
                break;
            case 'action-dispatch':
                edges.push(traced({ ...common, kind: 'action-dispatch', from: end('symbol', step.source), to: end('action', step.target),
                    details: { caller: detail(step.source), action: detail(step.target), busId: detail('root'),
                        dispatchMode: detail('explicit') } }));
                break;
            case 'action-consume':
                edges.push(traced({ ...common, kind: 'action-consume', from: end('action', step.source), to: end('symbol', step.target),
                    details: { action: detail(step.source), consumer: detail(step.target), busId: detail('root'),
                        registration: known(step.detail, '登録の根拠は trace に記録されていない') } }));
                break;
            case 'state-write':
                edges.push(traced({ ...common, kind: 'state-write', from: end('symbol', step.source), to: end('state', step.target),
                    details: { writer: detail(step.source), state: detail(step.target),
                        valueExpression: known(step.detail, '更新値の式は trace に記録されていない') } }));
                break;
            case 'state-read':
                edges.push(traced({ ...common, kind: 'state-read', from: end('state', step.source), to: end('symbol', step.target),
                    details: { reader: detail(step.target), state: detail(step.source),
                        tracking: known(step.detail, '追跡区別は NgRx trace が記録していない') } }));
                break;
            case 'reactive-link':
                edges.push(traced({ ...common, kind: 'reactive-link', from: end('symbol', step.source), to: end('symbol', step.target),
                    details: { source: detail(step.source), consumer: detail(step.target),
                        operator: known(step.detail, '演算子は trace に記録されていない'),
                        scheduling: unresolvedDetail('実行タイミングは NgRx trace が記録していない') } }));
                break;
            case 'boundary':
                edges.push(traced({ ...common, kind: 'boundary', from: end('symbol', step.source),
                    to: end('boundary', step.target, step.detail ?? step.target),
                    details: { reason: detail(step.detail ?? step.target), lastConfirmed: detail(step.source) } }));
                break;
        }
    }
    return edges;
}
/** §7.5 the HTTP trace. Request details come from the request site the step names. */
export function httpTraceEdges(trace) {
    const sites = new Map(trace.flows.map(flow => [flow.request.id, flow]));
    const edges = [];
    for (const step of trace.steps) {
        const common = { location: step.location, conditions: step.conditions, capability: null };
        const flow = sites.get(step.target) ?? sites.get(step.source);
        const request = flow?.request;
        switch (step.kind) {
            case 'call':
                edges.push(traced({ ...common, kind: 'call', from: end('symbol', step.source), to: end('symbol', step.target),
                    details: { caller: detail(step.source), callee: detail(step.target),
                        arguments: known(step.detail, '引数は trace に記録されていない') } }));
                break;
            case 'http-create':
                edges.push(traced({ ...common, kind: 'http-create', from: end('symbol', step.source), to: end('http', step.target),
                    details: { method: known(request?.method, 'HTTP メソッドを確定できていない'),
                        urlExpression: known(request?.url.text, 'URL 式を静的に確定できていない'),
                        requestType: known(request?.types.find(type => type.role === 'request-body')?.name, '要求型は未指定'),
                        responseType: known(request?.types.find(type => type.role === 'response')?.name, '応答型を確定できていない') } }));
                break;
            case 'http-consume':
                edges.push(traced({ ...common, kind: 'http-consume', from: end('http', step.source), to: end('symbol', step.target),
                    details: { request: detail(step.source), consumer: detail(step.target) } }));
                break;
            case 'type-use':
                edges.push(traced({ ...common, kind: 'type-use', from: end('http', step.source), to: end('type', step.target),
                    details: { value: detail(step.source), type: detail(step.target),
                        role: known(request?.types.find(type => type.id === step.target)?.role, '型の役割は trace に記録されていない') } }));
                break;
            case 'boundary':
                edges.push(traced({ ...common, kind: 'boundary', from: end('symbol', step.source),
                    to: end('boundary', step.target, step.detail ?? step.target),
                    details: { reason: detail(step.detail ?? step.target), lastConfirmed: detail(step.source) } }));
                break;
        }
    }
    return edges;
}
/** §7.6 the shared reactive step model: Signal, SignalStore and the two delivery buses. */
export function reactiveStepEdges(steps) {
    const edges = [];
    for (const step of steps) {
        const common = { location: step.location, conditions: step.conditions, capability: step.capability };
        const busId = step.delivery?.busId ?? null;
        const registration = step.delivery?.registration.join('; ') || null;
        switch (step.kind) {
            case 'call':
                edges.push(traced({ ...common, kind: 'call', from: end('symbol', step.source), to: end('symbol', step.target),
                    details: { caller: detail(step.source), callee: detail(step.target),
                        arguments: known(step.detail, '引数は記録されていない') } }));
                break;
            case 'state-write':
                edges.push(traced({ ...common, kind: 'state-write', from: end('symbol', step.source),
                    to: end('state', stateId(step), step.state?.key ?? step.target),
                    details: { writer: detail(step.source), state: detail(step.state?.key ?? step.target),
                        valueExpression: known(step.detail, '更新値の式は記録されていない') } }));
                break;
            case 'state-read':
                edges.push(traced({ ...common, kind: 'state-read', from: end('state', stateId(step), step.state?.key ?? step.source),
                    to: end('symbol', step.target),
                    details: { reader: detail(step.target), state: detail(step.state?.key ?? step.source),
                        tracking: known(step.tracking, '追跡区別を確定できていない') } }));
                break;
            case 'reactive-link':
                edges.push(traced({ ...common, kind: 'reactive-link', from: end('symbol', step.source), to: end('symbol', step.target),
                    details: { source: detail(step.source), consumer: detail(step.target),
                        operator: known(step.capability, '演算子または API を特定できていない'),
                        scheduling: known(step.effect?.phase, '実行タイミングを確定できていない') } }));
                break;
            case 'effect':
                edges.push(traced({ ...common, kind: 'reactive-link', from: end('state', step.source), to: end('effect', step.target),
                    details: { source: detail(step.source), consumer: detail(step.target),
                        operator: known(step.capability, 'effect API を特定できていない'),
                        scheduling: known(step.effect?.phase, 'effect の実行位相を確定できていない') } }));
                break;
            case 'action-dispatch':
                edges.push(traced({ ...common, kind: 'action-dispatch', from: end('symbol', step.source), to: end('action', step.target),
                    details: { caller: detail(step.source), action: detail(step.target),
                        busId: known(busId, 'bus インスタンスを確定できていない'),
                        dispatchMode: detail(dispatchMode(step)) } }));
                break;
            case 'action-consume':
                edges.push(traced({ ...common, kind: 'action-consume', from: end('action', step.source), to: end('symbol', step.target),
                    details: { action: detail(step.source), consumer: detail(step.target),
                        busId: known(busId, 'bus インスタンスを確定できていない'),
                        registration: known(registration ?? step.detail, '登録条件は記録されていない') } }));
                break;
            case 'event-dispatch':
                edges.push(traced({ ...common, kind: 'event-dispatch', from: end('symbol', step.source), to: end('event', step.target),
                    details: { caller: detail(step.source), event: detail(step.target),
                        busId: known(busId, 'bus インスタンスを確定できていない'),
                        scope: known(step.delivery?.scope, 'scope を確定できていない'),
                        dispatchMode: detail(dispatchMode(step)) } }));
                break;
            case 'event-consume':
                edges.push(traced({ ...common, kind: 'event-consume', from: end('event', step.source), to: end('symbol', step.target),
                    details: { event: detail(step.source), consumer: detail(step.target),
                        busId: known(busId, 'bus インスタンスを確定できていない'),
                        registration: known(registration ?? step.detail, '登録条件は記録されていない') } }));
                break;
            case 'boundary':
                edges.push(traced({ ...common, kind: 'boundary', from: end('symbol', step.source),
                    to: end('boundary', step.target, step.detail ?? step.target),
                    details: { reason: detail(step.detail ?? step.target), lastConfirmed: detail(step.source) } }));
                break;
        }
    }
    return edges;
}
/** A state node is identified by the declaration that owns it and the key that was touched. */
function stateId(step) {
    const state = step.state;
    if (!state)
        return step.kind === 'state-read' ? step.source : step.target;
    return [state.declaration, state.instance, state.key].filter(Boolean).join('.');
}
/** §8 `dispatchMode` keeps the four forms apart in both renderers. */
function dispatchMode(step) {
    switch (step.delivery?.form) {
        case 'reactive-registration': return 'reactive-factory';
        case 'named-event': return 'named-dispatcher';
        case 'handler-redelivery':
        case 'effect-return': return 'automatic-output';
        default: return 'explicit';
    }
}
