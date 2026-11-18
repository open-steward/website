// The contrast of a diagram's labels: every piece of text in the SVGs on the page, its colour and
// the colour painted behind it (the shapes under it, blended down to the page background), and
// the WCAG contrast ratio between the two.

// WCAG AA for body text. The diagrams' labels are 12 to 14px, and smaller when a wide diagram is
// scaled to fit the page, so no label counts as large text.
export const MIN_CONTRAST = 4.5

/** A hex or rgb() colour as [r, g, b], or null for any other form. */
export function parseColour(text) {
  const value = text.trim().replace(/\s*!important$/, '')
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16))
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0*)?\s*)?\)$/i.exec(value)
  return rgb ? rgb.slice(1, 4).map(Number) : null
}

/** The WCAG contrast ratio of two [r, g, b] colours. */
export function contrastRatio(a, b) {
  const luminance = ([r, g, b]) => {
    const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Runs in the page, through page.evaluate, so it uses nothing from outside its own body.
 * @param {string} background the CSS colour the images sit on
 * @returns {{ text: string, ratio: number, colour: string, background: string }[]}
 */
export function measureLabels(background) {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  // Any CSS colour, as the browser paints it: [r, g, b, alpha].
  const rgba = (colour) => {
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = '#000'
    canvas.fillStyle = colour
    canvas.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const luminance = ([r, g, b]) => {
    const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  }
  const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  const opacity = (element) => {
    let value = 1
    for (let e = element; e instanceof Element; e = e.parentElement) value *= Number(getComputedStyle(e).opacity)
    return value
  }
  const SHAPES = new Set(['rect', 'path', 'polygon', 'polyline', 'circle', 'ellipse'])
  // What an element paints behind a label, or null for nothing.
  const paint = (element) => {
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden') return null
    let colour
    if (element instanceof SVGElement && element.localName !== 'svg') {
      if (!SHAPES.has(element.localName) || style.fill === 'none' || style.fill.startsWith('url(')) return null
      colour = rgba(style.fill)
      colour[3] *= Number(style.fillOpacity)
    } else {
      colour = rgba(style.backgroundColor)
    }
    colour[3] *= opacity(element)
    return colour[3] > 0 ? colour : null
  }
  // Blend layers (topmost first) down onto the page.
  const flatten = (layers) => layers.reduceRight((under, layer) => over(layer, under), rgba(background))

  // Hit testing finds markers' shapes only through what they mark, so a label is not under them.
  const markerUnder = (label) => {
    if (!label.classList.contains('sequenceNumber')) return null
    const circle = label.ownerSVGElement?.querySelector('marker[id$="sequencenumber"] circle')
    return circle ? paint(circle) : null
  }

  const style = document.createElement('style')
  // Hit testing skips elements that ignore the pointer; every shape is behind something here.
  style.textContent = 'svg * { pointer-events: auto !important; }'
  document.head.append(style)
  const results = []
  const labels = document.querySelectorAll(
    'svg text:not(:has(tspan)), svg tspan, svg foreignObject p, svg foreignObject :is(span, div):not(:has(*))',
  )
  for (const label of labels) {
    const text = label.textContent.trim()
    const isSvg = label instanceof SVGElement
    if (!text || (!isSvg && label.closest('text'))) continue
    const labelStyle = getComputedStyle(label)
    if (labelStyle.visibility === 'hidden' || labelStyle.display === 'none') continue
    const colour = rgba(isSvg ? labelStyle.fill : labelStyle.color)
    if (isSvg) colour[3] *= Number(labelStyle.fillOpacity)
    colour[3] *= opacity(label)
    // Text no one can see is not a label (Mermaid keeps some empty or transparent placeholders).
    if (colour[3] < 0.01) continue
    label.scrollIntoView({ block: 'center', inline: 'center' })
    const box = label.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue

    let worst
    const marker = markerUnder(label)
    // Across the label, where the shapes under it may change.
    for (const across of marker ? [0.5] : [0.25, 0.5, 0.75]) {
      const layers = []
      if (marker) layers.push(marker)
      else {
        for (const element of document.elementsFromPoint(box.left + box.width * across, box.top + box.height / 2)) {
          if (element === document.body || element === document.documentElement) break
          if (element === label || (isSvg && (element.localName === 'text' || element.localName === 'tspan'))) continue
          const layer = paint(element)
          if (!layer) continue
          layers.push(layer)
          if (layer[3] >= 0.999) break
        }
      }
      const under = flatten(layers)
      const ratio = contrast(over(colour, under), under)
      if (!worst || ratio < worst.ratio) worst = { ratio, colour: over(colour, under), background: under }
    }
    results.push({
      text: text.slice(0, 60),
      ratio: Math.round(worst.ratio * 100) / 100,
      colour: hex(worst.colour),
      background: hex(worst.background),
    })
  }
  style.remove()
  window.scrollTo(0, 0)
  return results
}
