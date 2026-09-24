import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render untrusted Markdown (package READMEs) to safe HTML.
 *
 * `marked` parses; DOMPurify strips everything outside the HTML profile
 * (scripts, event handlers, javascript: URLs) so a malicious README
 * cannot execute code in the viewer's browser.
 */
export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { breaks: true, gfm: true });
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
