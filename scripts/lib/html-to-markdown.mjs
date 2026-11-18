// A built page's <main> as Markdown, for the copies agents read (/index.md, /security.md). The
// page stays the one source: what it says is what the Markdown says.
//
// Left out: anything hidden from assistive technology too (aria-hidden, hidden), icons (svg),
// controls (button), and scripts. Links and images become absolute URLs, so the text reads the
// same out of context.

import { select } from 'hast-util-select'
import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

const DROP = new Set(['svg', 'button', 'script', 'style', 'template', 'noscript'])

function prune(node, base, inPre = false) {
  if (!node.children) return
  const kept = node.children.filter((child) => {
    if (child.type === 'comment') return false
    if (child.type !== 'element') return true
    const props = child.properties ?? {}
    if (DROP.has(child.tagName) || props.hidden || props.ariaHidden === 'true') return false
    return true
  })
  // Elements side by side (two buttons, a row of tiles) are apart on the page because CSS puts
  // them apart; in text they need a space. Not in code, where every character counts.
  node.children = []
  for (const [i, child] of kept.entries()) {
    if (!inPre && i > 0 && child.type === 'element' && kept[i - 1].type === 'element') {
      node.children.push({ type: 'text', value: ' ' })
    }
    node.children.push(child)
  }
  for (const child of node.children) {
    if (child.type !== 'element') continue
    for (const attr of ['href', 'src']) {
      const value = child.properties?.[attr]
      if (typeof value === 'string' && !value.startsWith('#')) child.properties[attr] = new URL(value, base).href
    }
    prune(child, base, inPre || child.tagName === 'pre')
  }
}

/**
 * @param {string} html  a whole built page
 * @param {string} url   the page's own URL, for absolute links
 * @returns {string} Markdown
 */
export function pageToMarkdown(html, url) {
  const tree = unified().use(rehypeParse).parse(html)
  const main = select('main', tree)
  if (!main) throw new Error(`${url}: no <main>`)
  prune(main, url)
  const root = { type: 'root', children: [main] }
  const markdown = unified()
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '_', rule: '-', fences: true })
  const mdast = markdown.runSync(root)
  return markdown.stringify(mdast).replace(/\n{3,}/g, '\n\n')
}
