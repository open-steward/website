// Renders Mermaid diagrams to SVG files at build time, in a headless Chromium. The pages then
// show them as images: no Mermaid JavaScript in the browser, and no inline styles for the
// Content-Security-Policy to allow (an SVG's own styles stay inside the image).
//
// Each diagram renders twice, once per theme, with the design system's colours. Results are
// cached by a hash of the Mermaid version, the theme and the source, in .cache/mermaid/.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { contrastRatio, MIN_CONTRAST, measureLabels, parseColour } from './contrast.mjs'

const require = createRequire(import.meta.url)
const mermaidScript = require.resolve('mermaid/dist/mermaid.min.js')
const mermaidVersion = JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8')).version

// Images cannot load web fonts, so the diagrams use a font every system has with the same
// metrics (Arial; Linux maps it to Liberation Sans), and the boxes fit wherever they are
// viewed. No quotes: Mermaid drops a font-family value that has them.
const FONT = 'Arial, Helvetica, sans-serif'
// Mermaid sizes each box by measuring its label in the page, then writes the box sizes into the
// SVG. So one font holds both while it measures and in the file, whatever a diagram's own init
// directive asks for: the product's name a font Mermaid's sanitizer blanks, which once left
// labels measured in the page's default serif and shown in Arial, wider than their boxes.
const fontRule = (selector) => `${selector} { font-family: ${FONT} !important; }`

export const THEMES = {
  light: {
    theme: 'base',
    themeVariables: {
      fontFamily: FONT,
      fontSize: '14px',
      background: 'transparent',
      primaryColor: '#F1F5EE',
      primaryBorderColor: '#6B8E56',
      primaryTextColor: '#17180F',
      secondaryColor: '#F3F1EC',
      secondaryBorderColor: '#B8B2A3',
      tertiaryColor: '#FFFFFF',
      tertiaryBorderColor: '#DAD6CB',
      lineColor: '#73746A',
      textColor: '#17180F',
      noteBkgColor: '#FBEFD7',
      noteBorderColor: '#B5751E',
      noteTextColor: '#5C3A0E',
      clusterBkg: '#FAF9F6',
      clusterBorder: '#DAD6CB',
      edgeLabelBackground: '#FAF9F6',
      actorBkg: '#F1F5EE',
      actorBorder: '#6B8E56',
      signalColor: '#46483A',
      signalTextColor: '#17180F',
      // The autonumber digits, on a circle in signalColor.
      sequenceNumberColor: '#FFFFFF',
    },
  },
  dark: {
    theme: 'base',
    themeVariables: {
      darkMode: true,
      fontFamily: FONT,
      fontSize: '14px',
      background: 'transparent',
      primaryColor: '#2B3524',
      primaryBorderColor: '#90AE78',
      primaryTextColor: '#EDEBE5',
      secondaryColor: '#33302A',
      secondaryBorderColor: '#6F6A5F',
      tertiaryColor: '#26241F',
      tertiaryBorderColor: '#57534A',
      lineColor: '#A5A599',
      textColor: '#EDEBE5',
      noteBkgColor: '#3D2F17',
      noteBorderColor: '#D9A050',
      noteTextColor: '#F5E3C4',
      clusterBkg: '#211F1B',
      clusterBorder: '#57534A',
      edgeLabelBackground: '#211F1B',
      actorBkg: '#2B3524',
      actorBorder: '#90AE78',
      signalColor: '#C9C6BC',
      signalTextColor: '#EDEBE5',
      sequenceNumberColor: '#17180F',
    },
  },
}

// What the images sit on: .diagram-figure's background (theme.css), the design system's
// --surface-0 in each theme. Labels are checked for contrast against it.
export const FIGURE_BACKGROUND = { light: '#FFFFFF', dark: 'oklch(0.22 0.012 70)' }

const OPTIONS = {
  // Bump to re-render every cached diagram after changing how they are produced.
  revision: 4,
  startOnLoad: false,
  securityLevel: 'strict',
  // Keys a diagram's own init directive cannot change (Mermaid's defaults, then the look): each
  // theme's palette and font hold. The product README's directive names its light colours, which
  // once gave the dark theme's edge labels dark text on a dark ground.
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'suppressErrorRendering',
    'maxEdges',
    'theme',
    'themeVariables',
    'themeCSS',
    'darkMode',
    'fontFamily',
  ],
  // The product's diagrams use <b>, <i> and <br/> in labels, which need HTML labels.
  htmlLabels: true,
  flowchart: { htmlLabels: true, useMaxWidth: false },
  sequence: { useMaxWidth: false },
}

// The themes' text colours. The product's classDef and style fills are picked for a light page;
// one that sets no text colour would show the dark theme's pale text on a pastel, so it gets
// whichever of these reads better on its fill, in both themes.
const TEXT_COLOURS = [THEMES.light.themeVariables.textColor, THEMES.dark.themeVariables.textColor]

