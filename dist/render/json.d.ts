import type { RenderInput, RenderResult } from './markdown.js';
/**
 * §3.1, §3.4 `--json` produces one file whose extension alone differs. The body is the same normalized
 * model the Markdown renderer reads, so neither output re-derives anything the other does not have.
 */
export declare function renderJson(input: Pick<RenderInput, 'report'>): RenderResult;
