import type { RenderInput, RenderResult } from './markdown.js';

/**
 * §3.1, §3.4 `--json` produces one file whose extension alone differs. The body is the same normalized
 * model the Markdown renderer reads, so neither output re-derives anything the other does not have.
 */
export function renderJson(input: Pick<RenderInput, 'report'>): RenderResult {
  return {
    text: `${JSON.stringify(input.report, null, 2)}\n`,
    edgeIds: input.report.edges.map(edge => edge.id).sort(),
    problems: [],
  };
}
