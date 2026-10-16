/**
 * Shared registry-client helpers for pkg pages (F-06, F-09).
 *
 * Single source for: HTML escaping, bounded fetch (timeout + retry),
 * same-origin API paths, and sessionStorage stale-while-revalidate cache.
 * Imported by the inline scripts of pkg/[name], pkg/view, pkg/index,
 * u/[username] and pkg/author — fix once, fixed everywhere.
 */

export function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/** Attribute-safe escaping (href, data-copy, title). */
export const escAttr = esc;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
}

/** Same-origin GET with timeout + exponential backoff. Never hangs forever. */
export async function apiFetch(path: string, opts: FetchOpts = {}): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) throw new ApiError(404, 'not found');
      if (!res.ok) throw new ApiError(res.status, `registry error ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && e.status === 404) throw e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('request failed');
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, json } = JSON.parse(raw);
    if (Date.now() - at > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return json as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, json: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), json }));
  } catch {
    /* storage full or unavailable — caching is best-effort */
  }
}

/** Announce async UI changes (copy feedback, load errors) to screen readers. */
export function announce(msg: string): void {
  let live = document.getElementById('zz-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'zz-live';
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = msg;
}

/** Wire a copy button: clipboard + label swap + screen-reader announcement. */
export function wireCopyButton(btn: HTMLElement, idleLabel = 'copy'): void {
  btn.addEventListener('click', async () => {
    const label = btn.querySelector('span');
    const set = (t: string) => {
      if (label) label.textContent = t;
      else btn.textContent = t;
    };
    try {
      await navigator.clipboard.writeText(btn.dataset.copy || '');
      set('copied!');
      announce('Copied to clipboard');
      setTimeout(() => set(idleLabel), 1500);
    } catch {
      set('copy failed');
      announce('Copy failed');
    }
  });
}

/** Fixed category vocabulary (mirrors registry + CLI). */
export const CATEGORIES = ['backend', 'cli', 'frameworks', 'math', 'gui', 'utilities'];

export interface Session {
  login: string;
  token: string;
}

/** Stored session as-is (login is self-asserted — verify before trusting). */
export function getSession(): Session | null {
  try {
    const login = localStorage.getItem('zz_login') || '';
    const token = localStorage.getItem('zz_token') || '';
    return login && token ? { login, token } : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem('zz_token');
    localStorage.removeItem('zz_login');
    sessionStorage.removeItem('zz:verified_at');
  } catch {}
  window.dispatchEvent(new Event('zz-session-change'));
}

function verifiedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem('zz:verified_at') || '0');
    return Date.now() - at < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function markVerified(): void {
  try {
    sessionStorage.setItem('zz:verified_at', String(Date.now()));
  } catch {}
}

/**
 * Prove the stored token is still valid AND which login it owns.
 * Returns the verified login, or null (clearing spoofed/expired sessions).
 * Cached 10 minutes to avoid a ping per page view.
 */
export async function verifySession(): Promise<string | null> {
  const s = getSession();
  if (!s) return null;
  if (verifiedRecently()) return s.login;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const me = await res.json();
    if (!me || me.login !== s.login) throw new Error('login mismatch');
    markVerified();
    return me.login;
  } catch {
    clearSession();
    return null;
  }
}

/** Owner check against public package metadata (display gating only —
 *  the registry re-verifies on every write, so spoofed logins gain nothing). */
export function isOwnerOf(md: any, login: string | null): boolean {
  if (!login || !md) return false;
  if (md.author === login) return true;
  return Array.isArray(md.owners) && md.owners.includes(login);
}

/**
 * Resolve a package/author slug for detail shells from, in order:
 * explicit route param (pretty prerendered page), `?name=`/`?login=`
 * query (legacy fallback URLs), last path segment (Pages Function
 * rewrite serving the shell for names published after the last build).
 */
export function resolveSlug(explicit: string, queryKey: string): string {
  if (explicit) return explicit;
  const qs = new URLSearchParams(window.location.search).get(queryKey);
  if (qs) return qs;
  const seg = window.location.pathname.split('/').filter(Boolean).pop() || '';
  return /^[a-z0-9_-]+$/i.test(seg) ? seg : '';
}
