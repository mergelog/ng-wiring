export declare class Snapshot {
    readonly root: string;
    readonly files: Map<string, string>;
    constructor(root: string);
    record(file: string): Promise<void>;
    recordIfExists(file: string): Promise<void>;
    get id(): string;
    verify(discover?: () => Promise<Iterable<string>>): Promise<void>;
}
