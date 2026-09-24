# UI event baseline for P8

`ui-events-2026-09-24` is the fixed table in `src/resolve/operation/events.ts`.
It records `bubbles` and `composed` for click, dblclick, input, change,
keydown, keyup, mouseover, mouseout, focusin, focusout, focus, blur,
mouseenter, and mouseleave. The table follows the [UI Events specification](https://www.w3.org/TR/uievents/)
and the [HTML event firing rules](https://html.spec.whatwg.org/multipage/input.html).
In particular, HTML initializes `change` with bubbling but does not initialize
its composed flag. Unknown custom events have no default entry.

The resolver emits DOM listener candidates separately from Angular output
subscriptions. A known non-bubbling event reaches only its target listener;
explicitly identified `addEventListener(..., {capture: true})` or `true`
registrations are conditional capture paths. A DOM ancestor supplied by a view
path is used only when that path identifies the element. `window:` and
`document:` listeners have no element ancestor. The result carries conditions
for modifier matching, disabled controls, propagation stopping, shadow DOM
retargeting, and unknown placement. `click → submit` and `focus() → focusin`
are boundary records, never automatic edges.
