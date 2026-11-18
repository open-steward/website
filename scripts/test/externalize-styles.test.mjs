import { describe, expect, it } from 'vitest'
import { StyleCollector, linkStylesheet, toImportant } from '../lib/externalize-styles.mjs'

describe('StyleCollector', () => {
  it('turns a style attribute into a class with the same declarations', () => {
    const collector = new StyleCollector()
    const { html, changed } = collector.rewrite('<span style="--0:#D6DEEB;--1:#403F53">x</span>')
    expect(changed).toBe(true)
    const [[declarations, name]] = collector.classes
    expect(html).toBe(`<span class="${name}">x</span>`)
    expect(declarations).toBe('--0:#D6DEEB !important;--1:#403F53 !important')
    expect(collector.stylesheet().text).toContain(`.${name}{--0:#D6DEEB !important;--1:#403F53 !important}`)
  })

  it('gives the same declarations the same class, across pages', () => {
    const collector = new StyleCollector()
    const a = collector.rewrite('<i style="color:red">a</i>').html
    const b = collector.rewrite('<b style="color:red">b</b>').html
    expect(collector.classes.size).toBe(1)
    expect(a.match(/class="([^"]+)"/)[1]).toBe(b.match(/class="([^"]+)"/)[1])
  })

  it('merges into an existing class attribute, wherever the attributes are', () => {
    const collector = new StyleCollector()
    const { html } = collector.rewrite('<div class="frame" style="color:red" data-x="1">x</div>')
    expect(html).toMatch(/^<div class="frame sa-[0-9a-f]{10}" data-x="1">x<\/div>$/)
  })

  it('is not fooled by ">" inside a quoted attribute value', () => {
    const collector = new StyleCollector()
    const { html } = collector.rewrite('<img alt="a > b" style="width:10px" src="/x.png">')
    expect(html).toMatch(/^<img alt="a > b" src="\/x.png" class="sa-[0-9a-f]{10}">$/)
  })

  it('handles self-closing tags and drops empty styles', () => {
    const collector = new StyleCollector()
    expect(collector.rewrite('<br style=""/>').html).toBe('<br/>')
    expect(collector.classes.size).toBe(0)
  })

  it('refuses values it cannot move safely, instead of guessing', () => {
    for (const style of [
      'font-family:&quot;Inter&quot;, sans-serif',
      'background:url(data:image/svg+xml;utf8,x)',
      'width:calc(1px + 2px)',
      'color:red}body{display:none',
    ]) {
      expect(() => new StyleCollector().rewrite(`<p style="${style}">x</p>`)).toThrow(/refusing/)
    }
  })

  it('leaves comments, scripts, textareas and titles alone', () => {
    const page =
      '<!-- <i style="color:red"> --><script type="application/json">{"a":"<b style=\\"x:y\\">"}</script>' +
      '<textarea><i style="color:red"></textarea><title>a <i style="color:red"></title>'
    expect(new StyleCollector().rewrite(page)).toEqual({ html: page, changed: false })
  })

  it('does not see style= inside another attribute value', () => {
    const page = `<a title='x style="color:red"' href="/">x</a>`
    expect(new StyleCollector().rewrite(page)).toEqual({ html: page, changed: false })
  })

  it('refuses a single-quoted class it would otherwise drop', () => {
    expect(() => new StyleCollector().rewrite(`<p class='a' style="color:red">x</p>`)).toThrow(/class attribute/)
  })

  it('leaves pages without style attributes untouched', () => {
    const collector = new StyleCollector()
    const page = '<p class="a">styled text: style="x"</p>'
    expect(collector.rewrite(page)).toEqual({ html: page, changed: false })
  })

  it('names the stylesheet by its content', () => {
    const a = new StyleCollector()
    a.rewrite('<i style="color:red">x</i>')
    const b = new StyleCollector()
    b.rewrite('<i style="color:blue">x</i>')
    expect(a.stylesheet().name).toMatch(/^attr-styles\.[0-9a-f]{8}\.css$/)
    expect(a.stylesheet().name).not.toBe(b.stylesheet().name)
  })
})

describe('toImportant', () => {
  it('refuses declarations that could end the rule or open a comment', () => {
    for (const bad of ['color:red}body{display:none', 'a:b{', 'x:/* y */', 'x:</style>', 'x:\\61', 'nocolon', ':red']) {
      expect(() => toImportant(bad)).toThrow(/refusing/)
    }
  })

  it('keeps an existing !important', () => {
    expect(toImportant('color: red !important; ')).toBe('color:red !important')
  })
})

describe('linkStylesheet', () => {
  it('adds the link at the end of <head>', () => {
    expect(linkStylesheet('<head><title>x</title></head><body></body>', '/_astro/a.css')).toBe(
      '<head><title>x</title><link rel="stylesheet" href="/_astro/a.css"></head><body></body>',
    )
  })

  it('refuses a page without <head>', () => {
    expect(() => linkStylesheet('<p>x</p>', '/a.css')).toThrow()
  })
})
