/**
 * Shared header interactivity for CustomHeader (main site) and SiteHeader
 * (Starlight docs override). Single source — both components bundle this.
 *
 * Conventions: `zz_token` / `zz_login` in localStorage form the session;
 * `zz-theme` ("dark" | "light" | "system") drives `data-theme`.
 * Cross-component events: `zz-session-change`, `zz-theme-change`,
 * `zz-open-palette`.
 */

export interface ZZSession {
  login: string;
  token: string;
}

export function zzSession(): ZZSession | null {
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
  } catch {}
  window.dispatchEvent(new Event('zz-session-change'));
}

export function currentThemeSetting(): string {
  try {
    return localStorage.getItem('zz-theme') || 'system';
  } catch {
    return 'system';
  }
}

export function applyThemeSetting(setting: string): void {
  const dark =
    setting === 'dark' ||
    (setting !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try {
    localStorage.setItem('zz-theme', setting);
    // Starlight reads `starlight-theme` in <head> on docs routes (before
    // our bundle runs). Mirror the choice there so docs never disagree:
    // our "system" is Starlight's "auto".
    localStorage.setItem('starlight-theme', setting === 'system' ? 'auto' : setting);
  } catch {}
  syncThemeIcons();
}

export function syncThemeIcons(): void {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  document.querySelectorAll('.theme-icon-dark').forEach((el) => el.classList.toggle('hidden', !dark));
  document.querySelectorAll('.theme-icon-light').forEach((el) => el.classList.toggle('hidden', dark));
}

function escName(login: string): string {
  return login.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render the auth slot: login link, or avatar badge + dropdown menu. */
export function renderAuth(): void {
  const slot = document.getElementById('nav-auth');
  if (!slot) return;
  const session = zzSession();
  const homeLink = document.getElementById('nav-home');
  if (homeLink) homeLink.classList.toggle('hidden', !session);
  if (!session) {
    slot.innerHTML =
      '<a href="/login" class="px-3 py-1.5 rounded-md text-sm text-muted hover:text-foreground hover:bg-raised">Log in</a>';
    document.querySelectorAll('.nav-auth-link').forEach((a) => {
      (a as HTMLElement).style.display = '';
    });
    return;
  }
  const initial = escName(session.login.slice(0, 1).toUpperCase());
  slot.innerHTML =
    `<div class="relative">` +
    `<button id="user-badge" class="flex h-9 items-center gap-2 pl-1.5 pr-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white transition" aria-label="Account menu" aria-haspopup="true">` +
    `<span class="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 font-mono text-xs font-semibold">${initial}</span>` +
    `<span class="max-w-24 truncate font-mono text-xs px-1">${escName(session.login)}</span></button>` +
    `<div id="user-menu" class="user-menu hidden absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/95 backdrop-blur-md shadow-xl z-50">` +
    `<div class="px-3 py-2.5 border-b border-slate-800 mb-1"><div class="text-[11px] text-slate-400">Signed in as</div>` +
    `<div class="font-mono font-medium text-slate-100 truncate">${escName(session.login)}</div></div>` +
    `<div class="p-1.5">` +
    `<a href="/pkg/author?login=${encodeURIComponent(session.login)}" class="user-menu-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>My packages</a>` +
    `<a href="/pkg/tokens" class="user-menu-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>API tokens</a>` +
    `<button id="user-menu-logout" class="hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-md p-2 w-full text-left transition flex items-center gap-2 text-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 5"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Log out</button>` +
    `</div></div>`;
  document.querySelectorAll('.nav-auth-link').forEach((a) => {
    (a as HTMLElement).style.display = 'none';
  });

  const badge = document.getElementById('user-badge');
  const menu = document.getElementById('user-menu');
  badge?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('hidden');
  });
  document.getElementById('user-menu-logout')?.addEventListener('click', () => {
    clearSession();
    window.location.reload();
  });
  document.addEventListener('click', (e) => {
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target as Node)) {
      menu.classList.add('hidden');
    }
  });
}

function focusSearch(): boolean {
  const candidates: Array<HTMLElement | null> = [
    document.getElementById('pkg-search'),
    document.querySelector('starlight-search input, [data-pagefind-ui] input'),
  ];
  for (const el of candidates) {
    if (el && el.offsetParent !== null) {
      el.focus();
      return true;
    }
  }
  return false;
}

/** Highlight the nav link matching the current route. */
function markActiveNav(): void {
  const path = window.location.pathname;
  const section =
    path.startsWith('/playground') ? 'playground'
    : path.startsWith('/pkg') ? 'packages'
    : path === '/home' ? 'home'
    : path === '/login' || path === '/terms' || path === '/privacy' || path === '/' ? '' : 'docs';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if ((a as HTMLElement).dataset.nav === section) a.classList.add('nav-link-active');
  });
}

/** One-time migration: an older `zz-theme` choice without a matching
 * `starlight-theme` makes docs render Starlight's default (dark). Repair
 * it on first load so both keys agree from then on. */
function migrateStarlightTheme(): void {
  try {
    const ours = localStorage.getItem('zz-theme');
    if (!ours) return;
    const theirs = localStorage.getItem('starlight-theme');
    const want = ours === 'system' ? 'auto' : ours;
    if (theirs !== want) {
      localStorage.setItem('starlight-theme', want);
      applyThemeSetting(ours);
    }
  } catch {}
}

/** Wire header controls. Safe to call once per page (idempotent listeners). */
export function initHeader(): void {
  migrateStarlightTheme();
  renderAuth();
  syncThemeIcons();
  markActiveNav();

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyThemeSetting(next);
  });
  document.getElementById('nav-menu-btn')?.addEventListener('click', () => {
    document.getElementById('nav-menu')?.classList.toggle('hidden');
  });

  const openPalette = () => window.dispatchEvent(new Event('zz-open-palette'));
  document.getElementById('nav-search')?.addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (document.querySelector('#zz-palette:not(.hidden)') || focusSearch()) return;
      openPalette();
    }
  });

  window.addEventListener('zz-theme-change', (e) => applyThemeSetting((e as CustomEvent).detail));
  window.addEventListener('zz-session-change', renderAuth);
}
