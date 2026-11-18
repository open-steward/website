// The product's COMMERCIAL-LICENSE.md, for /commercial-licensing/: its "Questions that settle
// the rest" read as a decision tree, and the whole file rendered to HTML. Pure functions; the
// page reads the file. Anything these cannot read stops the build, so the page never drifts
// from the product's wording.

import { posix } from 'node:path'
import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { contentPathFor, githubUrlFor, isPublished, urlFor } from '../../../docs/scripts/paths.mjs'

const FILE = 'COMMERCIAL-LICENSE.md'
const SECTION = 'Questions that settle the rest'

/** An answer starts the text, or follows ". " or ") ", and is followed by "," or "→". */
const ANSWER = /(?:^|(?<=[.)]\s))(Yes|No)(?=\s*[,→])/g

const fail = (message) => {
  throw new Error(`${FILE}: ${message}`)
}

const plain = (node) => toString(node).replace(/\s+/g, ' ').trim()

export const parseMarkdown = (markdown) => unified().use(remarkParse).use(remarkGfm).parse(markdown)

/** The ordered list after the "Questions that settle the rest" heading, in a parsed file. */
export function findQuestionList(root) {
  const at = root.children.findIndex((node) => node.type === 'heading' && plain(node) === SECTION)
  if (at === -1) fail(`no "${SECTION}" heading`)
  const { depth } = root.children[at]
  for (const node of root.children.slice(at + 1)) {
    if (node.type === 'heading' && node.depth <= depth) break
    if (node.type === 'list' && node.ordered) return node
  }
  return fail(`no numbered list under "${SECTION}"`)
}

/** The outcome an answer leads to: its last "→" segment. */
function readOutcome(segment, n) {
  const forms = [
    [/^go to (\d+)\.?/i, (m) => ({ next: Number(m[1]) })],
    [/^not permitted\.?/i, () => ({ verdict: 'not-permitted' })],
    [/^permitted\.?/i, () => ({ verdict: 'permitted' })],
    [/^ask us(?: before you deploy)?/i, () => ({ verdict: 'ask' })],
  ]
  for (const [pattern, outcome] of forms) {
    const match = segment.match(pattern)
    if (match === null) continue
    const note = segment
      .slice(match[0].length)
      .trim()
      .replace(/^\(see [^)]*\)/i, '')
      .replace(/^[\s.,;:)]+/, '')
      .trim()
    const result = { ...outcome(match), note }
    // Only "ask us" shows a note; words after any other outcome would vanish from the tree.
    if (note !== '' && result.verdict !== 'ask') {
      fail(`question ${n}: words after "${match[0]}" that the tree would not show: "${note}"`)
    }
    return result
  }
  return fail(`question ${n}: unknown outcome "${segment}"`)
}

/** An outcome, or a sentence ending, inside an explanation means the answer has more than one path. */
const NOT_AN_EXPLANATION = /\b(?:not permitted|permitted|go to \d+|ask us)\b|[.!?]\s+\S/i

function readAnswer(text, n) {
  const [first, ...rest] = text.split('→').map((part) => part.trim())
  if (rest.length === 0) fail(`question ${n}: "${first}" leads nowhere (no →)`)
  const outcome = readOutcome(rest.pop(), n)
  const lead = first.replace(/^(Yes|No)\s*,?\s*/, '')
  const parts = [lead, ...rest].filter((part) => part !== '')
  for (const part of parts) {
    if (NOT_AN_EXPLANATION.test(part)) fail(`question ${n}: an answer with more than one outcome: "${text}"`)
  }
  const explanation = parts.join('; ')
  return { explanation, ...outcome }
}

function readQuestion(item, n) {
  const blocks = item.children
  const first = blocks[0]
  const at = first?.type === 'paragraph' ? first.children.findIndex((node) => node.type === 'strong') : -1
  if (at === -1) fail(`question ${n} has no bold question`)
  const text = plain(first.children[at])
  const after = [...first.children.slice(at + 1), ...blocks.slice(1)]
  const body = after.map((node) => toString(node)).join(' ').replace(/\s+/g, ' ').trim()

  const starts = [...body.matchAll(ANSWER)]
  const words = starts.map((m) => m[1])
  if (words.filter((w) => w === 'Yes').length !== 1 || words.filter((w) => w === 'No').length !== 1) {
    fail(`question ${n} needs exactly one Yes and one No answer, and has ${words.join(', ') || 'none'}`)
  }
  if (starts[0].index !== 0) fail(`question ${n}: text before its first answer: "${body.slice(0, starts[0].index)}"`)

  const answers = {}
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : body.length
    answers[m[1].toLowerCase()] = readAnswer(body.slice(m.index, end).trim(), n)
  })
  return { n, text, yes: answers.yes, no: answers.no }
}

