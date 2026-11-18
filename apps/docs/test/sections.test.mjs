import { describe, expect, it } from 'vitest'
import { TOP, sidebarEntry, unlistedPages } from '../scripts/sections.mjs'

describe('unlistedPages', () => {
  it('finds pages no sidebar section holds: new top-level pages and new directories', () => {
    const pages = ['index.md', 'postman.md', 'platforms.md', 'admin/index.md', 'admin/status.md', 'overview.md', 'stray.md', 'newdir/page.md']
    expect(unlistedPages(pages)).toEqual(['newdir/page.md', 'stray.md'])
  })

  it('finds none when every page has a place', () => {
    expect(unlistedPages(['index.md', 'integrate/crm/hubspot.md', 'overview.md'])).toEqual([])
  })
})

describe('the sidebar', () => {
  it('lists the Unified and Operator APIs straight after API specs and Postman, as its second level', () => {
    const labels = TOP.map((page) => page.label)
    const at = labels.indexOf('API specs and Postman')
    expect(labels.slice(at, at + 3)).toEqual(['API specs and Postman', 'Unified API', 'Operator API'])
    expect(sidebarEntry(TOP[at])).toEqual({ label: 'API specs and Postman', slug: 'postman' })
    for (const page of TOP.slice(at + 1, at + 3)) {
      expect(sidebarEntry(page)).toEqual({ label: page.label, link: page.link, attrs: { 'data-sidebar-child': '' } })
    }
  })

  it('makes the home page, other pages and src/pages links into sidebar entries', () => {
    expect(sidebarEntry({ label: 'Overview', content: 'index.md' })).toEqual({ label: 'Overview', link: '/' })
    expect(sidebarEntry({ label: 'Glossary', content: 'glossary.md' })).toEqual({ label: 'Glossary', slug: 'glossary' })
    // A page of src/pages/ with a Markdown copy: the sidebar takes the link, llms.txt the content.
    expect(sidebarEntry(TOP.find((t) => t.label === 'Platforms'))).toEqual({ label: 'Platforms', link: '/platforms/' })
    expect(sidebarEntry({ label: 'X', link: '/x/' })).toEqual({ label: 'X', link: '/x/' })
  })
})
