import type { AnalysisContext } from '../../workspace/context.js';
import type { Catalog } from '../../index/catalog.js';
import type { IndexedElement, Span, TemplateIndex } from '../../index/templates.js';
import type { ViewPath } from '../view/index.js';
/** DOM/UI Events baseline used by Angular 22 analysis. Unknown events stay unknown. */
export declare const uiEventsVersion = "ui-events-2026-09-24";
export declare const uiEvents: Readonly<Record<string, {
    bubbles: boolean;
    composed: boolean;
}>>;
export interface EventListener {
    selectedElement: IndexedElement;
    listenerElement: IndexedElement | null;
    eventSource: 'selected-dom' | 'component-output' | 'directive-output' | 'global' | 'host-dom' | 'unknown-dom';
    eventName: string;
    modifiers: string[];
    subscription: string | null;
    handler: string;
    span: Span | null;
    conditions: string[];
    status: 'candidate' | 'conditional' | 'unresolved';
    registration: 'template' | 'host' | 'capture';
}
export interface EventResolution {
    listeners: EventListener[];
    outputSubscriptions: EventListener[];
    derivedEvents: {
        from: string;
        to: string;
        status: 'boundary';
        reason: string;
    }[];
    diagnostics: string[];
}
/** A DOM source and an Angular output are separate possible sources for the same spelling. */
export declare function resolveEventListeners(selected: IndexedElement, context: AnalysisContext, catalog: Catalog, eventFilter?: string, placement?: {
    index: TemplateIndex;
    path: ViewPath;
}): EventResolution;
