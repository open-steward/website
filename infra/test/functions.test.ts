import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

type Header = { value: string }
type Headers = Record<string, Header>
type QueryValue = { value: string; multiValue?: { value: string }[] }
interface Request {
  method: string
  uri: string
  querystring: Record<string, QueryValue>
  headers: Headers
}
interface Response {
  statusCode: number
  statusDescription?: string
  headers: Headers
}
type Handler = (event: unknown) => Request | Response

const file = (name: string): string =>
  fileURLToPath(new URL(`../functions/${name}.js`, import.meta.url))

/** Loads a CloudFront Function the way the runtime does: one script, a global `handler`. */
function load(name: string): Handler {
  const context: { handler?: Handler } = {}
  runInNewContext(readFileSync(file(name), 'utf8'), context)
  if (typeof context.handler !== 'function') throw new Error(`${name} defines no handler`)
  return context.handler
}

const viewerRequest = load('viewer-request')
const viewerResponse = load('viewer-response')

function request(host: string, uri: string, querystring: Record<string, QueryValue> = {}): Request {
  return { method: 'GET', uri, querystring, headers: { host: { value: host } } }
}

const runRequest = (host: string, uri: string, qs?: Record<string, QueryValue>) =>
  viewerRequest({ version: '1.0', context: { eventType: 'viewer-request' }, request: request(host, uri, qs) })

function isResponse(result: Request | Response): result is Response {
  return 'statusCode' in result
}

function expectRedirect(result: Request | Response, location: string): void {
  expect(isResponse(result)).toBe(true)
  const response = result as Response
  expect(response.statusCode).toBe(301)
  expect(response.headers.location?.value).toBe(location)
  expect(response.headers['strict-transport-security']?.value).toBe(
    'max-age=63072000; includeSubDomains; preload',
  )
}

function expectUri(result: Request | Response, uri: string): void {
  expect(isResponse(result)).toBe(false)
  expect((result as Request).uri).toBe(uri)
}

