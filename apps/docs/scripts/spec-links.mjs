// The product's OpenAPI specs and Postman collections link their descriptions to docs-server's
// routes, such as [§3](/guides/dev-api.md#3-scopes), which only work on docs-server. The copies
// this site publishes point those links at this site's pages instead, as full URLs, so they work
// in Swagger UI here and in a downloaded file alike. Nothing else in the files changes.

import { DOCS_ORIGIN } from './llms.mjs'

/** A Markdown link target that is a site path: "](/" up to the closing ")". */
const PATH_LINK = /\]\((\/[^)\s]*)\)/g

/**
 * @param {string} text  a spec or collection, as JSON or YAML text
 * @param {(href: string) => string | null} resolve  where a docs-server href goes here (a path on
 *        this site, or a full URL such as GitHub's), or null when it cannot be placed
 * @returns {{ text: string, unresolved: string[] }}
 */
export function rewriteSpecLinks(text, resolve) {
  const unresolved = []
  const next = text.replace(PATH_LINK, (all, href) => {
    const target = resolve(href)
    if (target === null) {
      unresolved.push(href)
      return all
    }
    return `](${target.startsWith('/') ? DOCS_ORIGIN + target : target})`
  })
  return { text: next, unresolved }
}
