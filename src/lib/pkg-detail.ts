/**
 * Shared package-detail renderer (F-08 + features): one implementation
 * behind both `/pkg/[name]` (pretty) and `/pkg/view?name=` (fallback).
 *
 * Layout follows the Docs terminal treatment: hairline-bordered sections
 * on black, latest-version hero, tabbed README/Docs/Dependencies/
 * Dependents, collapsed version history, download stats with sparkline,
 * and a stacked language bar. All escaping via esc/escAttr (F-09).
 */
import { esc, escAttr, apiFetch, ApiError, readCache, writeCache, announce, wireCopyButton, getSession, verifySession, isOwnerOf } from './pkg-api';
import { renderMarkdown, wireMdCopy } from './md';

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

function fmtSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtNum(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function fmtDate(iso: unknown): string {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const day = d.toISOString().slice(0, 10);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  const rel = diffDays <= 0 ? 'today' : diffDays === 1 ? 'yesterday' : diffDays < 30 ? `${diffDays} days ago` : diffDays < 365 ? `${Math.floor(diffDays / 30)} mo ago` : `${Math.floor(diffDays / 365)} yr ago`;
  return `${day} · ${rel}`;
}

/** 30-day sparkline from a {YYYY-MM-DD: count} map (zero-filled). */
function sparkSvg(spark: unknown): string {
  const map = spark && typeof spark === 'object' ? (spark as Record<string, number>) : {};
  const days: number[] = [];
  for (let back = 29; back >= 0; back--) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    days.push(Number(map[d]) || 0);
  }
  const max = Math.max(1, ...days);
  const pts = days.map((v, k) => `${(k / 29) * 100},${34 - (v / max) * 30}`).join(' ');
  return `<svg viewBox="0 0 100 36" class="h-9 w-28" role="img" aria-label="Downloads over the last 30 days" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" class="text-accent" /></svg>`;
}

const LANG_COLORS: Record<string, string> = {
  ZZ: '#0080ff',
  C: '#8b949e',
  Rust: '#dea584',
  Python: '#3572A5',
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Go: '#00ADD8',
  Zig: '#ec915c',
  'C++': '#f34b7d',
  Shell: '#89e051',
};

function langColor(name: string): string {
  if (LANG_COLORS[name]) return LANG_COLORS[name];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 60%)`;
}

function languagesHtml(langs: unknown): string {
  if (!langs || typeof langs !== 'object') return '';
  const entries = Object.entries(langs as Record<string, number>)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (entries.length === 0) return '';
  const total = entries.reduce((s, [, v]) => s + Number(v), 0) || 1;
  const bar = entries
    .map(([name, v]) => `<span style="width:${((Number(v) / total) * 100).toFixed(1)}%;background:${langColor(name)}" title="${escAttr(name)} ${esc(String(v))}%"></span>`)
    .join('');
  const legend = entries
    .map(
      ([name, v]) =>
        `<span class="inline-flex items-center gap-1.5 text-xs text-muted"><span class="w-2.5 h-2.5 rounded-full" style="background:${langColor(name)}"></span><span class="font-mono">${esc(name)}</span> ${esc(String(v))}%</span>`,
    )
    .join('');
  return `
    <div class="mb-4">
      <h2 class="font-medium mb-2">Languages</h2>
      <div class="rounded-lg border border-border bg-surface p-4">
        <div class="flex h-2.5 overflow-hidden rounded-full mb-3" role="img" aria-label="Language mix: ${entries.map(([n, v]) => `${n} ${v}%`).map(esc).join(', ')}">${bar}</div>
        <div class="flex flex-wrap gap-x-4 gap-y-1.5">${legend}</div>
      </div>
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
      return `<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 border-b border-border last:border-0 font-mono text-sm"><span>v${esc(v)}${tag}</span><span class="text-faint text-xs">${esc(fmtDate(d.published_at))} · ${esc(fmtSize(d.size_bytes))} · ${esc(lic)}${sha ? ` · <span title="${escAttr(d.sha256 || '')}">${esc(sha)}</span>` : ''}</span></div>`;
    })
    .join('');
  return `<details class="mb-4 group"><summary class="cursor-pointer font-medium hover:text-accent list-none flex items-center gap-2"><span class="text-faint group-open:rotate-90 transition-transform">▸</span> All versions (${versions.length})</summary><div class="mt-2 rounded-lg border border-border bg-surface px-4">${rows}</div></details>`;
}

