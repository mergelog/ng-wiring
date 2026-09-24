import path from 'node:path';
export class RenderError extends Error {
}
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
/**
 * §8 every text, attribute and code excerpt is escaped before it reaches the document, so a source
 * string can never be executed as Markdown link syntax or as raw HTML.
 */
export function escapeInline(value) {
    return value.replace(/[\r\n]+/g, ' ')
        .replace(/[&<>]/g, char => entities[char])
        .replace(/[\\`*_[\]()|~!]/g, char => `\\${char}`);
}
const safeInLink = /[A-Za-z0-9\-._~/]/;
/** §8 spaces, `#` and `%` (and anything else outside the unreserved set) are percent encoded. */
export function encodeLinkPath(value) {
    let encoded = '';
    for (const char of value) {
        if (safeInLink.test(char)) {
            encoded += char;
            continue;
        }
        for (const byte of Buffer.from(char, 'utf8'))
            encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return encoded;
}
/**
 * §8 the Markdown link target is relative to the output file. Returns null when no relative path
 * exists (a different Windows drive), so the caller writes the absolute path as text plus a diagnostic
 * instead of inventing a link that does not resolve.
 */
export function relativeLinkTarget(fromDir, target, platform = path) {
    const relative = platform.relative(fromDir, target);
    if (!relative || platform.isAbsolute(relative))
        return null;
    const posix = relative.split(platform.sep).join('/');
    return encodeLinkPath(posix.startsWith('.') ? posix : `./${posix}`);
}