describe('viewer-request function', () => {
  it('stays under the 10 KB CloudFront Functions size limit', () => {
    expect(statSync(file('viewer-request')).size).toBeLessThan(10 * 1024)
  })

  describe('/license', () => {
    it('redirects /license with a 301 to the license service', () => {
      expectRedirect(runRequest('opensteward.dev', '/license'), 'https://license.opensteward.dev/')
    })

    it('redirects /license/ the same way', () => {
      expectRedirect(runRequest('opensteward.dev', '/license/'), 'https://license.opensteward.dev/')
    })

    it('redirects on the distribution name too, for the check before the DNS switch', () => {
      expectRedirect(runRequest('d111111abcdef8.cloudfront.net', '/license'), 'https://license.opensteward.dev/')
    })

    it('matches /license in any case', () => {
      expectRedirect(runRequest('opensteward.dev', '/License'), 'https://license.opensteward.dev/')
      expectRedirect(runRequest('opensteward.dev', '/LICENSE/'), 'https://license.opensteward.dev/')
    })

    it('drops any query string', () => {
      const result = runRequest('opensteward.dev', '/license', { utm_source: { value: 'cli' } })
      expectRedirect(result, 'https://license.opensteward.dev/')
    })

    it('leaves other paths that start with /license alone', () => {
      expectRedirect(runRequest('opensteward.dev', '/licenses'), 'https://opensteward.dev/licenses/')
      expectUri(runRequest('opensteward.dev', '/license.txt'), '/site/license.txt')
    })

    it('does not apply on the docs host', () => {
      expectRedirect(runRequest('docs.opensteward.dev', '/license'), 'https://docs.opensteward.dev/license/')
    })
  })

  describe('www', () => {
    it('redirects to the apex, keeping the path', () => {
      expectRedirect(runRequest('www.opensteward.dev', '/'), 'https://opensteward.dev/')
      expectRedirect(runRequest('www.opensteward.dev', '/security/'), 'https://opensteward.dev/security/')
    })

    it('keeps the query string, values as sent', () => {
      const result = runRequest('www.opensteward.dev', '/a/', {
        q: { value: 'x%20y' },
        tag: { value: 'one', multiValue: [{ value: 'one' }, { value: 'two' }] },
      })
      expectRedirect(result, 'https://opensteward.dev/a/?q=x%20y&tag=one&tag=two')
    })

    it('redirects www/license to the apex first, which then redirects to the license service', () => {
      expectRedirect(runRequest('www.opensteward.dev', '/license'), 'https://opensteward.dev/license')
    })

    it('matches the host in any case and with a port', () => {
      expectRedirect(runRequest('WWW.OpenSteward.dev:443', '/'), 'https://opensteward.dev/')
    })
  })

  describe('routing and directory index pages', () => {
    it('serves the apex home page from site/', () => {
      expectUri(runRequest('opensteward.dev', '/'), '/site/index.html')
    })

    it('serves directory paths from their index.html', () => {
      expectUri(runRequest('opensteward.dev', '/security/'), '/site/security/index.html')
      expectUri(runRequest('docs.opensteward.dev', '/admin/status/'), '/docs/admin/status/index.html')
    })

    it('serves the docs host from docs/', () => {
      expectUri(runRequest('docs.opensteward.dev', '/'), '/docs/index.html')
      expectUri(runRequest('docs.opensteward.dev', '/pagefind/pagefind.js'), '/docs/pagefind/pagefind.js')
    })

    it('serves files as they are', () => {
      expectUri(runRequest('opensteward.dev', '/favicon.svg'), '/site/favicon.svg')
      expectUri(runRequest('opensteward.dev', '/robots.txt'), '/site/robots.txt')
    })

    it('redirects a directory path without its trailing slash, keeping the query', () => {
      expectRedirect(runRequest('opensteward.dev', '/security'), 'https://opensteward.dev/security/')
      expectRedirect(
        runRequest('docs.opensteward.dev', '/admin/status', { a: { value: '1' } }),
        'https://docs.opensteward.dev/admin/status/?a=1',
      )
    })

    it('never redirects to another site through the path', () => {
      // A relative Location of //evil.example/x/ or /\evil.example/x/ would leave the site.
      expectRedirect(runRequest('opensteward.dev', '//evil.example/x'), 'https://opensteward.dev//evil.example/x/')
      expectRedirect(runRequest('opensteward.dev', '/\\evil.example/x'), 'https://opensteward.dev/\\evil.example/x/')
      expectRedirect(
        runRequest('d111111abcdef8.cloudfront.net', '//evil.example/x'),
        'https://d111111abcdef8.cloudfront.net//evil.example/x/',
      )
      for (const uri of ['//evil.example/x', '/\\evil.example/x', '/a/b']) {
        const result = runRequest('www.opensteward.dev', uri) as { headers: Record<string, { value: string }> }
        expect(result.headers.location?.value.startsWith('https://opensteward.dev/')).toBe(true)
      }
    })

    it('serves the shared hashed assets from one prefix on every host', () => {
      expectUri(runRequest('opensteward.dev', '/_astro/index.Bx1.css'), '/_astro/index.Bx1.css')
      expectUri(runRequest('docs.opensteward.dev', '/_astro/index.Bx1.css'), '/_astro/index.Bx1.css')
    })

    it('treats an unknown or missing host as the marketing site', () => {
      expectUri(runRequest('d111111abcdef8.cloudfront.net', '/'), '/site/index.html')
      const noHost = viewerRequest({
        request: { method: 'GET', uri: '/', querystring: {}, headers: {} },
      })
      expectUri(noHost, '/site/index.html')
    })

    it('never lets one host reach the other site through its path', () => {
      expectUri(runRequest('opensteward.dev', '/docs/index.html'), '/site/docs/index.html')
      expectUri(runRequest('docs.opensteward.dev', '/site/index.html'), '/docs/site/index.html')
    })
  })
})

