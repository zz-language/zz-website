/**
 * Shared package-detail renderer (F-08): one implementation behind both
 * `/pkg/[name]` (pretty) and `/pkg/view?name=` (fallback).
 *
 * Flow: skeleton → stale cache (instant, if fresh) → same-origin fetch
 * with timeout+retry (F-06) → render → error states (F-07: 404 vs 502
 * are distinct). All escaping via esc/escAttr (F-09).
 */
import { esc, escAttr, apiFetch, ApiError, readCache, writeCache, announce, wireCopyButton } from './pkg-api';

export function detailSkeletonHtml(): string {
  return `
    <div role="status" aria-busy="true" aria-label="Loading package">
      <div class="animate-pulse">
        <div class="h-8 w-2/3 rounded bg-raised mb-3"></div>
        <div class="h-4 w-full rounded bg-raised mb-6"></div>
        <div class="rounded-lg border border-border bg-surface p-4 mb-4">
          <div class="h-3 w-16 rounded bg-raised mb-2"></div>
          <div class="h-5 w-48 rounded bg-raised"></div>
        </div>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="rounded-lg border border-border bg-surface p-4"><div class="h-3 w-12 rounded bg-raised mb-2"></div><div class="h-4 w-24 rounded bg-raised"></div></div>
          <div class="rounded-lg border border-border bg-surface p-4"><div class="h-3 w-12 rounded bg-raised mb-2"></div><div class="h-4 w-16 rounded bg-raised"></div></div>
        </div>
      </div>
      <p class="text-muted text-sm mt-2">Loading package…</p>
    </div>`;
}

function versionsHtml(md: any): string {
  const versions = Array.isArray(md.versions) ? md.versions : [];
  if (versions.length === 0) return '';
  const details = md.version_details && typeof md.version_details === 'object' ? md.version_details : {};
  const rows = versions
    .map((v: string) => {
      const d = details[v] || {};
      const sha = typeof d.sha256 === 'string' ? d.sha256.slice(0, 12) : '';
      const lic = d.license || md.license || '';
      const tag = v === md.latest ? ' <span class="text-accent">latest</span>' : '';
      return `<div class="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0 font-mono text-sm"><span>v${esc(v)}${tag}</span><span class="text-faint text-xs">${esc(lic)}${sha ? ` · <span title="${escAttr(d.sha256 || '')}">${esc(sha)}</span>` : ''}</span></div>`;
    })
    .join('');
  return `<div class="mb-4"><h2 class="font-medium mb-2">Versions</h2><div class="rounded-lg border border-border bg-surface px-4">${rows}</div></div>`;
}

function notFoundHtml(name: string): string {
  return `
    <div class="text-center py-12">
      <h1 class="text-xl font-semibold mb-2">Package not found</h1>
      <p class="text-muted text-sm mb-6">The package "${esc(name)}" does not exist yet.</p>
      <code class="px-4 py-2 bg-surface border border-border rounded-lg text-accent font-mono text-sm">zz publish</code>
    </div>`;
}

function errorHtml(): string {
  return `
    <div class="rounded-lg border border-border bg-surface p-8 text-center">
      <p class="text-foreground font-medium mb-1">Could not reach the registry</p>
      <p class="text-muted text-sm mb-4">Check your connection and try again in a moment.</p>
      <button id="pkg-retry" class="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium">Retry</button>
    </div>`;
}

export function packageHtml(pkg: any, stale = false): string {
  const md = pkg.metadata;
  const deps = md.deps && typeof md.deps === 'object' ? Object.entries(md.deps) : [];
  return `
    ${stale ? '<p class="mb-4 text-xs font-mono text-warn">offline — showing cached copy</p>' : ''}
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight font-mono">${esc(md.name)}</h1>
        <p class="text-muted mt-2">${esc(md.description) || 'No description'}</p>
      </div>
      <span class="shrink-0 text-accent font-mono">v${esc(md.latest)}</span>
    </div>
    <div class="rounded-lg border border-border bg-surface p-4 mb-4">
      <div class="text-xs text-faint font-mono mb-1.5">Install</div>
      <div class="flex items-center justify-between gap-3">
        <code class="text-accent font-mono text-sm break-all">zz add ${esc(md.name)}</code>
        <button data-copy="zz add ${escAttr(md.name)}" class="copy-btn shrink-0 text-xs text-muted hover:text-accent font-mono border border-border rounded-md px-2.5 py-1.5"><span>copy</span></button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="rounded-lg border border-border bg-surface p-4">
        <div class="text-xs text-faint mb-1">Author</div>
        <a href="/u/${encodeURIComponent(md.author || '')}" class="font-mono text-sm text-accent hover:underline">${esc(md.author)}</a>
      </div>
      <div class="rounded-lg border border-border bg-surface p-4">
        <div class="text-xs text-faint mb-1">Version</div>
        <div class="font-mono text-sm">${esc(md.latest)}</div>
      </div>
    </div>
    ${versionsHtml(md)}
    ${
      deps.length > 0
        ? `<div class="mb-4">
        <h2 class="font-medium mb-2">Dependencies</h2>
        <div class="rounded-lg border border-border bg-surface px-4">
          ${(deps as Array<[string, unknown]>).map(([k, v]) => `<div class="flex justify-between py-2.5 border-b border-border last:border-0 font-mono text-sm"><span>${esc(k)}</span><span class="text-muted">${esc(v)}</span></div>`).join('')}
        </div>
      </div>`
        : ''
    }
    <div>
      <h2 class="font-medium mb-2">README</h2>
      <div class="rounded-lg border border-border bg-surface p-5 text-sm text-muted whitespace-pre-wrap">${esc(pkg.readme) || 'No README available.'}</div>
    </div>`;
}

/** Load + render a package into `content`. Handles cache, retry, states. */
export async function renderPkgDetail(content: HTMLElement, name: string): Promise<void> {
  if (!name) {
    content.innerHTML = `
      <div class="text-center py-12">
        <h1 class="text-xl font-semibold mb-2">No package specified</h1>
        <p class="text-muted text-sm mb-6">Use search to find a package.</p>
        <a href="/pkg" class="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium">Browse packages</a>
      </div>`;
    return;
  }

  const cacheKey = `zz:pkg:${name}`;
  const cached = readCache<any>(cacheKey);
  const paint = (pkg: any, stale = false) => {
    const md = pkg.metadata;
    document.title = `${md.name} v${md.latest} | ZZ Packages`;
    content.innerHTML = packageHtml(pkg, stale);
    content.querySelectorAll('.copy-btn').forEach((b) => wireCopyButton(b as HTMLElement, 'copy'));
  };

  if (cached) {
    paint(cached, true);
    // Background revalidation: silent unless it fails (keep stale painted).
    apiFetch(`/api/pkg/${encodeURIComponent(name)}`)
      .then((pkg) => {
        writeCache(cacheKey, pkg);
        paint(pkg);
      })
      .catch(() => announce('Offline — showing cached copy'));
    return;
  }

  content.innerHTML = detailSkeletonHtml();
  try {
    const pkg = await apiFetch(`/api/pkg/${encodeURIComponent(name)}`);
    writeCache(cacheKey, pkg);
    paint(pkg);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      document.title = 'Package not found | ZZ Packages';
      content.innerHTML = notFoundHtml(name);
    } else {
      content.innerHTML = errorHtml();
      announce('Could not reach the registry');
      document.getElementById('pkg-retry')?.addEventListener('click', () => renderPkgDetail(content, name));
    }
  }
}
