// Moves style="" attributes out of built HTML into one stylesheet, so pages satisfy a
// Content-Security-Policy with style-src 'self' and no 'unsafe-inline'.
//
// Expressive Code (the docs' code blocks) writes each token's colours as an inline style,
// `style="--0:#D6DEEB;--1:#403F53"`. Each distinct declaration list becomes one class,
// `.sa-<hash>`, whose rule carries the same declarations marked !important, which keeps the
// precedence an inline style has over the page's own rules. The stylesheet is content-hashed
// like Astro's assets.
//
// Deliberately narrow: it accepts only simple declarations (a property, a colon, a value of
// words, numbers, colours, units, commas and spaces). Anything else (quotes, url(), calc(),
// comments) stops the build with the page and the value, rather than being rewritten into CSS
// that might mean something else. check-built-html.mjs then verifies no style="" is left.

import { createHash } from 'node:crypto'

// Regions whose contents are not markup, skipped whole; and a start tag, attribute by attribute,
// so a ">" inside a quoted value does not end it.
const SKIP = /<!--[\s\S]*?-->|<(script|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/iy
const START_TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y
const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const PROPERTY = /^(--[\w-]+|-?[a-zA-Z][\w-]*)$/
const VALUE = /^[\w#%.,+\s-]+$/

const hash = (text, length) => createHash('sha256').update(text).digest('hex').slice(0, length)

/** `a:1; b:2 ;` -> `a:1 !important;b:2 !important`. Refuses anything but simple declarations. */
export function toImportant(declarations) {
  return declarations
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':')
      const property = part.slice(0, colon).trim()
      const value = part.slice(colon + 1).trim().replace(/\s*!important$/i, '')
      if (colon === -1 || !PROPERTY.test(property) || !VALUE.test(value) || value === '') {
        throw new Error(`refusing to move style "${declarations}": only simple declarations are moved`)
      }
      return `${property}:${value} !important`
    })
    .join(';')
}

export class StyleCollector {
  constructor() {
    /** declarations -> class name */
    this.classes = new Map()
  }

  classFor(declarations) {
    const normalized = toImportant(declarations)
    let name = this.classes.get(normalized)
    if (name === undefined) {
      name = `sa-${hash(normalized, 10)}`
      this.classes.set(normalized, name)
    }
    return name
  }

  /**
   * Rewrites one HTML document: each element's style="" becomes a class (merged into its
   * class="" if it has one). Returns the new HTML and whether anything changed.
   */
  rewrite(html) {
    let out = ''
    let changed = false
    let at = 0
    while (at < html.length) {
      const lt = html.indexOf('<', at)
      if (lt === -1) {
        out += html.slice(at)
        break
      }
      out += html.slice(at, lt)
      SKIP.lastIndex = lt
      const skipped = SKIP.exec(html)
      if (skipped) {
        out += skipped[0]
        at = SKIP.lastIndex
        continue
      }
      START_TAG.lastIndex = lt
      const tag = START_TAG.exec(html)
      if (!tag) {
        out += '<'
        at = lt + 1
        continue
      }
      const rewritten = this.rewriteTag(tag[1], tag[2] ?? '', tag[3])
      if (rewritten !== null) {
        out += rewritten
        changed = true
      } else {
        out += tag[0]
      }
      at = START_TAG.lastIndex
    }
    return { html: out, changed }
  }

  /** The tag without its style attribute, or null when it has none. */
  rewriteTag(name, attrs, slash) {
    const parsed = [...attrs.matchAll(ATTRIBUTE)].map((m) => ({
      name: m[1].toLowerCase(),
      raw: m[0],
      value: m[2] ?? m[3] ?? m[4],
      quoted: m[2] !== undefined,
    }))
    const styles = parsed.filter((a) => a.name === 'style')
    if (styles.length === 0) return null
    if (styles.length > 1) throw new Error(`<${name}> has ${styles.length} style attributes`)
    const style = styles[0]
    if (!style.quoted) throw new Error(`<${name}> has an unquoted or single-quoted style attribute`)

    const declarations = decode(style.value ?? '')
    const cls = declarations.trim() === '' ? null : this.classFor(declarations)
    const classes = parsed.filter((a) => a.name === 'class')
    if (classes.length > 1 || (classes[0] && !classes[0].quoted)) {
      throw new Error(`<${name}> has a class attribute this script does not rewrite safely`)
    }

    let result = `<${name}`
    let placed = cls === null
    for (const attr of parsed) {
      if (attr.name === 'style') continue
      if (attr.name === 'class' && cls !== null) {
        result += ` class="${`${attr.value} ${cls}`.trim()}"`
        placed = true
        continue
      }
      result += attr.raw
    }
    if (!placed) result += ` class="${cls}"`
    return `${result}${slash}>`
  }

  /** The stylesheet for every class handed out, and its content-hashed file name. */
  stylesheet() {
    const css = [...this.classes]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([declarations, name]) => `.${name}{${declarations}}`)
      .join('\n')
    const text = `/* style="" attributes from the build, moved here for the Content-Security-Policy. */\n${css}\n`
    return { text, name: `attr-styles.${hash(text, 8)}.css` }
  }
}

function decode(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Adds a stylesheet link right before </head>. */
export function linkStylesheet(html, href) {
  const at = html.indexOf('</head>')
  if (at === -1) throw new Error('page has no </head>')
  return `${html.slice(0, at)}<link rel="stylesheet" href="${href}">${html.slice(at)}`
}
