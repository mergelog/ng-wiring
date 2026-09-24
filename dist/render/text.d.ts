import path from 'node:path';
export declare class RenderError extends Error {
}
/**
 * §8 every text, attribute and code excerpt is escaped before it reaches the document, so a source
 * string can never be executed as Markdown link syntax or as raw HTML.
 */
export declare function escapeInline(value: string): string;
/** §8 spaces, `#` and `%` (and anything else outside the unreserved set) are percent encoded. */
export declare function encodeLinkPath(value: string): string;
/**
 * §8 the Markdown link target is relative to the output file. Returns null when no relative path
 * exists (a different Windows drive), so the caller writes the absolute path as text plus a diagnostic
 * instead of inventing a link that does not resolve.
 */
export declare function relativeLinkTarget(fromDir: string, target: string, platform?: path.PlatformPath): string | null;
