// The Platforms page (/platforms/): the product's own catalogue from packages/platforms-ui at the
// pinned commit, as on its docs-server. The site's Content-Security-Policy allows no inline code,
// so the catalogue's styles and script are written to files that the page imports (Astro emits
// them content-hashed), and its data is served from /platforms/platforms.json.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { verticalLabel } from './sections.mjs'

/**
 * The options this site passes to platforms-ui's renderPlatformsParts. Logos are hotlinked from
 * Brandfetch when there is a client ID (it appears in every logo URL, so it is not a secret, but
 * it is OpenSteward's and is not committed); without one, cards show initials.
 */
export function catalogueOptions(clientId) {
  const id = clientId?.trim() ?? ''
  return {
    dataUrl: '/platforms/platforms.json',
    apiTagBase: '/unified-api/#tag/',
    guideHrefTemplate: '/integrate/{vertical}/{slug}/',
    showOverlay: false,
    ...(id === '' ? { logoSource: 'none' } : { logoSource: 'cdn', brandfetchClientId: id }),
  }
}

/** docs/platforms/platforms.md as the page's Markdown copy: its H1, its first paragraph, the rest. */
export function platformsMarkdown(source) {
  const [, title, rest] = source.match(/^#\s+(.+)\n+([\s\S]*)$/) ?? []
  if (title === undefined) throw new Error('docs/platforms/platforms.md: no title')
  const [description, ...body] = rest.split(/\n{2,}/)
  return { title: title.trim(), description: description.replace(/\s+/g, ' ').trim(), body: body.join('\n\n') }
}

/**
 * The table's "Verification" section as HTML, for under the catalogue: which adapters have run
 * against a real API. The product's README links to it (`platforms.md#verification`), and the
 * catalogue shows it only as badges on those few cards. Empty when the product drops it.
 */
export function verificationHtml(source) {
  const section = source.split(/^## Verification[ \t]*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) return ''
  const html = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(section)
    .toString()
  return `<h2 id="verification">Verification</h2>\n${html}`
}

/**
 * Every platform for the list under the catalogue (docs search and readers without JavaScript),
 * by name, with a link to its integration guide where there is one.
 *
 * @param {{ platforms: { name: string, slug: string, vertical: string }[] }} dataset  platforms.json
 * @param {(vertical: string, slug: string) => boolean} hasGuide
 */
export function platformList(dataset, hasGuide) {
  return dataset.platforms
    .map(({ name, slug, vertical }) => ({
      name,
      slug,
      vertical,
      label: verticalLabel(vertical),
      ...(hasGuide(vertical, slug) ? { guide: `/integrate/${vertical}/${slug}/` } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

/**
 * Writes the catalogue's parts for the page: src/generated/platforms/ (styles, script, and the
 * hero and markup as JSON) and public/platforms/platforms.json.
 */
export async function writePlatformsCatalogue({ productDir, appDir, clientId }) {
  const generated = join(appDir, 'src/generated/platforms')
  mkdirSync(generated, { recursive: true })
  // As .mts: the package declares no "type", so Node would warn about loading index.ts as a module.
  const source = join(generated, 'platforms-ui.mts')
  copyFileSync(join(productDir, 'packages/platforms-ui/src/index.ts'), source)
  const ui = await import(pathToFileURL(source).href)
  const options = catalogueOptions(clientId)
  const { styles, hero, body, script } = ui.renderPlatformsParts(options)

  writeFileSync(join(generated, 'catalogue.css'), styles)
  writeFileSync(join(generated, 'catalogue.js'), script)
  const verification = verificationHtml(readFileSync(join(productDir, 'docs/platforms/platforms.md'), 'utf8'))
  writeFileSync(join(generated, 'parts.json'), `${JSON.stringify({ hero, body, verification }, null, 2)}\n`)

  const data = join(appDir, 'public/platforms')
  mkdirSync(data, { recursive: true })
  copyFileSync(join(productDir, 'docs/platforms/platforms.json'), join(data, 'platforms.json'))

  console.log(
    options.logoSource === 'cdn'
      ? 'platforms: logos from Brandfetch'
      : 'platforms: no BRANDFETCH_CLIENT_ID, so initials instead of logos',
  )
}
