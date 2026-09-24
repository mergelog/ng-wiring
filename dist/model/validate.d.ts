import { type WiringReport } from './types.js';
/**
 * §5 model validation: every id reference resolves, the report holds one context, edge kinds match the node
 * kinds at both ends, partial always carries its reason, and spans stay inside their file.
 */
export declare function validateReport(report: WiringReport): string[];
export declare function assertValidReport(report: WiringReport): void;
export declare function schemaPath(): string;
/** §5 the shipped JSON Schema is the published contract; the model is checked against it before output. */
export declare function validateAgainstSchema(report: WiringReport): Promise<string[]>;
