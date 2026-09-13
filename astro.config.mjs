// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
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
  integrations: [
    starlight({
      title: site.siteName,
      social: [
        { icon: 'github', label: 'GitHub', href: site.githubRepo },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started' },
          ],
        },
        {
          label: 'Language',
          items: [
            { label: 'Syntax', slug: 'syntax' },
            { label: 'Modules', slug: 'modules' },
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