function depTabsHtml(md: any): string {
  const deps = md.deps && typeof md.deps === 'object' ? Object.entries(md.deps) : [];
  const dependents = Array.isArray(md.dependents) ? md.dependents : [];
  const depCount = Number(md.dependents_count) || dependents.length;
  const depRows =
    deps.length > 0
      ? (deps as Array<[string, unknown]>)
          .map(
            ([k, v]) =>
              `<div class="flex justify-between gap-3 py-2.5 border-b border-border last:border-0 font-mono text-sm"><a href="/pkg/${encodeURIComponent(k)}" class="text-accent hover:underline">${esc(k)}</a><span class="text-muted">${esc(v)}</span></div>`,
          )
          .join('')
      : '<p class="py-3 text-sm text-faint">No dependencies — installs clean.</p>';
  const dependentRows =
    dependents.length > 0
      ? dependents
          .map(
            (name: string) =>
              `<div class="py-2.5 border-b border-border last:border-0 font-mono text-sm"><a href="/pkg/${encodeURIComponent(name)}" class="text-accent hover:underline">${esc(name)}</a></div>`,
          )
          .join('')
      : '<p class="py-3 text-sm text-faint">Nothing depends on this yet.</p>';
  return `
    <div class="mb-4">
      <div class="flex gap-1 border-b border-border mb-3" role="tablist" aria-label="Dependency tabs">
        <button role="tab" aria-selected="true" data-deptab="deps" class="deptab px-3 py-2 text-sm font-medium text-foreground border-b-2 border-accent -mb-px">Dependencies (${deps.length})</button>
        <button role="tab" aria-selected="false" data-deptab="rdeps" class="deptab px-3 py-2 text-sm font-medium text-muted hover:text-foreground border-b-2 border-transparent -mb-px">Dependents (${depCount})</button>
      </div>
      <div id="deptab-deps" class="rounded-lg border border-border bg-surface px-4">${depRows}</div>
      <div id="deptab-rdeps" class="hidden rounded-lg border border-border bg-surface px-4">${dependentRows}</div>
    </div>`;
}

