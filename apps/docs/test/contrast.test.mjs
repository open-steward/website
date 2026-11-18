import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { measureLabels } from '../scripts/contrast.mjs'

// Labels as Mermaid draws them: SVG text on a shape, an HTML label on a shape, and a sequence
// number on its marker circle. The page behind the image is the last layer.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="300" viewBox="0 0 2400 300">
  <defs><marker id="d1-sequencenumber" refX="15" refY="15" markerWidth="60" markerHeight="40">
    <circle cx="15" cy="15" r="6" style="fill:#46483A"/></marker></defs>
  <rect x="0" y="0" width="300" height="100" style="fill:#FFFFFF"/>
  <text x="20" y="50" style="fill:#000000">black on white</text>
  <rect x="400" y="0" width="300" height="100" style="fill:#dbeafe"/>
  <foreignObject x="400" y="30" width="300" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#EDEBE5"><p>pale on pastel</p></div></foreignObject>
  <rect x="800" y="0" width="300" height="100" style="fill:#000000;opacity:0.5"/>
  <text x="820" y="50"><tspan style="fill:#FFFFFF">white on half black</tspan></text>
  <text x="2200" y="250" style="fill:#000000">far off screen</text>
  <text x="1300" y="50" class="sequenceNumber" style="fill:#8C8B95">1</text>
</svg>`

describe('measureLabels', () => {
  let browser
  let labels

  beforeAll(async () => {
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><body>${SVG}</body>`)
    labels = Object.fromEntries((await page.evaluate(measureLabels, '#FFFFFF')).map((l) => [l.text, l]))
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('measures SVG text against the shape behind it', () => {
    expect(labels['black on white'].ratio).toBeCloseTo(21, 0)
  })

  it('measures HTML labels against the shape behind them', () => {
    expect(labels['pale on pastel'].ratio).toBeLessThan(1.1)
    expect(labels['pale on pastel'].background).toBe('#dbeafe')
  })

  it('blends a translucent shape with what is under it', () => {
    // Half-black over the white page: #808080.
    expect(labels['white on half black'].background).toBe('#808080')
    expect(labels['white on half black'].ratio).toBeCloseTo(3.95, 1)
  })

  it('measures labels outside the viewport too', () => {
    expect(labels['far off screen'].ratio).toBeCloseTo(21, 0)
  })

  it('measures a sequence number against its marker circle', () => {
    expect(labels['1'].background).toBe('#46483a')
    expect(labels['1'].ratio).toBeLessThan(3)
  })
})
