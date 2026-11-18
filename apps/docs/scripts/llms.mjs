// The docs for AI agents (https://llmstxt.org): every page also as Markdown at its URL plus
// `.md`, an index of them (/llms.txt) in sidebar order, and all of them in one file
// (/llms-full.txt). sync.mjs writes the files; these functions decide their names and text.

import { urlFor } from './paths.mjs'
import { BOTTOM, GROUPS, TOP, sortInGroup, unlistedPages, verticalLabel } from './sections.mjs'

export const DOCS_ORIGIN = 'https://docs.opensteward.dev'

/** A page's Markdown copy: `admin/status.md` -> `/admin/status.md`, the home page -> `/index.md`. */
export function markdownUrlFor(contentPath) {
  const url = urlFor(contentPath)
  return url === '/' ? '/index.md' : `${url.slice(0, -1)}.md`
}

/** Root-relative links in generated Markdown, made absolute: `](/x/)` -> `](https://docs…/x/)`. */
export const absoluteLinks = (markdown) => markdown.replace(/\]\(\/(?!\/)/g, `](${DOCS_ORIGIN}/`)

/** One page's Markdown copy: its title and summary, then the page as the product wrote it. */
export function pageMarkdown({ title, description, body }) {
  return `# ${title}\n\n${description ? `> ${description}\n\n` : ''}${body.trim()}\n`
}

/**
 * The index.
 *
 * @param {object} docs
 * @param {Map<string, { title: string, description?: string }>} docs.pages  by content path
 * @param {{ label: string, href: string }[]} docs.downloads  the specs and collections
 * @param {string} docs.summary  one sentence on what OpenSteward is
 * @param {string} docs.commit   the product commit the docs are built from
 * @returns {{ text: string, order: string[] }} the file, and the content paths in its order
 */
export function llmsIndex({ pages, downloads, summary, commit }) {
  const order = []
  const item = (contentPath) => {
    order.push(contentPath)
    const { title, description } = pages.get(contentPath)
    return `- [${title}](${DOCS_ORIGIN}${markdownUrlFor(contentPath)})${description ? `: ${description}` : ''}`
  }
  const inDirectory = (directory) => [...pages.keys()].filter((p) => p.startsWith(`${directory}/`)).sort(sortInGroup)

  const sections = [['Start here', TOP.filter((t) => t.content && pages.has(t.content)).map((t) => item(t.content))]]
  for (const { label, directory } of GROUPS) {
    const paths = inDirectory(directory)
    if (directory !== 'integrate') {
      sections.push([label, paths.map(item)])
      continue
    }
    // The integration guides: the general pages, then one section per vertical.
    sections.push([label, paths.filter((p) => p.split('/').length === 2).map(item)])
    const verticals = [...new Set(paths.filter((p) => p.split('/').length > 2).map((p) => p.split('/')[1]))].sort()
    for (const vertical of verticals) {
      sections.push([`${label}: ${verticalLabel(vertical)}`, paths.filter((p) => p.startsWith(`integrate/${vertical}/`)).map(item)])
    }
  }
  sections.push(['API specs and Postman collections', downloads.map((d) => `- [${d.label}](${DOCS_ORIGIN}${d.href})`)])
  const rest = unlistedPages([...pages.keys()])
  if (rest.length > 0) sections.push(['Other pages', rest.map(item)])
  // "Optional" is llms.txt's name for what an agent with little room can skip.
  sections.push(['Optional', BOTTOM.filter((b) => pages.has(b.content)).map((b) => item(b.content))])

  const text = `# OpenSteward Docs

> ${summary}

Each link below is the Markdown copy of a docs page. Any page's Markdown is at its URL without the trailing slash, plus \`.md\`: ${DOCS_ORIGIN}/dev-api/ is ${DOCS_ORIGIN}/dev-api.md. All of the pages in one file: ${DOCS_ORIGIN}/llms-full.txt. Built from open-steward/opensteward at commit ${commit}.

${sections
  .filter(([, items]) => items.length > 0)
  .map(([heading, items]) => `## ${heading}\n\n${items.join('\n')}`)
  .join('\n\n')}
`
  return { text, order }
}

/** Every page in one file, in the index's order, each headed with its URL. */
export function llmsFull({ order, markdown, summary }) {
  const parts = order.map((contentPath) => `Source: ${DOCS_ORIGIN}${urlFor(contentPath)}\n\n${markdown.get(contentPath).trim()}`)
  return `# OpenSteward Docs, all pages\n\n> ${summary}\n\n---\n\n${parts.join('\n\n---\n\n')}\n`
}
