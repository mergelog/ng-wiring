import { slash } from './ids.js';
const relationRank = { unrelated: 0, 'global-unknown': 1, related: 2 };
/** Two reports of the same gap keep the closest association either of them showed (§8). */
export function strongestRelation(relations) {
    let strongest = 'unrelated';
    for (const relation of relations)
        if (relationRank[relation] > relationRank[strongest])
            strongest = relation;
    return strongest;
}
/** Node ids are accepted where a symbol id is expected, so `def:` prefixes do not defeat the match. */
const ownerKey = (value) => {
    const id = slash(value).trim();
    return id.startsWith('def:') ? id.slice('def:'.length) : id;
};
const fileKey = (value) => {
    let file = slash(value).trim();
    while (file.startsWith('./'))
        file = file.slice(2);
    return file;
};
/** `a.ts#C` and `a.ts#C.onInput` name the same owner; `a.ts#CD` is a different one. */
function sameOwner(left, right) {
    const a = ownerKey(left), b = ownerKey(right);
    return a !== '' && b !== '' && (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`));
}
const samePath = (left, right) => {
    const a = fileKey(left), b = fileKey(right);
    return a !== '' && a === b;
};
function applies(item, owner, file) {
    const scopedOwner = item.owner ? item.owner : null;
    const scopedFile = item.file ? item.file : null;
    if (!scopedOwner && !scopedFile)
        return true;
    if (scopedOwner && owner && sameOwner(owner, scopedOwner))
        return true;
    return !!scopedFile && !!file && samePath(file, scopedFile);
}
/**
 * §8 place one gap against the selection. The owner alone never decides it: an unrelated owner still
 * becomes a local gap through its candidates or its location, an owner-less gap is placed the same way,
 * and a gap whose candidate omission cannot be ruled out is promoted instead of being filed as unrelated.
 */
export function placeGap(gap, scope) {
    const owner = gap.owner ?? null;
    const file = gap.file ?? null;
    const inSelection = (id) => {
        const owned = scope.owners.find(item => sameOwner(id, item));
        if (owned !== undefined)
            return { hit: owned, part: 'explored path' };
        const target = scope.targets.find(item => sameOwner(id, item));
        return target === undefined ? null : { hit: target, part: 'selected target' };
    };
    if (owner) {
        const match = inSelection(owner);
        if (match)
            return { relation: 'related', reason: `owner ${ownerKey(owner)} is the ${match.part} ${ownerKey(match.hit)}` };
    }
    for (const candidate of gap.candidates ?? []) {
        const match = inSelection(candidate);
        if (match)
            return { relation: 'related', reason: `candidate ${ownerKey(candidate)} is the ${match.part} ${ownerKey(match.hit)}` };
    }
    if (file) {
        const hit = scope.files.find(item => samePath(file, item));
        if (hit !== undefined)
            return { relation: 'related', reason: `${fileKey(file)} holds a route, directive or service of this selection` };
    }
    const blocked = (scope.incomplete ?? []).find(item => applies(item, owner, file));
    if (blocked)
        return { relation: 'related', reason: `a missed candidate cannot be ruled out: ${blocked.reason}` };
    return owner === null
        ? { relation: 'global-unknown', reason: 'no owner, candidate or location ties this gap to the selection' }
        : { relation: 'unrelated', reason: `owner ${ownerKey(owner)} stayed outside the selection and its scope was enumerated` };
}
export function placeGaps(gaps, scope) {
    return gaps.map(gap => ({ ...gap, ...placeGap(gap, scope) }));
}
/** §8 the gaps that still count as missing: related, and not filled in by ng-wiring itself. */
export const activeGaps = (gaps) => gaps.filter(gap => gap.relation === 'related' && !gap.resolvedBy);
