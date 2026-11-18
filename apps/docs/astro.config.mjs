import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import { BOTTOM, GROUPS, TOP, sidebarEntry, slugFor, sortInGroup, verticalLabel } from './scripts/sections.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const group = (label, directory) => ({
  label,
  collapsed: true,
  items: [{ autogenerate: { directory, collapsed: true } }],
})

// The integration guides: the pages in integrate/, then one group per vertical (autogenerate
// would name them after the directories).
const integrateDir = fileURLToPath(new URL('./src/content/docs/integrate', import.meta.url))
// scripts/sync.mjs writes the content before every build (pnpm build runs it first).
if (!existsSync(integrateDir)) throw new Error('no docs content: run `pnpm build` (or node scripts/sync.mjs) first')
const integrationGuides = (label) => ({
  label,
  collapsed: true,
  items: [
    ...readdirSync(integrateDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => `integrate/${name}`)
      .sort(sortInGroup)
      .map(slugFor),
    ...readdirSync(integrateDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .map((dir) => group(verticalLabel(dir), `integrate/${dir}`)),
  ],
})

export default defineConfig({
  site: 'https://docs.opensteward.dev',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // The Content-Security-Policy allows no inline style or script: everything goes in files.
    inlineStylesheets: 'never',
  },
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'OpenSteward Docs',
      description: "Documentation for OpenSteward, the self-hosted integration API: your customers' data, on your servers.",
      logo: {
        light: './src/assets/mark.svg',
        dark: './src/assets/mark-dark.svg',
        alt: 'OpenSteward',
      },
      favicon: '/brand/mark.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '48x48' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/brand/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#3D5A33' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://opensteward.dev/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      social: [
        { icon: 'github', label: 'OpenSteward on GitHub', href: 'https://github.com/open-steward/opensteward' },
      ],
      // theme.css brings in the design system's tokens.css.
      customCss: ['./src/styles/theme.css'],
      components: {
        // Starlight's own versions inline small scripts or style attributes, which the
        // Content-Security-Policy does not allow. These do the same from files.
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Search: './src/components/Search.astro',
        Sidebar: './src/components/Sidebar.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        Footer: './src/components/Footer.astro',
      },
      // scripts/sections.mjs: the same list makes the llms.txt index.
      sidebar: [
        ...TOP.map(sidebarEntry),
        ...GROUPS.map((g) => (g.directory === 'integrate' ? integrationGuides(g.label) : group(g.label, g.directory))),
        ...BOTTOM.map(sidebarEntry),
      ],
      pagefind: true,
      lastUpdated: false,
    }),
  ],
  vite: {
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: [repoRoot] } },
  },
})
