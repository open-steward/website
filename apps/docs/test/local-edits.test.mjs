import { describe, expect, it } from 'vitest'
import { LOCAL_EDITS, applyLocalEdits } from '../scripts/local-edits.mjs'

const DEV_API = `# Developer Guide

OpenSteward ships a single tenant-scoped REST surface.

This doc covers the developer-facing pieces. Everything is also in the unified OpenAPI spec at \`docs/openapi/openapi.yaml\` and rendered as the Unified API reference at \`http://localhost:3003/unified-api\` when docs-server is running.
`

describe('applyLocalEdits', () => {
  it("links the Developer Guide's API reference to this site's Unified API page", () => {
    const text = applyLocalEdits('docs/dev-api.md', DEV_API)
    expect(text).toContain(
      'Everything is also in the unified OpenAPI spec at `docs/openapi/openapi.yaml` and rendered as the [Unified API reference](/unified-api/).',
    )
    expect(text).not.toContain('localhost:3003')
  })

  it('leaves pages without edits as they are', () => {
    expect(applyLocalEdits('docs/admin/status.md', DEV_API)).toBe(DEV_API)
  })

  it('stops when the product no longer has the text an edit replaces', () => {
    const rewritten = DEV_API.replace('when docs-server is running', 'on docs-server')
    expect(() => applyLocalEdits('docs/dev-api.md', rewritten)).toThrow(/docs\/dev-api\.md.*apps\/docs\/scripts\/local-edits\.mjs/s)
  })

  it('stops when the text is there more than once, rather than guess which', () => {
    const { find } = LOCAL_EDITS['docs/dev-api.md'][0]
    expect(() => applyLocalEdits('docs/dev-api.md', `${DEV_API}\n${find}\n`)).toThrow(/2 times/)
  })
})