/**
 * @param {string} markdown  the whole COMMERCIAL-LICENSE.md
 * @returns {{ questions: { n: number, text: string, yes: object, no: object }[] }}
 */
export function parseDecisionTree(markdown) {
  const list = findQuestionList(parseMarkdown(markdown))
  const start = list.start ?? 1
  const questions = list.children.map((item, i) => readQuestion(item, start + i))
  const numbers = new Set(questions.map((q) => q.n))

  for (const q of questions) {
    for (const { next } of [q.yes, q.no]) {
      if (next === undefined) continue
      if (!numbers.has(next)) fail(`question ${q.n}: go to ${next}, but there is no question ${next}`)
      if (next <= q.n) fail(`question ${q.n}: go to ${next} is not a later question`)
    }
  }

  const reached = new Set([start])
  for (const q of questions) {
    if (!reached.has(q.n)) continue
    for (const { next } of [q.yes, q.no]) if (next !== undefined) reached.add(next)
  }
  const unreachable = questions.find((q) => !reached.has(q.n))
  if (unreachable) fail(`question ${unreachable.n}: question ${start} cannot reach it`)

  return { questions }
}

const DOCS_ORIGIN = 'https://docs.opensteward.dev'

/**
 * Where a link in the file goes on this site. Relative paths are relative to the repository root:
 * published docs go to the docs site, anything else to GitHub at the pinned commit.
 */
export function rewriteHref(href, { repo, commit }) {
  if (href.startsWith('#') || /^(mailto:|https?:)/i.test(href)) return href
  const at = href.search(/[?#]/)
  const [raw, tail] = at === -1 ? [href, ''] : [href.slice(0, at), href.slice(at)]
  const path = posix.normalize(raw).replace(/\/$/, '')
  if (path.startsWith('..') || path.startsWith('/')) fail(`a link outside the repository: ${href}`)
  if (path.startsWith('docs/') && isPublished(path)) return `${DOCS_ORIGIN}${urlFor(contentPathFor(path))}${tail}`
  return githubUrlFor(repo, commit, path, false) + tail
}

const hastText = (node) => (node.type === 'text' ? node.value : (node.children ?? []).map(hastText).join(''))

/** Heading ids, rewritten links and scrolling tables, in the HTML tree. */
function finishHtml(ctx) {
  return (tree) => {
    const slugger = new GithubSlugger()
    const visit = (node) => {
      const children = node.children ?? []
      children.forEach((child, i) => {
        if (child.type !== 'element') return
        if (/^h[1-6]$/.test(child.tagName)) child.properties.id = slugger.slug(hastText(child))
        if (child.tagName === 'a' && typeof child.properties.href === 'string') {
          child.properties.href = rewriteHref(child.properties.href, ctx)
        }
        if (child.tagName === 'table') {
          children[i] = { type: 'element', tagName: 'div', properties: { className: ['table-scroll'] }, children: [child] }
        }
        visit(child)
      })
    }
    visit(tree)
  }
}

/**
 * The file as HTML for the page body, without its H1 and first paragraph (the page header shows
 * those). The decision list carries data-decision-tree.
 *
 * @returns {{ title: string, intro: string, html: string }}
 */
export function renderCommercialLicense(markdown, ctx) {
  const root = parseMarkdown(markdown)
  const h1 = root.children.findIndex((node) => node.type === 'heading' && node.depth === 1)
  if (h1 === -1) fail('no title (# heading)')
  const introAt = h1 + 1
  if (root.children[introAt]?.type !== 'paragraph') fail('no paragraph after the title')
  const title = plain(root.children[h1])
  const intro = plain(root.children[introAt])
  root.children.splice(h1, 2)

  const list = findQuestionList(root)
  list.data = { ...list.data, hProperties: { ...list.data?.hProperties, dataDecisionTree: '' } }

  const processor = unified().use(remarkRehype).use(finishHtml, ctx).use(rehypeStringify)
  const html = processor.stringify(processor.runSync(root))
  return { title, intro, html }
}
