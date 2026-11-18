import { describe, expect, it } from 'vitest'
import { rewriteSpecLinks } from '../scripts/spec-links.mjs'

// docs-server serves the product's docs under /guides/; this site serves them at its own URLs.
const resolve = (href) => (href.startsWith('/guides/dev-api.md') ? href.replace('/guides/dev-api.md', '/dev-api/') : null)

describe('rewriteSpecLinks', () => {
  it("points a description's docs-server link at this site's page, absolutely", () => {
    const json = '{"description":"See [/guides/dev-api.md §3](/guides/dev-api.md#3-scopes) for the full scope table."}'
    const { text, unresolved } = rewriteSpecLinks(json, resolve)
    expect(text).toBe('{"description":"See [/guides/dev-api.md §3](https://docs.opensteward.dev/dev-api/#3-scopes) for the full scope table."}')
    expect(unresolved).toEqual([])
  })

  it('rewrites a link whose text the YAML wraps across lines', () => {
    const yaml = '    upstream. See [/guides/dev-api.md\n    §3](/guides/dev-api.md#3-scopes) for the full scope table.\n'
    expect(rewriteSpecLinks(yaml, resolve).text).toContain('§3](https://docs.opensteward.dev/dev-api/#3-scopes)')
  })

  it('keeps a full URL the link resolves to, such as a file on GitHub', () => {
    const toGithub = () => 'https://github.com/open-steward/opensteward/blob/abc/LICENSE'
    expect(rewriteSpecLinks('"[l](/LICENSE)"', toGithub).text).toBe('"[l](https://github.com/open-steward/opensteward/blob/abc/LICENSE)"')
  })

  it('leaves full URLs and anchors alone, and reports a path it cannot place', () => {
    const json = '"[a](https://example.com/x) [b](#top) [c](/guides/gone.md)"'
    const { text, unresolved } = rewriteSpecLinks(json, resolve)
    expect(text).toBe(json)
    expect(unresolved).toEqual(['/guides/gone.md'])
  })
})
