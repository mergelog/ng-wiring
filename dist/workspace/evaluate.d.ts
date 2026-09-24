import type ts from 'typescript';
export type StaticValue = null | boolean | number | string | StaticValue[] | {
    [key: string]: StaticValue;
};
export type Evaluation = {
    known: true;
    value: StaticValue;
} | {
    known: false;
    reason: string;
};
export declare class StaticEvaluator {
    private readonly tsApi;
    private readonly checker;
    private readonly maxExpansions;
    private readonly maxDepth;
    private expansions;
    private readonly active;
    constructor(tsApi: typeof ts, checker: ts.TypeChecker, maxExpansions?: number, maxDepth?: number);
    evaluate(node: ts.Expression): Evaluation;
    private unknown;
    private visit;
}
