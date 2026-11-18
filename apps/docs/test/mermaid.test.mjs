import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIN_CONTRAST, measureLabels } from '../scripts/contrast.mjs'
import { FIGURE_BACKGROUND, renderDiagrams, withTextColours } from '../scripts/mermaid.mjs'

// The product README's diagrams set their own font in an init directive. Mermaid's sanitizer
// blanks that value (it has hyphens), which once left the labels measured in the render page's
// default serif font and then shown in Arial: wider than their boxes, so the last letter was cut.
const SOURCE = `%%{init: {'theme':'base','themeVariables':{'fontFamily':'Inter Tight, ui-sans-serif, system-ui, sans-serif'}}}%%
flowchart TB
  subgraph Operator["Operator"]
    App["your app<br/><i>REST</i>"]
  end
  subgraph EndCust["End-customers"]
    Cust["customers<br/><i>OAuth · Connect Link</i>"]
  end
  App --> Cust`

describe('renderDiagrams', () => {
  let dir
  let rendered
  let browser
  let page

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mermaid-test-'))
    rendered = (await renderDiagrams([{ id: 'overview', source: SOURCE }], dir)).get('overview')
    browser = await chromium.launch()
    page = await browser.newPage()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it.each(['light', 'dark'])('sizes every label for the font it is shown in (%s)', async (theme) => {
    expect(rendered.error).toBeUndefined()
    // Inline, the SVG's own declarations decide its font, as they do when it is shown as an image.
    await page.setContent(`<!doctype html><body>${rendered[theme].svg.replace(/^<\?xml[^>]*>\s*/, '')}</body>`)
    const labels = await page.$$eval('foreignObject', (objects) =>
      objects.map((object) => {
        const content = object.firstElementChild
        return {
          text: content.textContent,
          box: object.getBoundingClientRect().width,
          needs: content.getBoundingClientRect().width,
          font: getComputedStyle(content.querySelector('p') ?? content).fontFamily,
        }
      }),
    )
    expect(labels.map((label) => label.text)).toEqual(expect.arrayContaining(['Operator', 'End-customers']))
    for (const label of labels) {
      expect(label.font, label.text).toMatch(/^Arial\b/)
      expect(label.needs, label.text).toBeLessThanOrEqual(label.box + 0.5)
    }
  })
})

// Colours as the product's diagrams set them, for a light page: pastel classDef fills with no
// text colour, a dark fill with none, a style line, and an init directive that names the light
// palette's text colour (which the dark theme once took up for its edge labels).
const COLOURED = `%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FAF9F6','primaryTextColor':'#17180F','lineColor':'#A5A599'}}}%%
flowchart LR
  classDef pastel fill:#dbeafe,stroke:#1e40af
  classDef deep fill:#4E7340,stroke:#2F4627
  A[pastel node]:::pastel -->|edge label| B[deep node]:::deep
  B --> C[styled node]
  style C fill:#fee2e2,stroke:#b91c1c`

const NUMBERED = `sequenceDiagram
  autonumber
  participant A as Client
  participant B as Server
  A->>B: request
  B-->>A: response`

describe('renderDiagrams contrast', () => {
  let dir
  let rendered
  let browser
  let page

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mermaid-test-'))
    rendered = await renderDiagrams(
      [
        { id: 'coloured', source: COLOURED },
        { id: 'numbered', source: NUMBERED },
      ],
      dir,
    )
    browser = await chromium.launch()
    page = await browser.newPage()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it.each([
    ['coloured', 'light'],
    ['coloured', 'dark'],
    ['numbered', 'light'],
    ['numbered', 'dark'],
  ])('keeps every label in %s readable (%s)', async (id, theme) => {
    const diagram = rendered.get(id)
    expect(diagram.error).toBeUndefined()
    await page.setContent(`<!doctype html><body>${diagram[theme].svg.replace(/^<\?xml[^>]*>\s*/, '')}</body>`)
    const labels = await page.evaluate(measureLabels, FIGURE_BACKGROUND[theme])
    expect(labels.length).toBeGreaterThan(3)
    for (const label of labels) expect(label.ratio, `${label.text}: ${label.colour} on ${label.background}`).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('refuses a diagram whose own colours leave a label unreadable', async () => {
    const source = 'flowchart LR\n  classDef faint fill:#dbeafe,color:#c7d2fe\n  A[faint label]:::faint'
    await expect(renderDiagrams([{ id: 'faint', source }], dir)).rejects.toThrow(/faint label/)
  }, 120_000)
})

describe('withTextColours', () => {
  it('gives a fill without a text colour the theme text that reads best on it', () => {
    expect(withTextColours('  classDef a fill:#dbeafe,stroke:#1e40af')).toBe('  classDef a fill:#dbeafe,stroke:#1e40af,color:#17180F')
    expect(withTextColours('style B fill:#4E7340;')).toBe('style B fill:#4E7340,color:#EDEBE5;')
    expect(withTextColours('classDef c fill:rgb(254, 226, 226),stroke:#b91c1c')).toBe(
      'classDef c fill:rgb(254, 226, 226),stroke:#b91c1c,color:#17180F',
    )
  })

  it('leaves text colours the diagram sets, and colours it cannot read, alone', () => {
    for (const line of ['classDef a fill:#dbeafe,color:#1e3a8a', 'style B fill:teal', 'A --> B', 'classDef d stroke:#000']) {
      expect(withTextColours(line)).toBe(line)
    }
  })
})
