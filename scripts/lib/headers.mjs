// The Content-Type and Cache-Control each bucket key is uploaded with. The deploy (deploy.mjs)
// and the local preview (preview.mjs) both use this, so the preview behaves like CloudFront.
//
// The Free plan allows only AWS's managed cache policies, so caching is steered by the
// objects' own Cache-Control, which CachingOptimized honours:
//   - content-hashed files (Astro's _astro/, the docs' diagrams) never change: one year;
//   - pages and their Markdown copies, the sitemap and the search index change with every
//     deploy: five minutes (the deploy also invalidates the distribution, so the edge
//     refreshes at once);
//   - everything else (icons, screenshots, downloads, the theme scripts): one hour.

const YEAR = 'public, max-age=31536000, immutable'
const SHORT = 'public, max-age=300'
const HOUR = 'public, max-age=3600'

const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  // Pagefind's index files.
  pagefind: 'application/octet-stream',
  pf_fragment: 'application/octet-stream',
  pf_index: 'application/octet-stream',
  pf_meta: 'application/octet-stream',
}

export function contentTypeFor(key) {
  const dot = key.lastIndexOf('.')
  const ext = dot === -1 ? '' : key.slice(dot + 1).toLowerCase()
  const type = TYPES[ext]
  if (type === undefined) throw new Error(`no Content-Type for ${key}: add its extension to scripts/lib/headers.mjs`)
  return type
}

export function cacheControlFor(key) {
  if (key.startsWith('_astro/') || key.startsWith('docs/diagrams/')) return YEAR
  if (/\.(html|md|xml|txt|webmanifest)$/.test(key) || key.startsWith('docs/pagefind/')) return SHORT
  return HOUR
}

/** Keys that hold content-hashed files. */
export const isHashed = (key) => key.startsWith('_astro/') || key.startsWith('docs/diagrams/')

/**
 * Files a page may still load after the deploy that dropped them (its scripts, styles, fonts,
 * diagrams, the search index): deploy.mjs keeps them for a while instead of deleting them.
 */
export const keepWhenStale = (key) => isHashed(key) || key.startsWith('docs/pagefind/')

/** Upload order: what pages refer to goes first, the pages last. */
export function uploadRank(key) {
  if (isHashed(key)) return 0
  if (key.endsWith('.html')) return 2
  return 1
}
