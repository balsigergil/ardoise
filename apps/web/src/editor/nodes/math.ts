// SPDX-License-Identifier: AGPL-3.0-only
import katex from 'katex';

/** KaTeX HTML for `latex`; `error` when it does not parse (the source is shown instead). */
export function renderMath(latex: string, displayMode: boolean): { html: string; error: boolean } {
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
        trust: false,
        strict: 'ignore',
      }),
      error: false,
    };
  } catch {
    return { html: '', error: true };
  }
}
