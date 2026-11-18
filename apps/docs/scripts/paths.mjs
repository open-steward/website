// Where each file of the product repository lands on docs.opensteward.dev, and what each link
// in its Markdown points at once it is there. Pure functions: sync.mjs does the file work.
//
// Paths are POSIX and relative to the product repository root (`docs/admin/status.md`).

import { posix } from 'node:path'

const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif)$/i
const DOWNLOAD = /\.(json|ya?ml)$/i

/**
 * Product pages (and directories) this site replaces with a page of its own, and links to them
 * go there instead. The generated one-page API reference repeats the Swagger UI page, and lists
 * its parameters as `undefined`. The platform table is the product's catalogue at /platforms/
 * (src/pages/platforms/), as on docs-server, and is that page's Markdown copy.
 */
const REPLACED = new Map([
  ['docs/api-reference/api-reference.md', '/unified-api/'],
  ['docs/api-reference', '/unified-api/'],
  ['docs/platforms/platforms.md', '/platforms/'],
  ['docs/platforms', '/platforms/'],
])

/** Markdown files that become pages: the root README and everything under docs/ but drafts. */
export function isPublished(path) {
  if (path === 'README.md') return true
  if (REPLACED.has(path)) return false
  if (!path.startsWith('docs/') || !path.endsWith('.md')) return false
  return !path.split('/').some((segment) => segment.startsWith('_'))
}

/**
 * The content file for a page, relative to src/content/docs/. The root README is the docs home;
 * docs/README.md (the map of generated artifacts) becomes /overview/; a directory's README is
 * its index page. Names are lower-cased so the file name is the URL.
 */
export function contentPathFor(path) {
  if (path === 'README.md') return 'index.md'
  if (path === 'docs/README.md') return 'overview.md'
  const rel = path.slice('docs/'.length)
  const dir = posix.dirname(rel)
  const base = posix.basename(rel)
  const name = base === 'README.md' ? 'index.md' : base.toLowerCase()
  return (dir === '.' ? name : `${dir}/${name}`).toLowerCase()
}

/** The page URL path for a content file: `admin/status.md` -> `/admin/status/`. */
export function urlFor(contentPath) {
  const withoutExt = contentPath.replace(/\.md$/, '')
  const trimmed = withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

/** Images referenced with Markdown syntax are copied next to the content and optimised by Astro. */
export function contentImagePathFor(path) {
  return path.startsWith('docs/') ? path.slice('docs/'.length) : `_product/${path}`
}

/** Images in raw HTML are not processed by Astro, so they are served from public/media/. */
export const mediaUrlFor = (path) => `/media/${path}`

/** Data files under docs/ (the OpenAPI specs, Postman collections) are served for download. */
export const downloadUrlFor = (path) => `/downloads/${path.slice('docs/'.length)}`

export const githubUrlFor = (repo, commit, path, isDirectory) =>
  `${repo.replace(/\.git$/, '')}/${isDirectory ? 'tree' : 'blob'}/${commit}/${path}`

/** docs-server routes some product docs link to, and where they live here. */
const DOCS_SERVER_ROUTES = [
  [/^\/platforms(\/.*)?$/, '/platforms/'],
  // The Unified API: its route before the rename, and after.
  [/^\/api-reference(\/.*)?$/, '/unified-api/'],
  [/^\/unified-api(\/.*)?$/, '/unified-api/'],
  [/^\/operator-api(\/.*)?$/, '/operator-api/'],
  [/^\/postman(\/.*)?$/, '/postman/'],
]

function splitHash(href) {
  const at = href.search(/[?#]/)
  return at === -1 ? [href, ''] : [href.slice(0, at), href.slice(at)]
}

/**
 * Resolves one link or image reference.
 *
 * @param {string} href        as written in the Markdown
 * @param {object} ctx
 * @param {string} ctx.from    product path of the file the link is in
 * @param {'link'|'image'|'html-image'} ctx.kind
 * @param {Map<string,string>} ctx.pages   product path -> content path, for published pages
 * @param {(path: string) => 'file'|'dir'|undefined} ctx.exists  what the path is in the product repo,
 *        or undefined when the sparse checkout does not hold it (outside docs/)
 * @param {string} ctx.repo, ctx.commit   for GitHub links
 * @returns {{ href: string, copy?: { from: string, to: string, kind: 'content'|'media'|'download' } }}
 */
export function resolveLink(href, ctx) {
  const trimmed = href.trim()
  if (trimmed === '' || trimmed.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    return { href }
  }

  const [rawPath, tail] = splitHash(trimmed)
  let path = decodeURIComponentSafe(rawPath)

  if (path.startsWith('/')) {
    if (path.startsWith('/guides')) {
      path = posix.join('docs', path.slice('/guides'.length)) || 'docs'
    } else {
      for (const [pattern, target] of DOCS_SERVER_ROUTES) {
        if (pattern.test(path)) return { href: target + tail, route: true }
      }
      return { href }
    }
  } else {
    path = posix.normalize(posix.join(posix.dirname(ctx.from), path))
  }
  if (path.startsWith('..')) return { href } // outside the repository: leave it for the link check
  const wantsDir = rawPath.endsWith('/') || path === '.' || path === 'docs'
  path = path.replace(/\/$/, '')
  if (path === '.') path = ''
  if (REPLACED.has(path)) return { href: REPLACED.get(path) + tail }

  const kind = ctx.exists(path) ?? (wantsDir || posix.extname(path) === '' ? 'dir' : 'file')

  if (kind === 'dir') {
    for (const index of ['README.md', 'index.md']) {
      const candidate = path === '' ? index : `${path}/${index}`
      const content = ctx.pages.get(candidate)
      if (content !== undefined) return { href: urlFor(content) + tail }
    }
    return { href: githubUrlFor(ctx.repo, ctx.commit, path, true) + tail }
  }

  const page = ctx.pages.get(path)
  if (page !== undefined) {
    if (ctx.kind !== 'link') return { href }
    return { href: urlFor(page) + tail }
  }

  if (IMAGE.test(path) && ctx.exists(path) === 'file') {
    if (ctx.kind === 'image') {
      const to = contentImagePathFor(path)
      const fromDir = posix.dirname(contentPathFor(ctx.from))
      let rel = posix.relative(fromDir, to)
      if (!rel.startsWith('.')) rel = `./${rel}`
      return { href: rel + tail, copy: { from: path, to, kind: 'content' } }
    }
    return { href: mediaUrlFor(path) + tail, copy: { from: path, to: path, kind: 'media' } }
  }

  if (path.startsWith('docs/') && DOWNLOAD.test(path) && ctx.exists(path) === 'file') {
    return { href: downloadUrlFor(path) + tail, copy: { from: path, to: path.slice('docs/'.length), kind: 'download' } }
  }

  return { href: githubUrlFor(ctx.repo, ctx.commit, path, false) + tail }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
