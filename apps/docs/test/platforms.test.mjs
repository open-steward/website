import { describe, expect, it } from 'vitest'
import { catalogueOptions, platformList, platformsMarkdown, verificationHtml } from '../scripts/platforms.mjs'

describe('catalogueOptions', () => {
  it('hotlinks Brandfetch logos when there is a client ID', () => {
    expect(catalogueOptions('abc')).toMatchObject({
      logoSource: 'cdn',
      brandfetchClientId: 'abc',
      dataUrl: '/platforms/platforms.json',
      apiTagBase: '/unified-api/#tag/',
      guideHrefTemplate: '/integrate/{vertical}/{slug}/',
      showOverlay: false,
    })
  })

  it.each([undefined, '', '  '])('uses initials without one (%j)', (id) => {
    const options = catalogueOptions(id)
    expect(options.logoSource).toBe('none')
    expect('brandfetchClientId' in options).toBe(false)
  })
})

describe('platformsMarkdown', () => {
  it('splits the title and summary from the table', () => {
    const page = platformsMarkdown('# Supported Platforms\n\n1548 platforms across 9 verticals.\n\n| a |\n|---|\n| b |\n')
    expect(page.title).toBe('Supported Platforms')
    expect(page.description).toBe('1548 platforms across 9 verticals.')
    expect(page.body.startsWith('| a |')).toBe(true)
  })
})

describe('platformList', () => {
  const dataset = {
    platforms: [
      { name: 'b', slug: 'b', vertical: 'crm' },
      { name: 'A', slug: 'a', vertical: 'docsign' },
    ],
  }

  it('sorts by name and names the vertical as the site does', () => {
    const list = platformList(dataset, () => false)
    expect(list.map((p) => p.name)).toEqual(['A', 'b'])
    expect(list[0].label).toBe('E-signature')
  })

  it('links a guide only where there is one', () => {
    const list = platformList(dataset, (vertical) => vertical === 'crm')
    expect(list[1].guide).toBe('/integrate/crm/b/')
    expect(list[0].guide).toBeUndefined()
  })
})

describe("the product's catalogue", () => {
  it('renders for this site', async () => {
    const { renderPlatformsParts } = await import('../../../.product/packages/platforms-ui/src/index.ts')
    const parts = renderPlatformsParts(catalogueOptions('abc'))
    expect(parts.script).toContain('"/platforms/platforms.json"')
    expect(parts.script).toContain('"/integrate/{vertical}/{slug}/"')
    expect(parts.script).toContain('fallback/404/icon')
    expect(parts.body).toContain('id="grid"')
    expect(parts.body).not.toContain('style=')
    expect(parts.hero.title).toBe('Every platform, one schema')
  })
})

describe('verificationHtml', () => {
  const source = '# Supported Platforms\n\n| t |\n|---|\n| r |\n\n## Verification\n\n8 of 1548 adapters have been exercised.\n\n| Platform | Verified |\n|---|---|\n| `xero` | Production verified |\n'

  it("renders the table's Verification section, with the id links use", () => {
    const html = verificationHtml(source)
    expect(html).toContain('<h2 id="verification">Verification</h2>')
    expect(html).toContain('<p>8 of 1548 adapters have been exercised.</p>')
    expect(html).toContain('<code>xero</code>')
    expect(html).toContain('<table>')
    expect(html).not.toContain('Supported Platforms')
  })

  it('gives nothing when the product drops the section', () => {
    expect(verificationHtml('# Supported Platforms\n\n| t |\n')).toBe('')
  })
})
