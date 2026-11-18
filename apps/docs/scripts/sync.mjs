#!/usr/bin/env node
// Turns the product's Markdown (fetched into .product/ at the commit in product.json) into
// Starlight content:
//
//   - every published page goes to src/content/docs/ with Starlight frontmatter (title,
//     description, edit link), its first heading removed (Starlight prints the title);
//   - links are rewritten: to other pages, to images (copied next to the content, or into
//     public/media/ for raw HTML), to downloads (public/downloads/), and to GitHub at the
//     pinned commit for files outside docs/;
//   - Mermaid diagrams become SVG images (public/diagrams/), one per theme.
//
// It also writes the docs for AI agents into markdown/ (scripts/assemble.mjs publishes them):
// each page as Markdown, with absolute links and its Mermaid diagrams as Mermaid source, plus
// llms.txt and llms-full.txt (see llms.mjs).
//
// The source text is edited in place at the positions the Markdown parser reports, so
// everything else in a page stays exactly as the product wrote it.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import YAML from 'yaml'
import { LOCAL_EDITS, applyLocalEdits } from './local-edits.mjs'
import { DOCS_ORIGIN, absoluteLinks, llmsFull, llmsIndex, markdownUrlFor, pageMarkdown } from './llms.mjs'
import { renderDiagrams } from './mermaid.mjs'
import { contentPathFor, isPublished, resolveLink, urlFor } from './paths.mjs'
import { rewriteSpecLinks } from './spec-links.mjs'
import { platformsMarkdown, writePlatformsCatalogue } from './platforms.mjs'
import { postmanPage } from './postman.mjs'
import { syncReport } from './report.mjs'
import { unlistedPages } from './sections.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(app, '../..')
const product = join(repoRoot, '.product')
const pin = JSON.parse(readFileSync(join(repoRoot, 'product.json'), 'utf8'))
const repo = pin.repository.replace(/\.git$/, '')

const out = {
  content: join(app, 'src/content/docs'),
  media: join(app, 'public/media'),
  downloads: join(app, 'public/downloads'),
  diagrams: join(app, 'public/diagrams'),
  markdown: join(app, 'markdown'),
}
const cacheDir = join(repoRoot, '.cache/mermaid')

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml'])

function walk(dir, prefix = '') {
  const files = []
  for (const entry of readdirSync(join(product, dir), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...walk(join(dir, entry.name), rel))
    else files.push(rel)
  }
  return files
}

function exists(path) {
  const abs = join(product, path)
  if (!existsSync(abs)) return undefined
  return statSync(abs).isDirectory() ? 'dir' : 'file'
}

const textOf = (node) =>
  node.type === 'text' || node.type === 'inlineCode'
    ? node.value
    : (node.children ?? []).map(textOf).join('')