describe('viewer-response function', () => {
  // The uri as the viewer-request function leaves it: /site/... or /docs/...
  function runResponse(host: string, contentType?: string, uri = '/site/index.html'): Headers {
    const headers: Headers = contentType === undefined ? {} : { 'content-type': { value: contentType } }
    const result = viewerResponse({
      version: '1.0',
      context: { eventType: 'viewer-response' },
      request: request(host, uri),
      response: { statusCode: 200, statusDescription: 'OK', headers },
    }) as Response
    expect(result.statusCode).toBe(200)
    return result.headers
  }

  const csp = (headers: Headers): Map<string, string> =>
    new Map(
      (headers['content-security-policy']?.value ?? '')
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name = '', ...sources] = directive.split(/\s+/)
          return [name, sources.join(' ')] as const
        }),
    )

  it('stays under the 10 KB CloudFront Functions size limit', () => {
    expect(statSync(file('viewer-response')).size).toBeLessThan(10 * 1024)
  })

  it.each(['opensteward.dev', 'docs.opensteward.dev', 'd111111abcdef8.cloudfront.net'])(
    'sets every security header on %s',
    (host) => {
      const headers = runResponse(host, 'text/html')
      expect(headers['strict-transport-security']?.value).toBe('max-age=63072000; includeSubDomains; preload')
      expect(headers['x-content-type-options']?.value).toBe('nosniff')
      expect(headers['x-frame-options']?.value).toBe('DENY')
      expect(headers['referrer-policy']?.value).toBe('no-referrer')
      expect(headers['cross-origin-opener-policy']?.value).toBe('same-origin')
      expect(headers['cross-origin-resource-policy']?.value).toBe('same-site')
      expect(headers['permissions-policy']?.value).toContain('camera=()')
      expect(headers['content-security-policy']?.value).toBeTruthy()
    },
  )

  it("replaces the managed policy's weaker values and drops X-XSS-Protection", () => {
    const result = viewerResponse({
      request: request('opensteward.dev', '/site/index.html'),
      response: {
        statusCode: 200,
        headers: {
          'content-type': { value: 'text/html' },
          'x-frame-options': { value: 'SAMEORIGIN' },
          'referrer-policy': { value: 'strict-origin-when-cross-origin' },
          'strict-transport-security': { value: 'max-age=31536000' },
          'x-xss-protection': { value: '1; mode=block' },
        },
      },
    }) as Response
    expect(result.headers['x-frame-options']?.value).toBe('DENY')
    expect(result.headers['referrer-policy']?.value).toBe('no-referrer')
    expect(result.headers['strict-transport-security']?.value).toBe('max-age=63072000; includeSubDomains; preload')
    expect(result.headers['x-xss-protection']).toBeUndefined()
  })

  it('keeps headers the origin sent', () => {
    const headers = runResponse('opensteward.dev', 'text/html; charset=utf-8')
    expect(headers['content-type']?.value).toBe('text/html; charset=utf-8')
  })

  it('gives the marketing site a strict policy with no inline code and no framing', () => {
    const policy = csp(runResponse('opensteward.dev', 'text/html'))
    expect(policy.get('default-src')).toBe("'none'")
    expect(policy.get('script-src')).toBe("'self'")
    expect(policy.get('style-src')).toBe("'self'")
    expect(policy.get('img-src')).toBe("'self' data:")
    expect(policy.get('font-src')).toBe("'self'")
    expect(policy.get('connect-src')).toBe("'self'")
    expect(policy.get('frame-ancestors')).toBe("'none'")
    expect(policy.get('base-uri')).toBe("'none'")
    expect(policy.get('form-action')).toBe("'none'")
  })

  it('allows Brandfetch logos on the docs Platforms page, and nowhere else', () => {
    const docs = csp(runResponse('docs.opensteward.dev', 'text/html', '/docs/index.html'))
    const platforms = csp(runResponse('docs.opensteward.dev', 'text/html', '/docs/platforms/index.html'))
    expect(platforms.get('img-src')).toBe("'self' data: https://cdn.brandfetch.io")
    platforms.delete('img-src')
    docs.delete('img-src')
    expect(platforms).toEqual(docs)
    // Whether the viewer-response event carries the uri as the viewer sent it or as the
    // viewer-request function rewrote it, the page gets the same policy.
    for (const uri of ['/platforms/', '/platforms/index.html']) {
      expect(csp(runResponse('docs.opensteward.dev', 'text/html', uri)).get('img-src')).toBe(
        "'self' data: https://cdn.brandfetch.io",
      )
    }
    for (const [host, uri] of [
      ['docs.opensteward.dev', '/docs/unified-api/index.html'],
      ['docs.opensteward.dev', '/docs/platforms-other/index.html'],
      ['docs.opensteward.dev', '/platforms-other/'],
      ['opensteward.dev', '/site/platforms/index.html'],
      ['opensteward.dev', '/platforms/'],
    ] as const) {
      expect(csp(runResponse(host, 'text/html', uri)).get('img-src')).toBe("'self' data:")
    }
  })

  it("adds only 'wasm-unsafe-eval' for the docs search", () => {
    const site = csp(runResponse('opensteward.dev', 'text/html'))
    const docs = csp(runResponse('docs.opensteward.dev', 'text/html'))
    expect(docs.get('script-src')).toBe("'self' 'wasm-unsafe-eval'")
    docs.delete('script-src')
    site.delete('script-src')
    expect(docs).toEqual(site)
  })

  it('never allows inline script or eval anywhere', () => {
    for (const [host, type] of [
      ['opensteward.dev', 'text/html'],
      ['docs.opensteward.dev', 'text/html'],
      ['opensteward.dev', 'image/svg+xml'],
      ['docs.opensteward.dev', 'application/javascript'],
    ] as const) {
      const value = runResponse(host, type)['content-security-policy']?.value ?? ''
      expect(value).not.toContain("'unsafe-eval'")
      const scriptSrc = csp(runResponse(host, type)).get('script-src') ?? ''
      expect(scriptSrc).not.toContain("'unsafe-inline'")
    }
  })

  it('gives SVG files a policy that allows their own styles and no script', () => {
    const policy = csp(runResponse('docs.opensteward.dev', 'image/svg+xml'))
    expect(policy.get('default-src')).toBe("'none'")
    expect(policy.has('script-src')).toBe(false)
    expect(policy.get('style-src')).toBe("'unsafe-inline'")
    expect(policy.get('frame-ancestors')).toBe("'none'")
  })

  it('treats a response without a content type as a page', () => {
    expect(csp(runResponse('opensteward.dev')).get('script-src')).toBe("'self'")
  })
})
