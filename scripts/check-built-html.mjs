#!/usr/bin/env node
// Checks the assembled build (out/, see assemble.mjs) against what the CloudFront functions
// promise, before anything is uploaded:
//
//   1. No page carries inline script, <style>, style="" or on*="" attributes, or javascript:
//      URLs. The Content-Security-Policy (infra/functions/viewer-response.js) allows none of
//      them, so any that appear would be blocked in the browser.
//   2. No page loads anything from another origin: scripts, styles, images, fonts and frames
//      all come from the site itself (no third parties, no tracking).
//   3. Every link and asset between and inside the two sites resolves to a file in the build.
//      Links to a #fragment that no element has are reported too: as errors on the marketing
//      site, as warnings in the product docs (they come from the product repository).
//   4. The Markdown copies for agents: every page's <link rel="alternate"> and every link in
//      the two llms.txt files on these hosts resolves.
//
//   node scripts/check-built-html.mjs [out]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import { Parser } from 'htmlparser2'
import { contentTypeFor } from './lib/headers.mjs'

const outDir = process.argv[2] ?? 'out'
const HOSTS = { 'opensteward.dev': 'site', 'docs.opensteward.dev': 'docs' }
const ALLOWED_SCRIPT_TYPES = new Set(['application/ld+json', 'application/json'])

const errors = []
const warnings = []

function htmlFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...htmlFiles(path))
    else if (entry.name.endsWith('.html')) files.push(path)
  }
  return files
}

const parsed = new Map()
/** Elements, ids and links of one page. */
function parse(file) {
  if (parsed.has(file)) return parsed.get(file)
  const page = { ids: new Set(), refs: [], inline: [] }
  let inScript = null
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (attrs.id) page.ids.add(attrs.id)
        if (name === 'a' && attrs.name) page.ids.add(attrs.name)
        for (const [attr, value] of Object.entries(attrs)) {
          if (/^on[a-z]+$/i.test(attr)) page.inline.push(`${attr}="" on <${name}>`)
          if (attr === 'style') page.inline.push(`style="${value.slice(0, 40)}" on <${name}>`)
          if (/^\s*javascript:/i.test(value)) page.inline.push(`javascript: URL in ${attr} on <${name}>`)
        }
        if (name === 'style') page.inline.push('<style> element')
        if (name === 'script') {
          if (attrs.src) page.refs.push({ kind: 'script', url: attrs.src })
          else if (!ALLOWED_SCRIPT_TYPES.has((attrs.type ?? '').toLowerCase())) inScript = ''
        }
        if (name === 'a' && attrs.href) page.refs.push({ kind: 'link', url: attrs.href })
        if (name === 'link' && attrs.href) {
          const rel = (attrs.rel ?? '').toLowerCase()
          const kind = /stylesheet|icon|manifest|preload|modulepreload|apple-touch-icon/.test(rel)
            ? 'asset'
            : rel === 'alternate'
              ? 'alternate'
              : 'meta'
          page.refs.push({ kind, url: attrs.href })
        }
        for (const attr of ['src', 'poster', 'data']) {
          if (attrs[attr] && name !== 'script') page.refs.push({ kind: 'asset', url: attrs[attr] })
        }
        if (attrs.srcset) {
          for (const part of attrs.srcset.split(',')) page.refs.push({ kind: 'asset', url: part.trim().split(/\s+/)[0] })
        }
        if (['iframe', 'object', 'embed', 'frame'].includes(name)) page.inline.push(`<${name}> element`)
        if (name === 'form' && attrs.action) page.refs.push({ kind: 'asset', url: attrs.action })
      },
      ontext(text) {
        if (inScript !== null) inScript += text
      },
      onclosetag(name) {
        if (name === 'script' && inScript !== null) {
          if (inScript.trim() !== '') page.inline.push(`inline <script>: ${inScript.trim().slice(0, 60)}`)
          inScript = null
        }
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: true },
  )
  parser.write(readFileSync(file, 'utf8'))
  parser.end()
  parsed.set(file, page)
  return page
}

/** The file a URL path resolves to on one of the two sites, as the viewer-request function does. */
function fileFor(site, pathname) {
  if (pathname.startsWith('/_astro/')) return join(outDir, pathname)
  let path = decodeURIComponent(pathname)
  if (path.endsWith('/')) path += 'index.html'
  else if (!posix.basename(path).includes('.')) path += '/index.html' // the function redirects
  return join(outDir, site, path)
}

const SPECIAL_SITE_FILES = new Set(['/license', '/license/'])

