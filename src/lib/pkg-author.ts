/**
 * Shared author-page renderer (F-05): one implementation behind
 * `/u/[username]` (pretty) and `/pkg/author?login=` (fallback).
 *
 * Single server-filtered request (`?author=`, limit 100) instead of the
 * full catalog download + client-side filter.
 */
import { esc, escAttr, apiFetch, ApiError, wireCopyButton, announce } from './pkg-api';

function cardHtml(pkg: any): string {
  return `
    <div class="rounded-xl border border-border bg-surface p-5 shadow-lg transition-all duration-200 motion-safe:hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-[0_16px_50px_-12px_rgba(0,128,255,0.35)]">
      <a href="/pkg/${encodeURIComponent(pkg.name)}" class="block group">
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-mono font-bold text-foreground group-hover:text-blue-400">${esc(pkg.name)}</h3>
          <span class="shrink-0 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 text-xs rounded-full font-mono">v${esc(pkg.latest)}</span>
        </div>
        <p class="text-sm mt-1.5 leading-relaxed text-muted">${esc(pkg.description) || 'No description'}</p>
      </a>
      <div class="flex items-center justify-end mt-4 text-xs">
        <button data-copy="zz add ${escAttr(pkg.name)}" class="copy-btn bg-surface hover:bg-raised text-muted hover:text-accent text-xs px-3 py-1.5 rounded-lg border border-border flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>copy install</span></button>
      </div>
    </div>`;
}

export async function renderAuthorPage(content: HTMLElement, login: string): Promise<void> {
  if (!login) {
    content.innerHTML = `
      <div class="text-center py-12">
        <h1 class="text-xl font-semibold mb-2">No author specified</h1>
        <p class="text-muted text-sm mb-6">Use search to find a package.</p>
        <a href="/pkg" class="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium">Browse packages</a>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div role="status" aria-busy="true" aria-label="Loading packages">
      <div class="animate-pulse">
        <div class="h-8 w-1/3 rounded bg-raised mb-6"></div>
        <div class="grid grid-cols-2 gap-4 mb-8">
          <div class="rounded-lg border border-border bg-surface p-4"><div class="h-8 rounded bg-raised"></div></div>
          <div class="rounded-lg border border-border bg-surface p-4"><div class="h-8 rounded bg-raised"></div></div>
        </div>
      </div>
      <p class="text-muted text-sm mt-2">Loading packages…</p>
    </div>`;

  try {
    const packages = await apiFetch(`/api/pkg/search?author=${encodeURIComponent(login)}&limit=100`);
    // Server filters by author; re-filter client-side too so the page is
    // also correct while older registry releases ignore `?author=`.
    const list = (Array.isArray(packages) ? packages : []).filter((p) => p?.author === login);
    document.title = `${login} | ZZ Packages`;
    if (list.length === 0) {
      content.innerHTML = `
        <p class="text-sm font-mono text-accent mb-2">Author</p>
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight font-mono mb-6">${esc(login)}</h1>
        <div class="rounded-lg border border-border bg-surface p-8 text-center">
          <p class="text-foreground font-medium mb-1">No packages yet</p>
          <p class="text-muted text-sm">${esc(login)} has not published anything.</p>
        </div>`;
      return;
    }
    content.innerHTML = `
      <p class="text-sm font-mono text-accent mb-2">Developer</p>
      <h1 class="text-2xl md:text-3xl font-semibold tracking-tight font-mono mb-6">${esc(login)}</h1>
      <div class="grid grid-cols-2 gap-4 mb-8">
        <div class="rounded-lg border border-border bg-surface p-4">
          <div class="text-xs text-faint mb-1">Published packages</div>
          <div class="font-mono text-2xl text-foreground">${list.length}</div>
        </div>
        <div class="rounded-lg border border-border bg-surface p-4">
          <div class="text-xs text-faint mb-1">Latest update</div>
          <div class="font-mono text-sm text-foreground truncate">${esc(list[0].name)} v${esc(list[0].latest)}</div>
          <a href="/pkg/${encodeURIComponent(list[0].name)}" class="text-xs text-accent hover:underline">Open →</a>
        </div>
      </div>
      <h2 class="font-medium mb-3">Packages</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${list.map(cardHtml).join('')}
      </div>`;
    content.querySelectorAll('.copy-btn').forEach((b) => wireCopyButton(b as HTMLElement, 'copy install'));
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      content.innerHTML = `
        <div class="rounded-lg border border-border bg-surface p-8 text-center">
          <p class="text-foreground font-medium mb-1">Invalid author name</p>
          <p class="text-muted text-sm">Author names use lowercase letters, numbers, dash and underscore.</p>
        </div>`;
    } else {
      content.innerHTML = `
        <div class="rounded-lg border border-border bg-surface p-8 text-center">
          <p class="text-foreground font-medium mb-1">Could not reach the registry</p>
          <p class="text-muted text-sm mb-4">Try again in a moment.</p>
          <button id="author-retry" class="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium">Retry</button>
        </div>`;
      announce('Could not reach the registry');
      document.getElementById('author-retry')?.addEventListener('click', () => renderAuthorPage(content, login));
    }
  }
}