/** The page's description: its first real paragraph, if that comes before any section heading. */
function summary(tree) {
  const firstSection = tree.children.findIndex((node) => node.type === 'heading' && node.depth >= 2)
  const intro = firstSection === -1 ? tree.children : tree.children.slice(0, firstSection)
  const paragraph = intro.find((node) => node.type === 'paragraph' && textOf(node).trim().length > 20)
  if (!paragraph) return undefined
  const text = textOf(paragraph).replace(/\s+/g, ' ').trim()
  if (text.length <= 180) return text
  const cut = text.slice(0, 177)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** The integration guides' frontmatter, shown the way docs-server shows it: one line of facts. */
const AUTH = {
  oauth2: 'OAuth 2.0',
  oauth2_cc: 'OAuth 2.0 (client credentials)',
  oauth1a: 'OAuth 1.0a',
  api_key: 'API key',
  api_key_subdomain: 'API key and subdomain',
  api_key_hmac: 'API key with HMAC signing',
  basic: 'Basic auth',
  session: 'Session',
  local: 'Local',
}

function guideFacts(meta) {
  const facts = []
  if (meta.auth_type) facts.push(`**Auth:** ${AUTH[meta.auth_type] ?? String(meta.auth_type).replace(/_/g, ' ')}`)
  if (meta.partner_program !== undefined) facts.push(`**Partner program:** ${meta.partner_program ? 'required' : 'not required'}`)
  if (meta.estimated_time) facts.push(`**Setup time:** about ${String(meta.estimated_time).replace(/min$/, ' minutes')}`)
  if (meta.last_verified) facts.push(`**Last verified:** ${meta.last_verified}`)
  return facts.length > 0 ? `${facts.join(' · ')}\n\n` : ''
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// ---------------------------------------------------------------------------------------------

rmSync(out.content, { recursive: true, force: true })
for (const dir of Object.values(out)) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

const sources = ['README.md', ...walk('docs').map((p) => `docs/${p}`)].filter(isPublished)
const pages = new Map(sources.map((path) => [path, contentPathFor(path)]))
const seen = new Map()
for (const [path, content] of pages) {
  if (seen.has(content)) throw new Error(`${path} and ${seen.get(content)} both map to ${content}`)
  seen.set(content, path)
}

const copies = new Map()
const diagrams = []
const drafts = []
const unresolved = []

// An edit for a page the product no longer publishes would quietly do nothing.
for (const path of Object.keys(LOCAL_EDITS)) {
  if (!pages.has(path)) throw new Error(`${path} has local edits but is not a published page: remove them from apps/docs/scripts/local-edits.mjs`)
}

for (const [path, contentPath] of pages) {
  const source = applyLocalEdits(path, readFileSync(join(product, path), 'utf8'))
  const tree = parser.parse(source)
  // Each edit has the text for the page and, where it differs, for the Markdown copy (`agent`;
  // null leaves the source as it is there).
  const edits = []
  const edit = (start, end, text, agent = text) => edits.push({ start, end, text, agent })
  // Nodes removed whole: nothing inside them is rewritten.
  const removed = new Set()
  const remove = (node) => {
    removed.add(node)
    edit(node.position.start.offset, node.position.end.offset, '')
  }

  let meta = {}
  const frontmatter = tree.children.find((node) => node.type === 'yaml')
  if (frontmatter) {
    meta = YAML.parse(frontmatter.value) ?? {}
    remove(frontmatter)
  }

  // The title: frontmatter, else the first heading (removed: Starlight prints the title).
  let title = typeof meta.title === 'string' ? meta.title : undefined
  const firstHeading = tree.children.find((node) => node.type === 'heading' && node.depth === 1)
  if (firstHeading) {
    title ??= textOf(firstHeading).trim()
    remove(firstHeading)
  }
  if (path === 'README.md') {
    title = 'OpenSteward'
    // The README opens with the wordmark, which the docs header already shows.
    const logo = tree.children.find((node) => node.type === 'html' && node.value.includes('wordmark'))
    if (logo) remove(logo)
  }
  title ??= posix.basename(path, '.md').replace(/[-_]/g, ' ')

  // The href for the page, and an absolute one for the Markdown copy. Images Astro optimises
  // get their URL only at build time, so the copy points at the file on GitHub instead.
  const resolveBoth = (href, kind) => {
    const result = resolveLink(href, { from: path, kind, pages, exists, repo, commit: pin.commit })
    if (result.copy) copies.set(`${result.copy.kind}:${result.copy.to}`, result.copy)
    if (result.href.startsWith('/') && !result.href.startsWith('//') && result.href === href && !result.route) {
      unresolved.push(`${path}: ${href}`)
    }
    const agent =
      result.copy?.kind === 'content'
        ? `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${pin.commit}/${result.copy.from}`
        : result.href.startsWith('/') && !result.href.startsWith('//')
          ? DOCS_ORIGIN + result.href
          : result.href
    return { href: result.href, agent }
  }
  const rewriteHtml = (html, which) =>
    html.replace(/\b(src|href|srcset)=(["'])([^"']+)\2/g, (all, attr, quote, value) => {
      const kind = attr === 'href' ? 'link' : 'html-image'
      const one = (url) => resolveBoth(url, kind)[which]
      const next = attr === 'srcset'
        ? value.split(',').map((part) => {
            const [url, ...descriptor] = part.trim().split(/\s+/)
            return [one(url), ...descriptor].join(' ')
          }).join(', ')
        : one(value)
      return `${attr}=${quote}${next}${quote}`
    })

  let headingText = title
  visit(tree, (node) => {
    if (removed.has(node)) return 'skip'
    if (node.type === 'heading') headingText = textOf(node).trim()

    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && node.position) {
      const next = resolveBoth(node.url, node.type === 'image' ? 'image' : 'link')
      if (next.href === node.url && next.agent === node.url) return
      const { start, end } = node.position
      const raw = source.slice(start.offset, end.offset)
      // The URL sits after the text: replace its last occurrence inside the node.
      const at = raw.lastIndexOf(node.url)
      if (at === -1) throw new Error(`${path}:${start.line}: cannot find ${node.url} in ${raw}`)
      edit(start.offset + at, start.offset + at + node.url.length, next.href, next.agent)
    }

    if (node.type === 'html' && node.position) {
      const rewritten = rewriteHtml(node.value, 'href')
      if (/<script\b/i.test(rewritten)) throw new Error(`${path}: raw <script> in Markdown`)
      const forAgents = rewriteHtml(node.value, 'agent')
      if (rewritten !== node.value || forAgents !== node.value) {
        edit(node.position.start.offset, node.position.end.offset, rewritten, forAgents)
      }
    }

    if (node.type === 'code' && node.lang === 'mermaid' && node.position) {
      const id = `${contentPath}#${diagrams.length}`
      diagrams.push({ id, source: node.value, alt: `Diagram: ${headingText}` })
      // The Markdown copy keeps the Mermaid source, which an agent reads better than a picture.
      edit(node.position.start.offset, node.position.end.offset, `<!--diagram:${id}-->`, null)
    }
  })

  // Apply from the end, so earlier offsets stay valid. Nested edits never overlap: a link's
  // edit lies inside nodes that are not edited themselves.
  edits.sort((a, b) => b.start - a.start)
  let body = source
  let agentBody = source
  let previousStart = Infinity
  for (const { start, end, text, agent } of edits) {
    if (end > previousStart) throw new Error(`${path}: overlapping edits at ${start}`)
    body = body.slice(0, start) + text + body.slice(end)
    if (agent !== null) agentBody = agentBody.slice(0, start) + agent + agentBody.slice(end)
    previousStart = start
  }
  body = body.replace(/^\s+/, '')
  agentBody = agentBody.replace(/^\s+/, '')
  if (meta.vertical && meta.platform) {
    body = guideFacts(meta) + body
    agentBody = guideFacts(meta) + agentBody
  }

  const description = summary(tree)
  const front = {
    title,
    ...(description ? { description } : {}),
    editUrl: `${repo}/edit/main/${path}`,
    ...(posix.basename(contentPath) === 'index.md' && contentPath !== 'index.md'
      ? { sidebar: { label: 'Overview', order: 0 } }
      : {}),
    ...(meta.vertical && meta.platform ? { sidebar: { label: title.replace(/^Integrating /, '') } } : {}),
  }
  drafts.push({ contentPath, front, body, agentBody })
}

// Diagrams: render (or take from the cache), then put the images where the markers are.
const rendered = await renderDiagrams(diagrams, cacheDir)
const diagramHtml = new Map()
const failed = []
for (const diagram of diagrams) {
  const { light, dark, error } = rendered.get(diagram.id)
  if (error) {
    failed.push(`${diagram.id}: ${error}`)
    diagramHtml.set(diagram.id, `\n\`\`\`mermaid\n${diagram.source}\n\`\`\`\n`)
    continue
  }
  for (const variant of [light, dark]) writeFileSync(join(out.diagrams, variant.name), variant.svg)
  const img = (variant, cls) =>
    `<img class="diagram ${cls}" src="/diagrams/${variant.name}" alt="${escapeHtml(diagram.alt)}" width="${variant.width}" height="${variant.height}" loading="lazy" decoding="async">`
  diagramHtml.set(
    diagram.id,
    // Each image links to its SVG, so a wide diagram can be opened full size (and zoomed on a phone).
    `<figure class="diagram-figure">\n<a href="/diagrams/${light.name}" class="dark:sl-hidden">${img(light, '')}</a>\n<a href="/diagrams/${dark.name}" class="light:sl-hidden">${img(dark, '')}</a>\n</figure>`,
  )
}

const postman = postmanPage({ repo, commit: pin.commit, exists })
drafts.push({ ...postman, agentBody: absoluteLinks(postman.body) })
for (const file of postman.downloads) copies.set(`download:${file.to}`, file)

// A page in no sidebar section would be built but reachable only by its links.
const unlisted = unlistedPages(drafts.map((d) => d.contentPath))
if (unlisted.length > 0) {
  throw new Error(
    `${unlisted.length} page(s) in no sidebar section: ${unlisted.join(', ')}. ` +
      'Give each a place in apps/docs/scripts/sections.mjs (TOP for a page, GROUPS for a directory).',
  )
}

for (const { contentPath, front, body } of drafts) {
  const text = body.replace(/<!--diagram:([^>]+)-->/g, (_, id) => diagramHtml.get(id))
  const file = join(out.content, contentPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `---\n${YAML.stringify(front, { lineWidth: 0 })}---\n\n${text}`)
}

// The docs for AI agents.
const markdown = new Map()
for (const { contentPath, front, agentBody } of drafts) {
  const text = pageMarkdown({ title: front.title, description: front.description, body: agentBody })
  markdown.set(contentPath, text)
  const file = join(out.markdown, markdownUrlFor(contentPath))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
// /platforms/ is a page of src/pages/ (the product's catalogue). Its Markdown copy is the
// product's table, under the content path that gives it that URL.
const platformsPage = platformsMarkdown(readFileSync(join(product, 'docs/platforms/platforms.md'), 'utf8'))
markdown.set('platforms.md', pageMarkdown(platformsPage))
writeFileSync(join(out.markdown, markdownUrlFor('platforms.md')), markdown.get('platforms.md'))
const docsSummary =
  "OpenSteward is a source-available, self-hosted unified API: one REST API across accounting, CRM, e-commerce, logistics, payments, e-signature, projects, customer support and inventory platforms, running on your own servers so your customers' data stays there."
const index = llmsIndex({
  pages: new Map([
    ...drafts.map((d) => [d.contentPath, { title: d.front.title, description: d.front.description }]),
    ['platforms.md', { title: platformsPage.title, description: platformsPage.description }],
  ]),
  downloads: postman.links,
  summary: docsSummary,
  commit: pin.commit,
})
writeFileSync(join(out.markdown, 'llms.txt'), index.text)
writeFileSync(join(out.markdown, 'llms-full.txt'), llmsFull({ order: index.order, markdown, summary: docsSummary }))

/** Links in the specs and collections that point at no page here: nothing else checks those. */
const unplacedSpecLinks = []
for (const { from, to, kind } of copies.values()) {
  const base = kind === 'content' ? out.content : kind === 'media' ? out.media : out.downloads
  const target = join(base, to)
  mkdirSync(dirname(target), { recursive: true })
  if (kind === 'download' && /\.(json|ya?ml)$/.test(to)) {
    // Specs and collections: their docs-server links point at this site's pages instead.
    const resolve = (href) => {
      const result = resolveLink(href, { from, kind: 'link', pages, exists, repo, commit: pin.commit })
      if (result.copy) copies.set(`${result.copy.kind}:${result.copy.to}`, result.copy)
      return result.href === href && !result.route ? null : result.href
    }
    const { text, unresolved: missed } = rewriteSpecLinks(readFileSync(join(product, from), 'utf8'), resolve)
    for (const href of missed) unplacedSpecLinks.push(`${from}: ${href}`)
    writeFileSync(target, text)
  } else {
    copyFileSync(join(product, from), target)
  }
}

await writePlatformsCatalogue({ productDir: product, appDir: app, clientId: process.env.BRANDFETCH_CLIENT_ID })

console.log(
  `docs: ${drafts.length} pages, ${diagrams.length} diagrams, ${copies.size} files copied` +
    (unresolved.length ? `; ${unresolved.length} absolute links left as written` : ''),
)
for (const line of unresolved) console.log(`  unresolved: ${line}`)
for (const line of failed) console.warn(`  diagram shown as source, Mermaid could not parse it: ${line}`)
for (const line of unplacedSpecLinks) console.warn(`  spec link to no page on this site: ${line}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    syncReport({
      commit: pin.commit,
      pages: drafts.length,
      diagrams: diagrams.length,
      files: copies.size,
      unresolved: [...unresolved, ...unplacedSpecLinks],
      failed,
    }),
  )
}
// DOCS_STRICT=1 (CI sets it on the product sync's branch, which merges by itself): a diagram
// shown as source or a spec link to nowhere stops the build instead of shipping with a warning.
if (process.env.DOCS_STRICT === '1' && failed.length + unplacedSpecLinks.length > 0) {
  throw new Error(
    `DOCS_STRICT=1: ${failed.length} diagram(s) Mermaid could not parse and ${unplacedSpecLinks.length} spec link(s) to no page here (listed above)`,
  )
}
export { urlFor }