function docsTabsHtml(pkg: any): string {
  const readmeSrc = typeof pkg.readme === 'string' ? pkg.readme : '';
  const docsSrc = typeof pkg.docs === 'string' ? pkg.docs : '';
  const readme = renderMarkdown(readmeSrc || 'No README available.');
  const hasDocs = docsSrc.trim().length > 0;
  const docs = hasDocs ? renderMarkdown(docsSrc) : null;
  const toc = readme.toc.length > 0 ? readme : docs;
  const tocHtml =
    toc && toc.toc.length > 0
      ? `<details class="mb-3"><summary class="cursor-pointer text-sm text-muted hover:text-accent">On this page (${toc.toc.length})</summary><ul class="mt-2 space-y-1">${toc.toc.map((t) => `<li class="${t.level > 1 ? 'ml-4' : ''}"><a href="#${escAttr(t.id)}" class="text-sm text-accent hover:underline">${esc(t.text)}</a></li>`).join('')}</ul></details>`
      : '';
  return `
    <div class="mb-4">
      <div class="flex gap-1 border-b border-border mb-3 sticky top-14 z-10 bg-background/90 backdrop-blur-sm" role="tablist" aria-label="Documentation tabs">
        <button role="tab" aria-selected="true" data-doctab="readme" class="doctab px-3 py-2 text-sm font-medium text-foreground border-b-2 border-accent -mb-px bg-background/90">README</button>
        ${hasDocs ? '<button role="tab" aria-selected="false" data-doctab="docs" class="doctab px-3 py-2 text-sm font-medium text-muted hover:text-foreground border-b-2 border-transparent -mb-px bg-background/90">Docs</button>' : ''}
      </div>
      ${tocHtml}
      <div id="doctab-readme" class="md-prose">${readme.html}</div>
      ${docs ? `<div id="doctab-docs" class="hidden md-prose">${docs.html}</div>` : ''}
      ${!hasDocs ? `<a data-owner-only href="/pkg/edit?name=${encodeURIComponent(pkg.metadata?.name || '')}" class="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-border hover:border-accent-border p-4 transition group"><span class="flex items-center justify-center w-8 h-8 rounded-lg border border-accent-border bg-accent-soft text-accent shrink-0"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 2v12M2 8h12"/></svg></span><span><span class="block text-sm font-medium group-hover:text-accent">Write the Docs page</span><span class="block text-xs text-faint mt-0.5">Owners can add long-form guides here — readers get a second tab.</span></span></a>` : ''}
    </div>`;
}

function wireTabs(root: HTMLElement, btnClass: string, prefix: string): void {
  const btns = [...root.querySelectorAll(`.${btnClass}`)] as HTMLElement[];
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (btn as HTMLElement).dataset[prefix === 'deptab' ? 'deptab' : 'doctab'];
      btns.forEach((b) => {
        const on = b === btn;
        b.setAttribute('aria-selected', String(on));
        b.classList.toggle('text-foreground', on);
        b.classList.toggle('border-accent', on);
        b.classList.toggle('text-muted', !on);
        b.classList.toggle('border-transparent', !on);
      });
      root.querySelectorAll(`[id^="${prefix}-"]`).forEach((p) => {
        p.classList.toggle('hidden', p.id !== `${prefix}-${target}`);
      });
    });
  });
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

function downloadsOf(md: any): { total: number; week: number; month: number; spark: unknown } {
  const d = md.downloads;
  if (d && typeof d === 'object') {
    return { total: Number(d.total) || 0, week: Number(d.week) || 0, month: Number(d.month) || 0, spark: d.spark };
  }
  return { total: Number(d) || 0, week: 0, month: 0, spark: null };
}

export function packageHtml(pkg: any, stale = false): string {
  const md = pkg.metadata;
  const dl = downloadsOf(md);
  const tags = Array.isArray(md.keywords) ? md.keywords.filter((t: unknown) => typeof t === 'string' && t) : [];
  return `
    ${stale ? '<p class="mb-4 text-xs font-mono text-warn">offline — showing cached copy</p>' : ''}
    <div class="mb-6">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        ${md.category ? `<a href="/pkg?category=${encodeURIComponent(md.category)}" class="text-xs font-mono px-2 py-0.5 rounded-full border border-accent-border bg-accent-soft text-accent hover:underline">${esc(md.category)}</a>` : ''}
        ${tags.slice(0, 5).map((t: string) => `<a href="/pkg?q=${encodeURIComponent(t)}" class="text-xs font-mono px-2 py-0.5 rounded-full border border-border text-muted hover:text-accent hover:border-accent-border">${esc(t)}</a>`).join('')}
        <span class="ml-auto flex items-center gap-2">
          <span class="shrink-0 text-accent font-mono text-sm">v${esc(md.latest)}</span>
          <a href="/pkg/edit?name=${encodeURIComponent(md.name)}" title="Edit package metadata and docs" data-owner-only class="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-accent border border-border hover:border-accent-border rounded-lg px-2.5 py-1.5 transition">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-7.5 7.5v1.44h1.44l7.5-7.5Zm2.828.914-1.086-1.086c-.194-.194-.51-.194-.704 0L7.646 10.66l-.427 1.5 1.5-.427 4.122-4.122c.194-.194.194-.51 0-.704Z"/></svg>
            Edit
          </a>
        </span>
      </div>
      <h1 class="text-2xl md:text-3xl font-semibold tracking-tight font-mono">${esc(md.name)}</h1>
      <p class="text-muted mt-2">${esc(md.description) || 'No description'}</p>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="rounded-lg border border-border bg-surface p-3">
        <div class="text-xs text-faint mb-1">Downloads</div>
        <div class="font-mono text-lg text-foreground">${esc(fmtNum(dl.total))}</div>
        <div class="text-[11px] text-faint font-mono">${esc(fmtNum(dl.month))}/mo · ${esc(fmtNum(dl.week))}/wk</div>
      </div>
      <div class="rounded-lg border border-border bg-surface p-3 flex items-end justify-between gap-2">
        <div><div class="text-xs text-faint mb-1">Trend · 30d</div>${sparkSvg(dl.spark)}</div>
      </div>
      <div class="rounded-lg border border-border bg-surface p-3">
        <div class="text-xs text-faint mb-1">Author</div>
        <a href="/u/${encodeURIComponent(md.author || '')}" class="font-mono text-sm text-accent hover:underline">${esc(md.author)}</a>
        <div class="text-[11px] text-faint mt-1">${esc(md.license || 'Unlicensed')}</div>
      </div>
      <div class="rounded-lg border border-border bg-surface p-3">
        <div class="text-xs text-faint mb-1">Install</div>
        <div class="flex items-center justify-between gap-2">
          <code class="text-accent font-mono text-xs break-all">zz add ${esc(md.name)}</code>
          <button data-copy="zz add ${escAttr(md.name)}" class="copy-btn shrink-0 text-xs text-muted hover:text-accent font-mono border border-border rounded-md px-2 py-1"><span>copy</span></button>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="rounded-lg border border-border bg-surface p-3">
        <div class="text-xs text-faint mb-1">Size</div>
        <div class="font-mono text-sm" title="${typeof md.size_bytes === 'number' ? escAttr(md.size_bytes + ' bytes (latest version)') : ''}">${esc(fmtSize(md.size_bytes))}</div>
      </div>
      ${
        md.homepage
          ? `<div class="rounded-lg border border-border bg-surface p-3 lg:col-span-3">
          <div class="text-xs text-faint mb-1">Homepage</div>
          <a href="${escAttr(md.homepage)}" target="_blank" rel="noopener noreferrer" class="font-mono text-sm text-accent hover:underline break-all">${esc(String(md.homepage).replace(/^https?:\/\//, ''))}</a>
        </div>`
          : ''
      }
    </div>
    ${
      (Array.isArray(md.owners) && md.owners.length > 0) || md.repo
        ? `<div class="grid grid-cols-2 gap-3 mb-4">
        <div class="rounded-lg border border-border bg-surface p-3">
          <div class="text-xs text-faint mb-1">Collaborators</div>
          <div class="flex flex-wrap items-center gap-1.5">${
            Array.isArray(md.owners) && md.owners.length > 0
              ? md.owners
                  .map(
                    (o: string) =>
                      `<a href="/u/${encodeURIComponent(o)}" title="${escAttr(o)}" class="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono text-xs font-semibold hover:border-blue-500/50">${esc(String(o).slice(0, 1).toUpperCase())}</a>`,
                  )
                  .join('')
              : '<span class="text-xs text-faint">—</span>'
          }</div>
        </div>
        <div class="rounded-lg border border-border bg-surface p-3">
          <div class="text-xs text-faint mb-1">Repository</div>
          ${
            md.repo
              ? `<a href="${escAttr(md.repo)}" target="_blank" rel="noopener noreferrer" class="font-mono text-sm text-accent hover:underline break-all">${esc(String(md.repo).replace(/^https?:\/\//, ''))}</a>`
              : '<span class="text-xs text-faint">Not linked</span>'
          }
        </div>
      </div>`
        : ''
    }
    ${languagesHtml(md.languages)}
    ${docsTabsHtml(pkg)}
    ${depTabsHtml(md)}
    ${versionsHtml(md)}`;
}

/** Wire interactivity for SSR-painted detail content (no fetching). */
export function wirePkgDetail(content: HTMLElement): void {
  content.querySelectorAll('.copy-btn').forEach((b) => wireCopyButton(b as HTMLElement, 'copy'));
  wireMdCopy(content);
  wireTabs(content, 'deptab', 'deptab');
  wireTabs(content, 'doctab', 'doctab');
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
    // Owner-only chrome (Edit button, docs CTA) is display-gated on the
    // stored login; the registry re-verifies on every write, so a spoofed
    // login gains nothing. A background verify strips the chrome when the
    // session is invalid or belongs to someone else.
    const applyOwnerGate = (login: string | null) => {
      if (!isOwnerOf(md, login)) {
        content.querySelectorAll('[data-owner-only]').forEach((el) => el.remove());
      }
    };
    applyOwnerGate(getSession()?.login ?? null);
    wirePkgDetail(content);
    verifySession().then((verified) => {
      const stored = getSession()?.login ?? null;
      if (!verified || verified !== stored) applyOwnerGate(verified);
    });
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
