/** §5 intermediate model. Both renderers read this normalized shape and nothing else. */
export const SCHEMA_VERSION = '1.0.0';
export const nodeKinds = ['application', 'component', 'directive', 'pipe', 'element',
    'template', 'route', 'listener', 'symbol', 'operation', 'state', 'action', 'event', 'event-bus', 'effect',
    'service', 'http', 'type', 'boundary'];
export const confidences = ['confirmed', 'conditional', 'unresolved'];
export const conditionPhases = ['lifecycle', 'defer', 'subscription', 'route-activation'];
export const dispatchModes = ['explicit', 'reactive-factory', 'named-dispatcher', 'automatic-output'];
export const pathEnds = ['root-unresolved', 'unrendered', 'projection-unresolved',
    'fragment-uninstantiated', 'dynamic-boundary', 'route-unresolved', 'bootstrap', 'cycle', 'limit'];
/** §5 coverage is partial when the path stopped before a root or was cut off; `unrendered` is a complete answer. */
export const partialPathEnds = ['root-unresolved', 'projection-unresolved',
    'fragment-uninstantiated', 'dynamic-boundary', 'route-unresolved', 'cycle', 'limit'];
export const detail = (value) => ({ value, unresolvedReason: null });
export const unresolvedDetail = (reason) => ({ value: null, unresolvedReason: reason });
const holder = ['component', 'directive', 'element', 'template', 'symbol', 'operation', 'listener', 'effect', 'service'];
const producer = ['symbol', 'operation', 'listener', 'effect', 'service', 'component', 'directive', 'state'];
/** §8 the closed relation table: required details plus the node kinds each end accepts. */
export const edgeContracts = {
    'template-use': { from: ['component'], to: ['component', 'directive', 'pipe', 'element', 'template'], details: ['owner', 'child', 'occurrence', 'location'] },
    'display-parent': { from: ['component', 'element', 'template', 'application'], to: ['component', 'element', 'template'], details: ['parent', 'child'] },
    projection: { from: ['component', 'element'], to: ['component', 'directive', 'element', 'template'], details: ['child', 'host', 'slot'] },
    'view-insertion': { from: ['template'], to: ['component', 'directive', 'element', 'template'], details: ['fragment', 'declarer', 'insertion'] },
    'route-load': { from: ['route'], to: ['route'], details: ['sourceRoute', 'targetRoute', 'loader'] },
    'route-outlet': { from: ['route'], to: ['component', 'element'], details: ['route', 'component', 'outlet'] },
    'route-redirect': { from: ['route'], to: ['route'], details: ['route', 'destination'] },
    bootstrap: { from: ['application'], to: ['component'], details: ['application', 'component'] },
    'dynamic-create': { from: ['component', 'directive', 'service', 'symbol', 'operation'], to: ['component', 'directive', 'template'], details: ['caller', 'component', 'container'] },
    'dom-listener': { from: ['element', 'component', 'directive'], to: ['listener'], details: ['event', 'selected', 'listener', 'handler'] },
    'event-propagation': { from: ['element', 'component'], to: ['element', 'component'], details: ['event', 'fromElement', 'toElement', 'phase'] },
    'input-binding': { from: ['component', 'element', 'template'], to: ['component', 'directive', 'symbol'], details: ['expression', 'owner', 'input'] },
    'output-subscription': { from: ['component', 'directive', 'element', 'symbol', 'event'], to: ['component', 'listener', 'symbol', 'operation'], details: ['output', 'subscriber'] },
    'output-emit': { from: producer, to: ['event', 'symbol'], details: ['output', 'valueExpression', 'declaredType'] },
    call: { from: producer, to: ['symbol', 'operation', 'service', 'effect'], details: ['caller', 'callee', 'arguments'] },
    'value-flow': { from: ['symbol', 'operation', 'state', 'http', 'event', 'action'], to: ['symbol', 'operation', 'state', 'http', 'element', 'component'], details: ['valueExpression', 'destination'] },
    'state-write': { from: producer, to: ['state'], details: ['writer', 'state', 'valueExpression'] },
    'state-read': { from: ['state'], to: holder, details: ['reader', 'state', 'tracking'] },
    'reactive-link': { from: ['state', 'symbol', 'operation', 'event', 'action', 'http'], to: ['symbol', 'operation', 'state', 'effect', 'component'], details: ['source', 'operator', 'consumer', 'scheduling'] },
    'query-target': { from: ['symbol'], to: ['component', 'directive', 'element', 'template'], details: ['query', 'target', 'scope'] },
    'di-resolve': { from: ['symbol', 'service', 'type'], to: ['service', 'symbol', 'component', 'directive'], details: ['token', 'implementation', 'provider'] },
    'action-dispatch': { from: producer, to: ['action', 'event-bus'], details: ['caller', 'action', 'busId', 'dispatchMode'] },
    'action-consume': { from: ['action', 'event-bus'], to: ['effect', 'state', 'symbol', 'operation', 'service'], details: ['action', 'consumer', 'busId', 'registration'] },
    'event-dispatch': { from: producer, to: ['event', 'event-bus'], details: ['caller', 'event', 'busId', 'scope', 'dispatchMode'] },
    'event-consume': { from: ['event', 'event-bus'], to: ['effect', 'state', 'symbol', 'operation', 'service'], details: ['event', 'consumer', 'busId', 'registration'] },
    'http-create': { from: ['symbol', 'operation', 'service', 'effect'], to: ['http'], details: ['method', 'urlExpression', 'requestType', 'responseType'] },
    'http-consume': { from: ['http'], to: ['symbol', 'operation', 'effect', 'state', 'component', 'service'], details: ['request', 'consumer'] },
    'type-use': { from: ['symbol', 'operation', 'state', 'http', 'action', 'event', 'component', 'service'], to: ['type'], details: ['value', 'type', 'role'] },
    boundary: { from: nodeKinds.filter(kind => kind !== 'boundary'), to: ['boundary'], details: ['reason', 'lastConfirmed'] },
};
export const edgeKinds = Object.keys(edgeContracts);
