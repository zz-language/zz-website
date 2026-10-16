// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ZZ grammar for Shiki
const zzGrammar = JSON.parse(readFileSync(resolve(__dirname, 'src/grammars/zz.tmLanguage.json'), 'utf-8'));

import site from './src/config/site.json';

// https://astro.build/config
export default defineConfig({
  site: site.domain,
  // Fully static on Cloudflare Pages. Pretty registry URLs (/pkg/[name],
  // /u/[username]) are NOT prerendered (getStaticPaths returns []): the
  // Pages Functions fallback (functions/pkg/[name].ts, functions/u/[username].ts)
  // serves the shell for any name, so publishing never needs a rebuild
  // and builds never crawl the registry (fast rebuilds).
  // Docs live under /docs/* via the Pages middleware rewrite
  // (functions/_middleware.ts maps /docs/<slug> to the Starlight page,
  // URL preserved); /docs/ itself is the docs hub (src/pages/docs.astro).
  // NOTE: no /docs/* entries may exist in `redirects` — Pages applies
  // static redirects before Functions, which would shadow the rewrite.
  integrations: [
    react(),
    starlight({
      title: site.siteName,
      // Docs chrome reuses the main-site bar (same height, blur, controls).
      components: {
        Header: './src/components/starlight/SiteHeader.astro',
        Head: './src/components/starlight/Head.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: site.githubRepo },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ label: 'Introduction', slug: 'getting-started' }],
        },
        {
          label: 'Language',
          items: [
            { label: 'Syntax', slug: 'syntax' },
            { label: 'Language Reference', slug: 'language-reference' },
            { label: 'Error Handling', slug: 'error-handling' },
            { label: 'Best Practices', slug: 'best-practices' },
          ],
        },
        {
          label: 'Standard Library',
          items: [
            { label: 'Overview', slug: 'stdlib/overview' },
            { label: 'std.str', slug: 'stdlib/str' },
            { label: 'std.vec', slug: 'stdlib/vec' },
            { label: 'std.json', slug: 'stdlib/json' },
            { label: 'std.http', slug: 'stdlib/http' },
            { label: 'std.fs', slug: 'stdlib/fs' },
            { label: 'std.env', slug: 'stdlib/env' },
            { label: 'std.math', slug: 'stdlib/math' },
            { label: 'std.time', slug: 'stdlib/time' },
            { label: 'std.encoding', slug: 'stdlib/encoding' },
            { label: 'std.net', slug: 'stdlib/net' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Async Sockets', slug: 'async-sockets' },
            { label: 'Advanced Features', slug: 'advanced' },
          ],
        },
      ],
      customCss: ['./src/styles/global.css'],
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: site.domain + site.ogImage } },
        { tag: 'meta', attrs: { property: 'og:title', content: site.siteName } },
        { tag: 'meta', attrs: { property: 'og:description', content: site.tagline } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      expressiveCode: {
        shiki: {
          langs: [zzGrammar],
        },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
