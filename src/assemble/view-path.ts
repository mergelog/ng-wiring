import type { IndexedElement } from '../index/templates.js';
import type { ViewPath, ViewStep } from '../resolve/view/index.js';
import type { NodeKind } from '../model/types.js';

/** How a step of the display path becomes a node of the §5 model. */
export interface PlacedStep {
  step: ViewStep;
  kind: NodeKind;
  element: IndexedElement | undefined;
  /** The component the use site instantiates, when the step is a component use. */
  componentId: string | null;
}

const kindByRelation: Readonly<Record<ViewStep['relation'], NodeKind>> = {
  element: 'element', 'component-use': 'component', 'projection-slot': 'element',
  'fragment-declaration': 'template', 'template-insertion': 'template', 'structural-view': 'template',
  'control-flow': 'template', 'dynamic-creation': 'component', 'route-outlet': 'route', bootstrap: 'application',
};

const samePlace = (left: ViewStep, right: ViewStep): boolean =>
  left.ownerId === right.ownerId && !!left.span && !!right.span &&
  left.span.file === right.span.file && left.span.start === right.span.start;

/**
 * §6.1 the walk records the use relation and the element it happens on as two steps at one position. They
 * are one node: the occurrence of the child component at its use site. Merging them here keeps the
 * occurrence identity single, since §5 keys an occurrence by owner and span and not by relation.
 */
export function placeSteps(path: ViewPath, elementAt: (step: ViewStep) => IndexedElement | undefined): PlacedStep[] {
  const placed: PlacedStep[] = [];
  const steps = path.steps;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    if (step.relation === 'element' && index > 0 && steps[index - 1]!.relation === 'component-use' &&
      samePlace(step, steps[index - 1]!)) continue;
    const element = elementAt(step);
    const componentId = element?.component ?? null;
    const kind = step.relation === 'element' && componentId ? 'component' : kindByRelation[step.relation];
    placed.push({ step, kind, element, componentId });
  }
  return placed;
}

/** §8 the edge kind that connects a step to the step below it, i.e. towards the selected element. */
export const downwardEdgeKind: Readonly<Record<ViewStep['relation'], 'display-parent' | 'projection' |
'view-insertion' | 'route-outlet' | 'dynamic-create' | 'bootstrap'>> = {
  element: 'display-parent', 'component-use': 'display-parent', 'projection-slot': 'projection',
  'fragment-declaration': 'display-parent', 'template-insertion': 'view-insertion',
  'structural-view': 'display-parent', 'control-flow': 'display-parent',
  'dynamic-creation': 'dynamic-create', 'route-outlet': 'route-outlet', bootstrap: 'bootstrap',
};
