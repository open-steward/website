import { describe, expect, it } from 'vitest'
import { pageToMarkdown } from '../lib/html-to-markdown.mjs'

const page = (main) => `<!doctype html><html><head><title>x</title></head><body><nav><a href="/">Home</a></nav><main>${main}</main><footer>f</footer></body></html>`

describe('pageToMarkdown', () => {
  it('converts only <main>, with absolute links and images', () => {
    const md = pageToMarkdown(page('<h1>Title</h1><p>See <a href="/security/">security</a>.</p><img src="/a.png" alt="A">'), 'https://opensteward.dev/')
    expect(md).toContain('# Title')
    expect(md).toContain('[security](https://opensteward.dev/security/)')
    expect(md).toContain('![A](https://opensteward.dev/a.png)')
    expect(md).not.toContain('Home')
    expect(md).not.toContain('f\n')
  })

  it('leaves out what assistive technology skips too, icons and controls', () => {
    const md = pageToMarkdown(
      page('<p><span aria-hidden="true">X</span>Xero <svg><title>icon</title></svg><button>Copy</button><span hidden>secret</span></p>'),
      'https://opensteward.dev/',
    )
    expect(md.trim()).toBe('Xero')
  })

  it('keeps elements that sit side by side apart', () => {
    const md = pageToMarkdown(page('<p><a href="https://a.example/">One</a><a href="/two/">Two</a></p>'), 'https://opensteward.dev/')
    expect(md).toContain('[One](https://a.example/) [Two](https://opensteward.dev/two/)')
  })

  it('leaves code exactly as it is', () => {
    const md = pageToMarkdown(page('<pre><code><span>git</span><span> clone</span></code></pre>'), 'https://opensteward.dev/')
    expect(md).toContain('```\ngit clone\n```')
  })

  it('refuses a page without <main>', () => {
    expect(() => pageToMarkdown('<html><body><p>x</p></body></html>', 'https://opensteward.dev/')).toThrow(/no <main>/)
  })
})