/** The diagram source with a text colour for every classDef and style that sets only a fill. */
export function withTextColours(source) {
  return source
    .split('\n')
    .map((line) => {
      const match = /^(\s*(?:classDef|style)\s+\S+\s+)(.*?)(;?\s*)$/.exec(line)
      if (!match) return line
      // Split on the commas between properties, not those inside rgb().
      const properties = match[2].split(/,(?![^(]*\))/).map((property) => property.split(':').map((part) => part.trim()))
      if (properties.some(([name]) => name === 'color')) return line
      const fill = properties.find(([name]) => name === 'fill')
      const rgb = fill && parseColour(fill[1] ?? '')
      if (!rgb) return line
      const best = TEXT_COLOURS.reduce((a, b) =>
        contrastRatio(rgb, parseColour(b)) > contrastRatio(rgb, parseColour(a)) ? b : a,
      )
      return `${match[1]}${match[2]},color:${best}${match[3]}`
    })
    .join('\n')
}

const cacheKey = (theme, source) =>
  createHash('sha256')
    .update(`${mermaidVersion}\n${JSON.stringify(OPTIONS)}\n${JSON.stringify(THEMES[theme])}\n${source}`)
    .digest('hex')
    .slice(0, 20)

/**
 * @param {{ id: string, source: string }[]} diagrams
 * @param {string} cacheDir
 * @returns {Promise<Map<string, { light: Rendered, dark: Rendered, error?: string }>>} by diagram id
 * @typedef {{ name: string, svg: string, width: number, height: number }} Rendered
 */
export async function renderDiagrams(diagrams, cacheDir) {
  mkdirSync(cacheDir, { recursive: true })
  const results = new Map()
  const missing = []
  for (const diagram of diagrams) {
    const entry = {}
    for (const theme of Object.keys(THEMES)) {
      const name = `${cacheKey(theme, diagram.source)}.svg`
      const file = join(cacheDir, name)
      if (existsSync(file)) entry[theme] = withSize(name, readFileSync(file, 'utf8'))
      else missing.push({ diagram, theme, name, file })
    }
    results.set(diagram.id, entry)
  }
  if (missing.length === 0) return results

  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const unreadable = []
  try {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><html><head><style>${fontRule('*')}</style></head><body></body></html>`)
    await page.addScriptTag({ path: mermaidScript })
    for (const { diagram, theme, name, file } of missing) {
      if (results.get(diagram.id).error) continue
      const renderId = `d${name.slice(0, 12)}`
      const svg = await page.evaluate(
        async ({ source, options, config, renderId, fileFontRule }) => {
          const mermaid = window.mermaid
          mermaid.initialize({ ...options, ...config })
          const { svg } = await mermaid.render(renderId, source)
          // Mermaid returns HTML-flavoured markup (<br> in HTML labels). Saved as an .svg file it
          // is parsed as XML, so re-serialise it as well-formed XML.
          const holder = document.createElement('div')
          holder.innerHTML = svg
          const root = holder.querySelector('svg')
          // The font the boxes were measured in, over any the diagram's own styles name.
          const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
          style.textContent = fileFontRule
          root.prepend(style)
          return new XMLSerializer().serializeToString(root)
        },
        {
          source: withTextColours(diagram.source),
          options: OPTIONS,
          config: THEMES[theme],
          renderId,
          fileFontRule: fontRule(`#${renderId}, #${renderId} *`),
        },
      ).catch((error) => {
        // A diagram Mermaid cannot parse is shown as its source instead; the build goes on.
        results.get(diagram.id).error = String(error.message ?? error).split('\n').slice(0, 3).join(' ')
        return undefined
      })
      if (svg === undefined) continue
      // Shown as an image, an SVG never runs script; this keeps any out of the files as well.
      if (/<script|\son[a-z]+\s*=|javascript:/i.test(svg)) {
        throw new Error(`diagram ${diagram.id} rendered script; refusing to publish it`)
      }
      // Every label against what is painted behind it, on the page the image sits on.
      await page.evaluate((markup) => {
        document.body.innerHTML = markup
      }, svg)
      const low = (await page.evaluate(measureLabels, FIGURE_BACKGROUND[theme])).filter(
        (label) => label.ratio < MIN_CONTRAST,
      )
      await page.evaluate(() => document.body.replaceChildren())
      if (low.length > 0) {
        for (const label of low) {
          unreadable.push(`${diagram.id} (${theme}): "${label.text}" ${label.colour} on ${label.background} is ${label.ratio}:1`)
        }
        continue
      }
      const doc = `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`
      writeFileSync(file, doc)
      results.get(diagram.id)[theme] = withSize(name, doc)
    }
  } finally {
    await browser.close()
  }
  if (unreadable.length > 0) {
    throw new Error(
      `${unreadable.length} diagram labels are below ${MIN_CONTRAST}:1 contrast. Colours the product's ` +
        `diagram sets itself are fixed there; others in apps/docs/scripts/mermaid.mjs.\n  ` +
        unreadable.slice(0, 20).join('\n  ') +
        (unreadable.length > 20 ? `\n  and ${unreadable.length - 20} more` : ''),
    )
  }
  return results
}

function withSize(name, svg) {
  const viewBox = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg)
  const width = viewBox ? Math.ceil(Number(viewBox[1])) : 800
  const height = viewBox ? Math.ceil(Number(viewBox[2])) : 600
  return { name, svg, width, height }
}
