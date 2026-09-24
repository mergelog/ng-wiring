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
/**
 * §6.1 the walk records the use relation and the element it happens on as two steps at one position. They
 * are one node: the occurrence of the child component at its use site. Merging them here keeps the
 * occurrence identity single, since §5 keys an occurrence by owner and span and not by relation.
 */
export declare function placeSteps(path: ViewPath, elementAt: (step: ViewStep) => IndexedElement | undefined): PlacedStep[];
/** §8 the edge kind that connects a step to the step below it, i.e. towards the selected element. */
export declare const downwardEdgeKind: Readonly<Record<ViewStep['relation'], 'display-parent' | 'projection' | 'view-insertion' | 'route-outlet' | 'dynamic-create' | 'bootstrap'>>;
