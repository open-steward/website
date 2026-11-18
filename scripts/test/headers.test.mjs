import { describe, expect, it } from 'vitest'
import { cacheControlFor, contentTypeFor, isHashed, keepWhenStale, uploadRank } from '../lib/headers.mjs'

describe('cacheControlFor', () => {
  it('caches content-hashed files for a year', () => {
    for (const key of ['_astro/Base.Mg-_iQcd.css', '_astro/InterTight-Variable.BjjQnp0H.ttf', 'docs/diagrams/0011cbf349c99ebc4970.svg']) {
      expect(cacheControlFor(key)).toBe('public, max-age=31536000, immutable')
    }
  })

  it('keeps pages, the sitemap, robots, security.txt and the search index short', () => {
    for (const key of [
      'site/index.html',
      '404.html',
      'docs/admin/status/index.html',
      'site/sitemap-index.xml',
      'site/robots.txt',
      'site/.well-known/security.txt',
      'docs/pagefind/pagefind-entry.json',
      'docs/pagefind/pagefind.js',
      'docs/admin/status.md',
      'site/llms.txt',
      'docs/llms-full.txt',
    ]) {
      expect(cacheControlFor(key)).toBe('public, max-age=300')
    }
  })

  it('gives everything else an hour', () => {
    for (const key of ['site/favicon.ico', 'site/brand/mark.svg', 'docs/theme-provider.js', 'docs/downloads/openapi/openapi.yaml']) {
      expect(cacheControlFor(key)).toBe('public, max-age=3600')
    }
  })
})

describe('contentTypeFor', () => {
  it('knows the types the sites ship', () => {
    expect(contentTypeFor('site/index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('_astro/x.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('docs/diagrams/a.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('docs/pagefind/wasm.en.pagefind')).toBe('application/octet-stream')
    expect(contentTypeFor('docs/admin/status.md')).toBe('text/markdown; charset=utf-8')
    expect(contentTypeFor('site/llms.txt')).toBe('text/plain; charset=utf-8')
    expect(contentTypeFor('_astro/site.D1x.webmanifest')).toBe('application/manifest+json')
    expect(contentTypeFor('_astro/InterTight.ttf')).toBe('font/ttf')
  })

  it('refuses an extension it does not know, so nothing ships as the wrong type', () => {
    expect(() => contentTypeFor('site/file.exe')).toThrow(/no Content-Type/)
    expect(() => contentTypeFor('site/LICENSE')).toThrow(/no Content-Type/)
  })
})

describe('upload order', () => {
  it('uploads hashed files first and pages last', () => {
    expect(uploadRank('_astro/a.css')).toBe(0)
    expect(uploadRank('site/brand/mark.svg')).toBe(1)
    expect(uploadRank('site/index.html')).toBe(2)
    expect(isHashed('docs/diagrams/x.svg')).toBe(true)
    expect(isHashed('docs/media/x.png')).toBe(false)
  })

  it('keeps files a page loads later when a build drops them, but not pages', () => {
    expect(keepWhenStale('_astro/a.js')).toBe(true)
    expect(keepWhenStale('docs/pagefind/fragment/en_1a2b.pf_fragment')).toBe(true)
    expect(keepWhenStale('docs/admin/index.html')).toBe(false)
    expect(keepWhenStale('site/brand/mark.svg')).toBe(false)
  })
})
