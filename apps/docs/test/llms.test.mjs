import { describe, expect, it } from 'vitest'
import { absoluteLinks, llmsFull, llmsIndex, markdownUrlFor, pageMarkdown } from '../scripts/llms.mjs'
import { slugFor } from '../scripts/sections.mjs'

describe('markdownUrlFor', () => {
  it('puts each page at its URL plus .md', () => {
    expect(markdownUrlFor('index.md')).toBe('/index.md')
    expect(markdownUrlFor('dev-api.md')).toBe('/dev-api.md')
    expect(markdownUrlFor('admin/index.md')).toBe('/admin.md')
    expect(markdownUrlFor('admin/status.md')).toBe('/admin/status.md')
  })
})

describe('slugFor', () => {
  it('gives Starlight the slug of a content file', () => {
    expect(slugFor('integrate/index.md')).toBe('integrate')
    expect(slugFor('platforms/platforms.md')).toBe('platforms/platforms')
  })
})

describe('absoluteLinks', () => {
  it('makes root-relative Markdown links absolute and leaves the rest', () => {
    expect(absoluteLinks('[a](/x/) [b](https://e.example/) [c](#d) [e](//cdn)')).toBe(
      '[a](https://docs.opensteward.dev/x/) [b](https://e.example/) [c](#d) [e](//cdn)',
    )
  })
})

describe('pageMarkdown', () => {
  it('heads the page with its title and summary', () => {
    expect(pageMarkdown({ title: 'T', description: 'D.', body: '\nBody\n\n' })).toBe('# T\n\n> D.\n\nBody\n')
    expect(pageMarkdown({ title: 'T', body: 'Body' })).toBe('# T\n\nBody\n')
  })
})

describe('llmsIndex', () => {
  const pages = new Map(
    [
      ['index.md', 'OpenSteward'],
      ['dev-api.md', 'Developer API'],
      ['admin/index.md', 'Admin console'],
      ['admin/status.md', 'Status'],
      ['integrate/index.md', 'Integration guides'],
      ['integrate/crm/hubspot.md', 'Integrating HubSpot'],
      ['overview.md', 'Documentation map'],
      ['stray.md', 'Stray'],
    ].map(([path, title]) => [path, { title, description: path === 'dev-api.md' ? 'One API.' : undefined }]),
  )
  const { text, order } = llmsIndex({
    pages,
    downloads: [{ label: 'Spec', href: '/downloads/openapi/openapi.json' }],
    summary: 'What it is.',
    commit: 'c'.repeat(40),
  })

  it('lists every page once', () => {
    expect([...order].sort()).toEqual([...pages.keys()].sort())
  })

  it('follows the sidebar, with the map last under Optional', () => {
    expect(text.indexOf('## Start here')).toBeLessThan(text.indexOf('## Integration guides'))
    expect(text).toContain('## Integration guides: CRM\n\n- [Integrating HubSpot](https://docs.opensteward.dev/integrate/crm/hubspot.md)')
    expect(text).toContain('## Admin console\n\n- [Admin console](https://docs.opensteward.dev/admin.md)\n- [Status](https://docs.opensteward.dev/admin/status.md)')
    expect(text).toContain('## Other pages\n\n- [Stray]')
    expect(text.trimEnd().endsWith('## Optional\n\n- [Documentation map](https://docs.opensteward.dev/overview.md)')).toBe(true)
  })

  it('links the Markdown copies, with summaries', () => {
    expect(text).toContain('- [Developer API](https://docs.opensteward.dev/dev-api.md): One API.')
    expect(text).toContain('- [Spec](https://docs.opensteward.dev/downloads/openapi/openapi.json)')
    expect(text.startsWith('# OpenSteward Docs\n\n> What it is.\n')).toBe(true)
  })

  it('puts every page in the full file, in the same order, with its URL', () => {
    const markdown = new Map([...pages.keys()].map((p) => [p, `# ${pages.get(p).title}\n`]))
    const full = llmsFull({ order, markdown, summary: 'What it is.' })
    expect(full).toContain('Source: https://docs.opensteward.dev/admin/status/\n\n# Status')
    expect(full.indexOf('# Developer API')).toBeLessThan(full.indexOf('# Status'))
  })
})
