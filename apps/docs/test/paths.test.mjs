import { describe, expect, it } from 'vitest'
import { contentPathFor, isPublished, resolveLink, urlFor } from '../scripts/paths.mjs'

const REPO = 'https://github.com/open-steward/opensteward'
const COMMIT = 'a'.repeat(40)

const files = new Set([
  'README.md',
  'LICENSE',
  'docs/README.md',
  'docs/GLOSSARY.md',
  'docs/dev-api.md',
  'docs/admin/README.md',
  'docs/admin/status.md',
  'docs/integrate/README.md',
  'docs/integrate/accounting/index.md',
  'docs/integrate/_template.md',
  'docs/assets/screenshots/admin/status.png',
  'docs/openapi/openapi.yaml',
  'docs/api-reference/api-reference.md',
  'packages/design-system/logo/wordmark-dark.svg',
])
const dirs = new Set(['', 'docs', 'docs/admin', 'docs/integrate', 'docs/integrate/accounting', 'docs/assets', 'docs/api-reference', 'packages'])
const exists = (path) => (files.has(path) ? 'file' : dirs.has(path) ? 'dir' : undefined)
const pages = new Map([...files].filter(isPublished).map((path) => [path, contentPathFor(path)]))

const resolve = (href, from = 'docs/admin/status.md', kind = 'link') =>
  resolveLink(href, { from, kind, pages, exists, repo: REPO, commit: COMMIT })

describe('pages', () => {
  it('publishes the root README and docs/, but not drafts or other files', () => {
    expect(isPublished('README.md')).toBe(true)
    expect(isPublished('docs/admin/status.md')).toBe(true)
    expect(isPublished('docs/integrate/_template.md')).toBe(false)
    expect(isPublished('CONTRIBUTING.md')).toBe(false)
    expect(isPublished('docs/openapi/openapi.yaml')).toBe(false)
  })

  it('does not publish the generated one-page API reference: the Swagger page replaces it', () => {
    expect(isPublished('docs/api-reference/api-reference.md')).toBe(false)
  })

  it('maps product paths to content files and URLs', () => {
    const cases = [
      ['README.md', 'index.md', '/'],
      ['docs/README.md', 'overview.md', '/overview/'],
      ['docs/GLOSSARY.md', 'glossary.md', '/glossary/'],
      ['docs/admin/README.md', 'admin/index.md', '/admin/'],
      ['docs/admin/status.md', 'admin/status.md', '/admin/status/'],
      ['docs/integrate/accounting/index.md', 'integrate/accounting/index.md', '/integrate/accounting/'],
    ]
    for (const [path, content, url] of cases) {
      expect(contentPathFor(path)).toBe(content)
      expect(urlFor(content)).toBe(url)
    }
  })
})

describe('resolveLink', () => {
  it('leaves outside links, mail and same-page anchors alone', () => {
    for (const href of ['https://example.com/x', 'mailto:a@b.c', '#section', '//cdn.example/x']) {
      expect(resolve(href)).toEqual({ href })
    }
  })

  it('points Markdown links at the pages, keeping the anchor', () => {
    expect(resolve('../dev-api.md#sync-schedules').href).toBe('/dev-api/#sync-schedules')
    expect(resolve('./README.md').href).toBe('/admin/')
    expect(resolve('../GLOSSARY.md').href).toBe('/glossary/')
    expect(resolve('../../README.md#license').href).toBe('/#license')
    expect(resolve('./docs/admin/status.md', 'README.md').href).toBe('/admin/status/')
  })

  it('points directory links at their index page', () => {
    expect(resolve('../admin/').href).toBe('/admin/')
    expect(resolve('../integrate/accounting').href).toBe('/integrate/accounting/')
    expect(resolve('./docs/', 'README.md').href).toBe('/overview/')
  })

  it('sends files outside docs/ to GitHub at the pinned commit', () => {
    expect(resolve('../../LICENSE').href).toBe(`${REPO}/blob/${COMMIT}/LICENSE`)
    expect(resolve('../../CONTRIBUTING.md#tests').href).toBe(`${REPO}/blob/${COMMIT}/CONTRIBUTING.md#tests`)
    expect(resolve('../../packages/').href).toBe(`${REPO}/tree/${COMMIT}/packages`)
  })

  it('sends drafts to GitHub rather than to a page that does not exist', () => {
    expect(resolve('../integrate/_template.md').href).toBe(`${REPO}/blob/${COMMIT}/docs/integrate/_template.md`)
  })

  it('copies Markdown images next to the content, with a relative path', () => {
    const result = resolve('../assets/screenshots/admin/status.png', 'docs/admin/status.md', 'image')
    expect(result.href).toBe('../assets/screenshots/admin/status.png')
    expect(result.copy).toEqual({
      from: 'docs/assets/screenshots/admin/status.png',
      to: 'assets/screenshots/admin/status.png',
      kind: 'content',
    })
  })

  it('serves images in raw HTML from /media/, and images outside docs/ too', () => {
    const result = resolve('packages/design-system/logo/wordmark-dark.svg', 'README.md', 'html-image')
    expect(result.href).toBe('/media/packages/design-system/logo/wordmark-dark.svg')
    expect(result.copy?.kind).toBe('media')
  })

  it('serves data files under docs/ as downloads', () => {
    const result = resolve('../openapi/openapi.yaml')
    expect(result.href).toBe('/downloads/openapi/openapi.yaml')
    expect(result.copy).toEqual({ from: 'docs/openapi/openapi.yaml', to: 'openapi/openapi.yaml', kind: 'download' })
  })

  it("maps docs-server routes to this site's pages", () => {
    expect(resolve('/platforms/ecommerce/shopify').href).toBe('/platforms/')
    expect(resolve('/platforms#vertical=crm').href).toBe('/platforms/#vertical=crm')
    // The docs-server's Unified API page, under its old route and its new one.
    expect(resolve('/api-reference#tag/Accounting').href).toBe('/unified-api/#tag/Accounting')
    expect(resolve('/unified-api#tag/Accounting').href).toBe('/unified-api/#tag/Accounting')
    expect(resolve('/operator-api').href).toBe('/operator-api/')
    expect(resolve('/guides/admin/status.md').href).toBe('/admin/status/')
  })

  it('marks a link already at one of these pages as placed, not as left as written', () => {
    expect(resolve('/unified-api/')).toEqual({ href: '/unified-api/', route: true })
    expect(resolve('/no-such-route/')).toEqual({ href: '/no-such-route/' })
  })

  it('points links to the platform table at the Platforms page', () => {
    expect(resolve('platforms/platforms.md', 'docs/README.md').href).toBe('/platforms/')
    expect(resolve('../platforms/platforms.md#verification').href).toBe('/platforms/#verification')
    expect(resolve('docs/platforms/', 'README.md').href).toBe('/platforms/')
  })

  it('points links to the one-page API reference at the Unified API page', () => {
    expect(resolve('../api-reference/api-reference.md').href).toBe('/unified-api/')
    expect(resolve('api-reference/api-reference.md#accounting', 'docs/README.md').href).toBe('/unified-api/#accounting')
    expect(resolve('/guides/api-reference/api-reference.md').href).toBe('/unified-api/')
    expect(resolve('../api-reference/').href).toBe('/unified-api/')
  })

  it('leaves other absolute paths alone, for the link check to report', () => {
    expect(resolve('/somewhere/else')).toEqual({ href: '/somewhere/else' })
  })

  it('leaves links that climb out of the repository alone', () => {
    expect(resolve('../../../../outside.md')).toEqual({ href: '../../../../outside.md' })
  })
})
