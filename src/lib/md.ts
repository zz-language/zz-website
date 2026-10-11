/**
 * Minimal Markdown renderer for package README/docs (F5).
 *
 * No runtime dependencies by design: the registry page must stay light.
 * Supports headings, fenced code, tables, lists (nested), blockquotes,
 * rules, paragraphs + inline code/bold/italic/strike/links/autolinks.
 * Output is allowlist-safe: all text is escaped first, links are
 * restricted to http(s)/anchor/relative targets.
 */

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

const ALLOWED_LANG = /^[a-z0-9+#-]{1,20}$/i;

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text: string, seen: Map<string, number>): string {
  let base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 60);
  if (!base) base = 'section';
  const n = seen.get(base) || 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url.startsWith('#')) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (/^https?:\/\/[^ \t<>"]+$/i.test(url)) return url;
  return null;
}

function renderInline(src: string): string {
  // Escape first, then re-introduce safe constructs.
  let out = escapeText(src);

  // Inline code (protected from further processing via placeholders).
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code class="md-code">${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // Images ![alt](src) — same rules as links, no external scripts.
  out = out.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, href) => {
    const safe = safeHref(href);
    if (!safe) return alt;
    return `<img src="${safe}" alt="${alt}" loading="lazy" class="md-img" />`;
  });

  // Links [text](href).
  out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text, href) => {
    const safe = safeHref(href);
    if (!safe) return text;
    const external = /^https?:\/\//i.test(safe);
    const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${safe}" class="md-link"${extra}>${text}</a>`;
  });

  // Autolinks https://...
  out = out.replace(/(^|[\s(])(https?:\/\/[^ \t<>"')\]]+)/g, (_, pre, url) => {
    const safe = safeHref(url);
    if (!safe) return pre + url;
    return `${pre}<a href="${safe}" class="md-link" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Restore code spans.
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)] ?? '');
  return out;
}

function isTableDelimiter(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|');
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(src: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();
  const html: string[] = [];
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];
  let listStack: Array<'ul' | 'ol'> = [];
  let para: string[] = [];
  let quote: string[] = [];

  const closePara = () => {
    if (para.length > 0) {
      html.push(`<p class="md-p">${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeQuote = () => {
    if (quote.length > 0) {
      html.push(`<blockquote class="md-quote">${renderInline(quote.join(' '))}</blockquote>`);
      quote = [];
    }
  };
  const closeLists = (depth = 0) => {
    while (listStack.length > depth) {
      html.push(`</${listStack.pop()}>`);
    }
  };
  const flushCode = () => {
    const lang = ALLOWED_LANG.test(codeLang) ? codeLang.toLowerCase() : 'text';
    const code = escapeText(codeBuf.join('\n'));
    const id = `code-${Math.random().toString(36).slice(2, 8)}`;
    html.push(
      `<div class="md-codeblock"><div class="md-codebar"><span class="md-codelang">${lang}</span>` +
        `<button class="md-copy" data-copy-target="${id}">copy</button></div>` +
        `<pre><code id="${id}" class="language-${lang}">${code || ' '}</code></pre></div>`,
    );
    codeBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code.
    const fence = trimmed.match(/^(`{3,})(\S*)\s*$/);
    if (fence) {
      if (!inCode) {
        closePara();
        closeQuote();
        closeLists();
        inCode = true;
        codeLang = fence[2] || 'text';
      } else {
        inCode = false;
        flushCode();
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // Headings.
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      closePara();
      closeQuote();
      closeLists();
      const level = h[1].length;
      // Strip inline code markers for the TOC text, keep display inline.
      const text = h[2].replace(/`/g, '');
      const id = slugify(text.replace(/[#*_\[\]()!]/g, ''), seen);
      if (level <= 3) toc.push({ level, text, id });
      html.push(`<h${level} id="${id}" class="md-h${level}">${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      closePara();
      closeQuote();
      closeLists();
      html.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // Tables.
    if (trimmed.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      closePara();
      closeQuote();
      closeLists();
      const heads = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        if (c.startsWith(':') && c.endsWith(':')) return 'center';
        if (c.endsWith(':')) return 'right';
        return 'left';
      });
      const rows: string[] = [];
      rows.push(
        `<table class="md-table"><thead><tr>${heads.map((c, k) => `<th style="text-align:${aligns[k] || 'left'}">${renderInline(c)}</th>`).join('')}</tr></thead><tbody>`,
      );
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = splitRow(lines[i]);
        rows.push(
          `<tr>${heads.map((_, k) => `<td style="text-align:${aligns[k] || 'left'}">${renderInline(cells[k] || '')}</td>`).join('')}</tr>`,
        );
        i++;
      }
      rows.push('</tbody></table>');
      html.push(rows.join(''));
      continue;
    }

    // Blockquote.
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      closePara();
      closeLists();
      quote.push(q[1]);
      i++;
      continue;
    }
    if (quote.length > 0 && trimmed === '') {
      closeQuote();
      i++;
      continue;
    }

    // Lists (nested by 2-space indent).
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (li) {
      closePara();
      closeQuote();
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
      const ordered = /^\d/.test(li[2]);
      const want: 'ul' | 'ol' = ordered ? 'ol' : 'ul';
      closeLists(depth);
      if (listStack.length === depth) {
        html.push(`<${want} class="md-list">`);
        listStack.push(want);
      } else if (listStack[depth] !== want) {
        // Mixed marker at same depth: close and reopen.
        closeLists(depth);
        html.push(`<${want} class="md-list">`);
        listStack.push(want);
      }
      // Task list checkboxes.
      const task = li[3].match(/^\[([ xX])\]\s+(.+)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x' ? ' checked disabled' : ' disabled';
        html.push(`<li class="md-task"><input type="checkbox"${checked} /> ${renderInline(task[2])}</li>`);
      } else {
        html.push(`<li>${renderInline(li[3])}</li>`);
      }
      i++;
      continue;
    }

    // Blank line ends blocks.
    if (trimmed === '') {
      closePara();
      closeQuote();
      closeLists();
      i++;
      continue;
    }

    // Continuation of an open list item (indented text without marker).
    if (listStack.length > 0 && /^\s+\S/.test(line)) {
      const last = html.pop() || '';
      html.push(last.replace(/<\/li>$/, ` ${renderInline(trimmed)}</li>`));
      i++;
      continue;
    }

    para.push(trimmed);
    i++;
  }

  if (inCode) flushCode();
  closePara();
  closeQuote();
  closeLists();

  return { html: html.join('\n'), toc };
}

/** Wire `.md-copy` buttons inside a container (copies the code text). */
export function wireMdCopy(root: HTMLElement): void {
  root.querySelectorAll('.md-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = (btn as HTMLElement).dataset.copyTarget;
      const code = target ? root.querySelector(`#${CSS.escape(target)}`) : null;
      try {
        await navigator.clipboard.writeText(code?.textContent ?? '');
        btn.textContent = 'copied!';
        setTimeout(() => (btn.textContent = 'copy'), 1500);
      } catch {
        btn.textContent = 'copy failed';
      }
    });
  });
}
