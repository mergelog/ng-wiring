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
/** Angular 20.0/20.1 use TS 5.8; 20.2/20.3 also allow TS 5.9. Angular 22 uses TS 6.0. */
export declare function supportedTypeScript(angularVersion: string, typescriptVersion: string): boolean;
export declare const TESTED_REACTIVE_VERSIONS: Readonly<Record<string, readonly string[]>>;
export declare function resolveToolchain(root: string): Promise<Toolchain>;
