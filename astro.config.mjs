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
  // Starlight serves docs at site root; redirect spec /docs/* URLs there.
  redirects: {
    '/docs': '/getting-started',
    '/docs/getting-started': '/getting-started',
    '/docs/syntax': '/syntax',
    '/docs/modules': '/stdlib/overview',
    '/docs/language-reference': '/language-reference',
    '/docs/error-handling': '/error-handling',
    '/docs/best-practices': '/best-practices',
    '/docs/async-sockets': '/async-sockets',
    '/docs/advanced': '/advanced',
    '/docs/stdlib': '/stdlib/overview',
    '/docs/stdlib/overview': '/stdlib/overview',
    '/docs/stdlib/str': '/stdlib/str',
    '/docs/stdlib/vec': '/stdlib/vec',
    '/docs/stdlib/json': '/stdlib/json',
    '/docs/stdlib/http': '/stdlib/http',
    '/docs/stdlib/fs': '/stdlib/fs',
    '/docs/stdlib/env': '/stdlib/env',
    '/docs/stdlib/math': '/stdlib/math',
    '/docs/stdlib/time': '/stdlib/time',
    '/docs/stdlib/encoding': '/stdlib/encoding',
    '/docs/stdlib/net': '/stdlib/net',
  },
  integrations: [
    react(),
    starlight({
      title: site.siteName,
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
