import { capabilities } from './capabilities.js';
const stepKinds = new Set(['call', 'state-read', 'state-write', 'reactive-link', 'effect',
    'action-dispatch', 'action-consume', 'event-dispatch', 'event-consume', 'boundary']);
/** Semantics that name a declaration rather than a step; they never become an effect node on their own. */
const declarationSemantics = new Set(['state-source', 'store-declaration', 'store-feature', 'action-creator',
    'event-creator', 'registration']);
export function semanticGroup(semanticId) { return semanticId.split(':')[0] ?? semanticId; }
/** Derives the graph kind from the registered semantic model instead of a per-call-site decision. */
export function stepKindFor(semanticId) {
    const group = semanticGroup(semanticId);
    if (declarationSemantics.has(group))
        return null;
    return stepKinds.has(group) ? group : null;
}
export function stepKindForCapability(capability) {
    return capability.semanticId ? stepKindFor(capability.semanticId) : null;
}
export function storeMemberStepKind(kind) {
    switch (kind) {
        case 'method': return 'call';
        case 'computed':
        case 'linked-state': return 'reactive-link';
        case 'state': return 'state-read';
        case 'handler': return 'event-consume';
        // A `withProps` member is a plain value and a hook is a lifetime condition, not a step of its own.
        case 'prop':
        case 'hook': return null;
    }
}
/** Every supported semantic model must be either a known step kind or an explicit declaration group. */
export function modelAudit() {
    const problems = [];
    for (const capability of capabilities()) {
        if (capability.support !== 'supported') {
            if (capability.semanticId)
                problems.push(`${capability.matcherId} is unsupported but carries a semantic model`);
            continue;
        }
        if (!capability.semanticId) {
            problems.push(`${capability.matcherId} has no semantic model`);
            continue;
        }
        const group = semanticGroup(capability.semanticId);
        if (!declarationSemantics.has(group) && !stepKinds.has(group))
            problems.push(`${capability.matcherId} uses unknown semantic group ${group}`);
    }
    return problems;
}
