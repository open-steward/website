import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const designSystem = fileURLToPath(new URL('../../.product/packages/design-system', import.meta.url))
const productDocs = fileURLToPath(new URL('../../.product/docs', import.meta.url))

export default defineConfig({
  site: 'https://opensteward.dev',
  // Every page lives at /<path>/index.html; the CloudFront function redirects /<path> to /<path>/.
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // The Content-Security-Policy allows no inline style or script: everything goes in files.
    inlineStylesheets: 'never',
  },
  integrations: [sitemap()],
  server: { host: true },
  devToolbar: { enabled: false },
  vite: {
    resolve: { alias: { '@design': designSystem, '@product-docs': productDocs } },
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: [repoRoot] } },
  },
})
