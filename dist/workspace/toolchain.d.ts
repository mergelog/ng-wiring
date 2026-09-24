import type ts from 'typescript';
export interface PackageVersion {
    name: string;
    version: string;
    packageFile: string;
}
export interface Toolchain {
    typescript: typeof ts;
    angularCompiler: typeof import('@angular/compiler');
    ts: PackageVersion;
    compiler: PackageVersion;
    core: PackageVersion;
    reactive: PackageVersion[];
    unsupportedReactive: string[];
}
export declare function resolveToolchain(root: string): Promise<Toolchain>;