function check(file, site) {
  const page = parse(file)
  const where = relative(outDir, file)
  for (const problem of page.inline) errors.push(`${where}: ${problem}`)

  const pagePath = `/${relative(join(outDir, site), file).replace(/index\.html$/, '').replace(/\\/g, '/')}`
  const base = new URL(pagePath, `https://${site === 'site' ? 'opensteward.dev' : 'docs.opensteward.dev'}`)

  for (const ref of page.refs) {
    if (ref.kind === 'meta') continue
    let url
    try {
      url = new URL(ref.url, base)
    } catch {
      errors.push(`${where}: unparseable URL ${ref.url}`)
      continue
    }
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') continue
    const targetSite = HOSTS[url.hostname]

    if (ref.kind !== 'link') {
      // Scripts, styles, images, fonts: same site only.
      if (url.protocol !== 'https:' || targetSite !== site) {
        errors.push(`${where}: loads ${ref.url} from another origin`)
        continue
      }
    }
    if (targetSite === undefined) continue // an outside link

    if (targetSite === 'site' && SPECIAL_SITE_FILES.has(url.pathname)) continue // the redirect
    const target = fileFor(targetSite, url.pathname)
    if (!existsSync(target) || !statSync(target).isFile()) {
      const message = `${where}: ${ref.url} does not resolve (${relative(outDir, target)})`
      ;(site === 'docs' && ref.kind === 'link' ? warnings : errors).push(message)
      continue
    }
    if (url.hash && url.hash !== '#' && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1))
      if (!parse(target).ids.has(id)) {
        const message = `${where}: ${ref.url} has no element with id "${id}"`
        ;(site === 'site' ? errors : warnings).push(message)
      }
    }
  }
}

for (const site of ['site', 'docs']) {
  const dir = join(outDir, site)
  if (!existsSync(dir)) {
    errors.push(`${dir} is missing: run the build first`)
    continue
  }
  for (const file of htmlFiles(dir)) check(file, site)
}
// The error page is served on both hosts, so a root-relative link in it would point at the
// wrong site on one of them; only the shared /_astro/ assets may be root-relative.
const errorPage = join(outDir, '404.html')
if (existsSync(errorPage)) {
  check(errorPage, 'site')
  for (const ref of parse(errorPage).refs) {
    if (ref.kind === 'meta') continue
    if (ref.url.startsWith('/') && !ref.url.startsWith('//') && !ref.url.startsWith('/_astro/')) {
      const sharedFile = ['/favicon.ico', '/brand/'].some((p) => ref.url.startsWith(p)) && ref.kind === 'asset'
      if (!sharedFile) errors.push(`404.html: root-relative ${ref.url} would differ between the two hosts`)
    }
  }
} else errors.push('404.html is missing at the bucket root')

// The agents' indexes: Markdown links to these two hosts must resolve.
for (const site of ['site', 'docs']) {
  const index = join(outDir, site, 'llms.txt')
  if (!existsSync(index)) {
    errors.push(`${site}/llms.txt is missing`)
    continue
  }
  for (const [, href] of readFileSync(index, 'utf8').matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) {
    const url = new URL(href)
    const targetSite = HOSTS[url.hostname]
    if (targetSite === undefined) continue
    const target = fileFor(targetSite, url.pathname)
    if (!existsSync(target)) errors.push(`${site}/llms.txt: ${href} does not resolve (${relative(outDir, target)})`)
  }
}

// Every file must have a Content-Type the deploy knows (scripts/lib/headers.mjs).
for (const file of readdirSync(outDir, { recursive: true })) {
  const path = join(outDir, file)
  if (!statSync(path).isFile()) continue
  try {
    contentTypeFor(file.split('\\').join('/'))
  } catch (error) {
    errors.push(error.message)
  }
}

const showWarnings = process.env.CHECK_HTML_WARNINGS === 'all' ? warnings : warnings.slice(0, 20)
for (const warning of showWarnings) console.warn(`warning: ${warning}`)
if (showWarnings.length < warnings.length) {
  console.warn(`warning: … and ${warnings.length - showWarnings.length} more (CHECK_HTML_WARNINGS=all lists them)`)
}
for (const error of errors) console.error(`error: ${error}`)
console.log(`checked ${parsed.size} pages: ${errors.length} errors, ${warnings.length} warnings`)
// DOCS_STRICT=1 (CI sets it on the product sync's branch, which merges by itself): the docs'
// broken links and anchors fail the check too, instead of shipping with a warning no one reads.
const strict = process.env.DOCS_STRICT === '1'
if (strict && warnings.length > 0) console.error(`error: ${warnings.length} warnings, and DOCS_STRICT=1 fails on them`)
process.exit(errors.length === 0 && !(strict && warnings.length > 0) ? 0 : 1)
