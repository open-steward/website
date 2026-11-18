#!/usr/bin/env node
// Lays the two builds out the way the bucket holds them, in out/:
//
//   out/site/...     apps/site/dist, without _astro/   served on opensteward.dev
//   out/docs/...     apps/docs/dist, without _astro/   served on docs.opensteward.dev
//   out/_astro/...   both builds' content-hashed assets, shared by both hosts
//   out/404.html     the site's 404 page, which CloudFront's error response fetches
//
// and adds the Markdown copies for AI agents: each page's at its URL plus `.md`, linked from the
// page's <head>. The docs' come from apps/docs/scripts/sync.mjs (from the product's Markdown);
// the site's are made here from its built pages.
//
// Hashed file names mean the same name always holds the same bytes; a name both builds use
// with different bytes stops the build.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StyleCollector, linkStylesheet } from './lib/externalize-styles.mjs'
import { pageToMarkdown } from './lib/html-to-markdown.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out')
const builds = { site: join(root, 'apps/site/dist'), docs: join(root, 'apps/docs/dist') }
const origins = { site: 'https://opensteward.dev', docs: 'https://docs.opensteward.dev' }

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, '_astro'), { recursive: true })

for (const [name, dist] of Object.entries(builds)) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} has no index.html: build ${name} first`)
  cpSync(dist, join(out, name), {
    recursive: true,
    filter: (src) => src !== join(dist, '_astro') && !src.startsWith(join(dist, '.prerender')),
  })
  const assets = join(dist, '_astro')
  if (!existsSync(assets)) continue
  for (const file of readdirSync(assets, { recursive: true })) {
    const from = join(assets, file)
    if (statSync(from).isDirectory()) continue
    const to = join(out, '_astro', file)
    if (existsSync(to)) {
      if (!readFileSync(to).equals(readFileSync(from))) throw new Error(`_astro/${file} differs between the builds`)
      continue
    }
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
  }
}

cpSync(join(out, 'site/404.html'), join(out, '404.html'))

// Markdown for agents.
const docsMarkdown = join(root, 'apps/docs/markdown')
if (!existsSync(join(docsMarkdown, 'llms.txt'))) throw new Error('apps/docs/markdown/ is empty: run the docs sync first')
cpSync(docsMarkdown, join(out, 'docs'), { recursive: true, force: false, errorOnExist: true })
for (const file of htmlFiles(join(out, 'site'))) {
  const page = pagePath(join(out, 'site'), file)
  if (page === null) continue
  writeFileSync(markdownFileFor(join(out, 'site'), page), pageToMarkdown(readFileSync(file, 'utf8'), origins.site + page))
}
let alternates = 0
for (const name of Object.keys(builds)) {
  const dir = join(out, name)
  for (const file of htmlFiles(dir)) {
    const page = pagePath(dir, file)
    if (page === null || !existsSync(markdownFileFor(dir, page))) continue
    const href = markdownFileFor('', page)
    const html = readFileSync(file, 'utf8')
    const at = html.indexOf('</head>')
    writeFileSync(file, `${html.slice(0, at)}<link rel="alternate" type="text/markdown" href="${href}">${html.slice(at)}`)
    alternates += 1
  }
}
console.log(`linked ${alternates} pages to their Markdown copies`)

// style="" attributes (Expressive Code writes one per highlighted token) move into one shared
// stylesheet: the Content-Security-Policy allows no inline styles.
const collector = new StyleCollector()
const rewritten = []
for (const file of htmlFiles(out)) {
  const { html, changed } = collector.rewrite(readFileSync(file, 'utf8'))
  if (changed) rewritten.push([file, html])
}
if (rewritten.length > 0) {
  const { text, name } = collector.stylesheet()
  writeFileSync(join(out, '_astro', name), text)
  for (const [file, html] of rewritten) writeFileSync(file, linkStylesheet(html, `/_astro/${name}`))
  console.log(`moved ${collector.classes.size} distinct inline styles from ${rewritten.length} pages into _astro/${name}`)
}
console.log('assembled out/: site/, docs/, _astro/, 404.html')

/** A page's URL path (`/security/`), or null for what is not a page of its own (404.html). */
function pagePath(dir, file) {
  const rel = file.slice(dir.length + 1).split('\\').join('/')
  if (rel === 'index.html') return '/'
  if (!rel.endsWith('/index.html')) return null
  return `/${rel.slice(0, -'index.html'.length)}`
}

/** Where a page's Markdown copy is: `/security/` -> <dir>/security.md, `/` -> <dir>/index.md. */
function markdownFileFor(dir, page) {
  return `${dir}${page === '/' ? '/index' : page.slice(0, -1)}.md`
}

function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((file) => file.endsWith('.html'))
    .map((file) => join(dir, file))
}
