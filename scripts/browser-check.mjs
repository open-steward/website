#!/usr/bin/env node
// Loads the built sites in real browsers (Chromium and WebKit) through the local preview,
// which applies the production CloudFront Functions and so the production
// Content-Security-Policy. Fails on any CSP violation, console error or failed request, and
// checks that the theme toggle and the docs search (Pagefind, WebAssembly) work under it, that
// the marketing pages' buttons keep readable text when hovered, and that the commercial
// licensing decision tree works, with and without JavaScript. On the docs' Platforms page,
// Brandfetch's logo CDN is stubbed: the checks never call it.
//
//   node scripts/browser-check.mjs              (after `pnpm build`)
//   SCREENSHOTS=<dir> node scripts/browser-check.mjs   also saves a screenshot of each page
//   BROWSER=webkit node scripts/browser-check.mjs       one browser only (CI runs one job each)

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'

const PORT = 4400 + Math.floor(Math.random() * 400)
const SITE = `http://localhost:${PORT}`
const DOCS = `http://localhost:${PORT + 1}`
const shots = process.env.SCREENSHOTS
const browserTypes = [chromium, webkit].filter((b) => !process.env.BROWSER || b.name() === process.env.BROWSER)
if (browserTypes.length === 0) throw new Error(`BROWSER=${process.env.BROWSER}: expected chromium or webkit`)

const PAGES = [
  { url: `${SITE}/`, name: 'site-home' },
  { url: `${SITE}/security/`, name: 'site-security' },
  { url: `${SITE}/commercial-licensing/`, name: 'site-commercial-licensing' },
  { url: `${SITE}/no-such-page/`, name: 'site-404', status: 404 },
  { url: `${DOCS}/`, name: 'docs-home' },
  { url: `${DOCS}/dev-api/`, name: 'docs-dev-api' },
  { url: `${DOCS}/architecture/`, name: 'docs-architecture' },
  { url: `${DOCS}/admin/status/`, name: 'docs-admin-status' },
  { url: `${DOCS}/integrate/customer-support/zendesk/`, name: 'docs-zendesk' },
  { url: `${DOCS}/unified-api/`, name: 'docs-unified-api', swagger: true },
  { url: `${DOCS}/operator-api/`, name: 'docs-operator-api', swagger: true },
  { url: `${DOCS}/platforms/`, name: 'docs-platforms', brandfetch: true },
  { url: `${DOCS}/no-such-page/`, name: 'docs-404', status: 404 },
]

const server = spawn(process.execPath, [join(import.meta.dirname, 'preview.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('docs.opensteward.dev')) resolve()
  })
  server.on('exit', (code) => reject(new Error(`preview exited with ${code}`)))
})

const problems = []
const note = (browser, page, message) => problems.push(`[${browser}] ${page}: ${message}`)

// The WCAG contrast of an element's text against the background painted behind it (its own
// and its ancestors' backgrounds, blended), as the browser has it at that moment.
function textContrast(node) {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
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
  const layers = []
  for (let e = node; e; e = e.parentElement) {
    const colour = rgba(getComputedStyle(e).backgroundColor)
    if (colour[3] > 0) layers.push(colour)
    if (colour[3] >= 0.999) break
  }
  const background = layers.reduceRight((under, layer) => over(layer, under), [255, 255, 255, 1])
  const text = [node, ...node.querySelectorAll('*')].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) ?? node
  const colour = over(rgba(getComputedStyle(text).color), background)
  const [light, dark] = [luminance(colour), luminance(background)].sort((x, y) => y - x)
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

// Every button's text stays readable at rest and hovered (WCAG AA, 4.5:1), in both themes.
async function checkButtons(page, label, name) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t)
      // Hover colours are measured at their end, not part-way through a transition.
      for (const b of document.querySelectorAll('.btn')) b.style.transition = 'none'
    }, theme)
    const buttons = page.locator('.btn:visible')
    for (let i = 0; i < (await buttons.count()); i++) {
      const button = buttons.nth(i)
      const text = (await button.innerText()).trim() || (await button.getAttribute('aria-label')) || 'button'
      for (const state of ['at rest', 'hovered']) {
        if (state === 'hovered') await button.hover()
        const ratio = await button.evaluate(textContrast)
        if (ratio < 4.5) note(label, name, `"${text.slice(0, 40)}" ${state} in the ${theme} theme: text contrast ${ratio}:1`)
      }
      await page.mouse.move(0, 0)
    }
  }
}

// The commercial licensing page's decision tree: a path to each verdict, re-branching, focus,
// the live region, the verdicts' contrast in both themes, and the list without JavaScript.
async function checkDecisionTree(page, label, name, viewport) {
  const fail = (message) => note(label, name, message)
  const question = (n) => page.locator(`[data-question="${n}"]`)
  const verdict = page.locator('[data-verdict]')
  try {
    await question(1).waitFor({ timeout: 5_000 })
  } catch {
    fail('[data-question="1"] not found: the tree did not start')
    return
  }

  if (await page.locator('button[data-restart]').isVisible()) fail('"Start over" shows before any answer')

  const walk = async (words) => {
    for (const [i, word] of words.entries()) {
      await question(i + 1).locator(`button[data-answer="${word}"]`).click()
      const focus = await page.evaluate(() => {
        const active = document.activeElement
        if (active?.matches('[data-verdict]')) return 'verdict'
        const asked = [...document.querySelectorAll('[data-question]')].at(-1)
        return active === asked?.querySelector('button[data-answer="yes"]') ? 'next' : active?.outerHTML.slice(0, 80)
      })
      if (focus !== 'verdict' && focus !== 'next') fail(`after ${words.slice(0, i + 1).join(', ')}, focus is on ${focus}`)
    }
  }
  const expectVerdict = async (path, kind) => {
    const shown = await verdict.getAttribute('data-verdict', { timeout: 2_000 }).catch(() => null)
    if (shown !== kind) fail(`${path}: verdict ${shown}, expected ${kind}`)
    if ((await page.locator('[aria-live="polite"] [data-verdict]').count()) !== 1) fail(`${path}: the verdict is not in an aria-live="polite" region`)
    if ((await page.locator('button[data-answer]:not([aria-pressed])').count()) > 0) fail(`${path}: an answer button has no aria-pressed`)
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    for (const t of ['light', 'dark']) {
      await page.evaluate((v) => {
        document.documentElement.setAttribute('data-theme', v)
        // Colours are measured at their end, not part-way through a transition.
        for (const b of document.querySelectorAll('.btn')) b.style.transition = 'none'
      }, t)
      const texts = verdict.locator(':scope > :is(h2, h3, h4, p):not(:has(.btn)), :scope .btn')
      for (let i = 0; i < (await texts.count()); i++) {
        const ratio = await texts.nth(i).evaluate(textContrast)
        if (ratio < 4.5) fail(`${kind} verdict, ${t} theme: "${(await texts.nth(i).innerText()).slice(0, 40)}" contrast ${ratio}:1`)
      }
    }
    await page.evaluate((v) => (v ? document.documentElement.setAttribute('data-theme', v) : document.documentElement.removeAttribute('data-theme')), theme)
  }
  const restart = () => page.locator('button[data-restart]').click()

  await walk(['yes'])
  await expectVerdict('yes', 'permitted')
  const cta = verdict.locator('a.btn.btn--primary')
  if ((await cta.count()) !== 1 || (await cta.innerText()).trim() !== 'Get a free license at license.opensteward.dev') {
    fail('the permitted verdict has no "Get a free license at license.opensteward.dev" button')
  }
  await restart()
  await walk(['no', 'no', 'yes', 'no'])
  await expectVerdict('no, no, yes, no', 'not-permitted')
  if ((await verdict.locator('a[href="mailto:support@opensteward.dev"]').count()) !== 1) fail('the not-permitted verdict has no email link')
  await restart()
  await walk(['no', 'no', 'yes', 'yes', 'yes'])
  await expectVerdict('no, no, yes, yes, yes', 'ask')
  // Changing the first answer drops everything after it.
  await walk(['yes'])
  if ((await question(2).count()) !== 0) fail('re-answering question 1 left question 2 on the page')
  await expectVerdict('ask, then question 1 yes', 'permitted')

  // Without JavaScript: the numbered list, every question with both answers.
  const context = await contexts[label].newContext({ viewport, javaScriptEnabled: false })
  const plain = await context.newPage()
  await plain.goto(page.url())
  const questions = JSON.parse(await plain.locator('#decision-tree-data').textContent()).tree.questions.length
  const items = plain.locator('ol[data-decision-tree] > li')
  if ((await items.count()) !== questions || questions < 1) fail(`without JavaScript: ${await items.count()} questions listed, expected ${questions}`)
  for (let i = 0; i < (await items.count()); i++) {
    const text = await items.nth(i).innerText()
    if (!/\bYes\b/.test(text) || !/\bNo\b/.test(text)) fail(`without JavaScript: question ${i + 1} lacks Yes or No`)
  }
  await context.close()
}

// The docs' Platforms page: the product's catalogue. Brandfetch is never called: logos are
// stubbed, half as a 1x1 PNG and half as a 404, so the fallback to initials is exercised too.
const BRANDFETCH = 'https://cdn.brandfetch.io'
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const stubBrandfetch = (route) => {
  const domain = new URL(route.request().url()).pathname.split('/')[1] ?? ''
  return domain.length % 2 === 0
    ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
}

async function checkPlatforms(page, label, name, viewport, logoRequests) {
  const fail = (message) => note(label, name, message)
  const data = await page.evaluate(async () => (await fetch('/platforms/platforms.json')).json())
  const cards = page.locator('#grid .provider-card')
  try {
    await cards.first().waitFor({ timeout: 10_000 })
  } catch {
    fail('the catalogue drew no cards')
    return
  }
  if ((await cards.count()) !== data.total) fail(`${await cards.count()} cards, expected ${data.total}`)
  if ((await page.locator('details.platform-list li').count()) !== data.total) fail('the list under the grid does not hold every platform')
  if ((await page.locator('#verification').count()) !== 1) fail('no #verification section')
  // The page's heading is on screen when it opens (a stray design-system rule once pushed it a
  // viewport down).
  const top = await page.evaluate(() => (window.scrollTo(0, 0), document.querySelector('main h1').getBoundingClientRect().top))
  if (top > 200) fail(`the page heading starts ${Math.round(top)}px down`)
  if (await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth)) fail(`the page scrolls sideways at ${viewport.width}px`)

  // Logos when the build has a client ID; otherwise initials, and not one request to Brandfetch.
  if ((await page.locator('.provider-card__logo').count()) > 0) {
    if ((await page.locator('.provider-card__logo--fallback').count()) === 0) fail('no logo fell back to initials on a 404')
    const loaded = await page.evaluate(() => [...document.querySelectorAll('.provider-card__logo img')].filter((i) => i.naturalWidth > 0).length)
    if (loaded === 0) fail('no logo loaded')
  } else if (logoRequests.length > 0) {
    fail(`a build without logos requested ${logoRequests.length} from Brandfetch`)
  }
  if (viewport.width < 800) return

  // The grid runs the width of the content area, as the API reference pages do.
  const widths = await page.evaluate(() => [document.querySelector('.providers-section').clientWidth, document.querySelector('main').clientWidth])
  if (widths[0] < widths[1] * 0.85) fail(`the catalogue is ${widths[0]}px wide in a ${widths[1]}px content area`)

  // Docs search points a hit in the list at the list's own heading, not at #verification.
  const listHeading = await page.evaluate(() => {
    const list = document.querySelector('details.platform-list')
    const headings = [...document.querySelectorAll('main h2[id]')].filter((h) => h.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)
    return headings.at(-1)?.id
  })
  if (listHeading !== 'all-platforms') fail(`the list's nearest heading is #${listHeading}, not #all-platforms`)

  // A link to #verification lands on it, although the cards are drawn (and push it down) after
  // the browser has jumped there.
  const jump = await page.context().newPage()
  await jump.goto(`${DOCS}/platforms/#verification`, { waitUntil: 'networkidle' })
  await jump.locator('#grid .provider-card').first().waitFor({ timeout: 10_000 }).catch(() => {})
  await jump.waitForTimeout(500)
  const where = await jump.evaluate(() => document.getElementById('verification').getBoundingClientRect().top)
  if (where < 0 || where > 600) fail(`opening /platforms/#verification leaves its heading at ${Math.round(where)}px`)
  await jump.close()

  // Search, the vertical deep link, and the links on a card.
  await page.locator('#q').fill('stripe')
  const found = await cards.count()
  if (found === 0 || found >= data.total) fail(`searching "stripe" left ${found} cards`)
  const misses = await cards.evaluateAll((all) => all.filter((c) => !c.textContent.toLowerCase().includes('stripe')).length)
  if (misses > 0) fail(`${misses} cards shown for "stripe" do not mention it`)
  await page.locator('#q').fill('')
  await page.evaluate(() => (location.hash = 'vertical=crm'))
  await page.waitForFunction(() => document.querySelector('[data-vertical="crm"]')?.getAttribute('aria-pressed') === 'true', null, { polling: 100, timeout: 30_000 }).catch(() => fail('#vertical=crm did not select the CRM pill'))
  if ((await cards.count()) !== data.counts.crm) fail(`#vertical=crm shows ${await cards.count()} cards, expected ${data.counts.crm}`)
  const api = await page.locator('#grid a', { hasText: /^API$/ }).first().getAttribute('href')
  if (api !== '/unified-api/#tag/CRM') fail(`a CRM card's API link is ${api}`)
  await page.evaluate(() => (location.hash = ''))

  // The status filters (Verified, Unsupported, ...): each pill shows as many cards as its count
  // says, Unsupported matches the data, a status combines with a vertical, and a second click
  // clears it. Read from the page, so the product can rename a tier without breaking this.
  const shown = (n) =>
    page
      .waitForFunction((want) => document.querySelectorAll('#grid .provider-card').length === want, n, { polling: 100, timeout: 30_000 })
      .then(() => true, () => false)
  const pills = await page.locator('#status-filters [data-status]:not([data-status="all"])').evaluateAll((all) =>
    all.map((b) => ({ key: b.dataset.status, label: b.textContent.trim(), n: Number(b.textContent.match(/(\d[\d,]*)\s*$/)?.[1].replace(/,/g, '')) })),
  )
  const statusPill = (key) => page.locator(`#status-filters [data-status="${key}"]`)
  const unsupported = data.platforms.filter((p) => p.unsupported).length
  if (pills.length < 2 || !pills.some((p) => p.key === 'unsupported')) {
    fail(`status filters: expected Unsupported and at least one verification filter, found ${pills.map((p) => p.label).join(', ') || 'none'}`)
  } else {
    for (const pill of pills) {
      await statusPill(pill.key).click()
      if (!(await shown(pill.n))) fail(`"${pill.label}" shows ${await cards.count()} cards`)
      if (pill.key === 'unsupported' && pill.n !== unsupported) fail(`"${pill.label}" counts ${pill.n}, the data has ${unsupported}`)
    }
    if ((await statusPill('unsupported').getAttribute('aria-pressed')) !== 'true') await statusPill('unsupported').click()
    await page.locator('[data-vertical="crm"]').click()
    const both = data.platforms.filter((p) => p.unsupported && p.vertical === 'crm').length
    if (!(await shown(both))) fail(`CRM and Unsupported show ${await cards.count()} cards, expected ${both}`)
    await page.locator('[data-vertical="crm"]').click()
    await statusPill('unsupported').click()
    if (!(await shown(data.total))) fail('clicking a pressed status filter does not clear it')
  }

  const guide = await page.locator('#grid a', { hasText: /^Guide$/ }).first().getAttribute('href')
  const status = guide && (await page.evaluate(async (href) => (await fetch(href)).status, guide))
  if (status !== 200) fail(`a card's Guide link ${guide} answers ${status}`)
}

async function visit(browserType, viewport, spec) {
  const label = browserType.name()
  const context = await contexts[label].newContext({ viewport })
  const logoRequests = []
  if (spec.brandfetch) await context.route(`${BRANDFETCH}/**`, stubBrandfetch)
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__violations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`)
    })
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    // The 404 pages' own status shows up as a console error too.
    if (spec.status === 404 && msg.location().url === spec.url) return
    // A stubbed logo's 404, which the catalogue answers with initials.
    if (spec.brandfetch && msg.location().url.startsWith(BRANDFETCH)) return
    note(label, spec.name, `console error: ${msg.text()}`)
  })
  page.on('pageerror', (error) => note(label, spec.name, `page error: ${error.message}`))
  // Nothing may load from anywhere else (the policy would block it; this names it).
  page.on('request', (request) => {
    const { origin, protocol } = new URL(request.url())
    if (spec.brandfetch && origin === BRANDFETCH) return void logoRequests.push(request.url())
    if (protocol !== 'data:' && origin !== SITE && origin !== DOCS) note(label, spec.name, `request to another origin: ${request.url()}`)
  })
  page.on('requestfailed', (request) => note(label, spec.name, `request failed: ${request.url()} ${request.failure()?.errorText}`))
  page.on('response', (response) => {
    if (spec.brandfetch && response.url().startsWith(BRANDFETCH)) return
    if (response.status() >= 400 && response.url() !== spec.url) note(label, spec.name, `${response.status()} for ${response.url()}`)
  })

  const response = await page.goto(spec.url, { waitUntil: 'networkidle' })
  if ((response?.status() ?? 0) !== (spec.status ?? 200)) note(label, spec.name, `status ${response?.status()}`)
  // Lazy images: scroll through so they load under the policy too.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 20))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle')

  if (spec.name.startsWith('site-') && !spec.status && viewport.width > 800) {
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await checkButtons(page, label, spec.name)
    await page.evaluate((t) => (t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')), theme)
  }
  if (spec.name === 'site-home') {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await page.locator('[data-theme-toggle]:visible').first().click()
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    if (before === after) note(label, spec.name, 'theme toggle did not change the theme')
  }
  if (spec.name === 'site-commercial-licensing') {
    // The scenarios table scrolls in its own box; the page itself never scrolls sideways.
    if (await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth)) {
      note(label, spec.name, `the page scrolls sideways at ${viewport.width}px`)
    }
    if ((await page.locator('#getting-in-touch').count()) !== 1) note(label, spec.name, 'no #getting-in-touch heading')
    if (viewport.width > 800) await checkDecisionTree(page, label, spec.name, viewport)
  }
  if (spec.name === 'docs-platforms') await checkPlatforms(page, label, spec.name, viewport, logoRequests)
  if (spec.name === 'docs-home' && viewport.width > 800) {
    await page.locator('button[data-open-modal]').click()
    await page.locator('#starlight__search input').fill('connect link')
    try {
      await page.locator('.pagefind-ui__result').first().waitFor({ timeout: 10_000 })
    } catch {
      note(label, spec.name, 'search returned no results')
    }
    await page.keyboard.press('Escape')
  }

  if (spec.swagger) {
    // Swagger UI renders the spec, and the rail drives its filter.
    try {
      await page.locator('#swagger-ui .opblock').first().waitFor({ timeout: 20_000 })
      const tags = page.locator('[data-rail-tags] .api-ref__tag')
      if ((await tags.count()) < 3) note(label, spec.name, 'the rail lists no tag groups')
      await tags.nth(1).click()
      await page.locator('[data-rail-ops] .api-ref__op').first().waitFor({ timeout: 5_000 })
      const sections = await page.locator('#swagger-ui .opblock-tag-section').count()
      if (sections < 1 || sections > 2) note(label, spec.name, `picking a tag left ${sections} sections`)
    } catch (error) {
      note(label, spec.name, `Swagger UI did not render: ${error.message.split('\n')[0]}`)
    }
  }

  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((img) => img.complete && img.naturalWidth === 0 && getComputedStyle(img).display !== 'none')
      .map((img) => img.currentSrc || img.src),
  )
  for (const src of broken) note(label, spec.name, `image did not load or decode: ${src}`)

  for (const violation of await page.evaluate(() => window.__violations)) {
    note(label, spec.name, `CSP: ${violation}`)
  }
  // Screenshots last: Playwright injects a stylesheet for them, which the policy refuses.
  if (shots) {
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: join(shots, `${label}-${viewport.width}-${spec.name}.png`), fullPage: false })
  }
  await context.close()
}

const contexts = {}
try {
  for (const browserType of browserTypes) {
    contexts[browserType.name()] = await browserType.launch()
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      for (const spec of PAGES) await visit(browserType, viewport, spec)
    }
  }
} finally {
  await Promise.all(Object.values(contexts).map((b) => b.close()))
  server.kill()
}

for (const problem of problems) console.error(problem)
const names = browserTypes.map((b) => b.name()).join(' and ')
console.log(`browser check: ${PAGES.length} pages × ${names} × 2 sizes, ${problems.length} problems`)
process.exit(problems.length === 0 ? 0 : 1)
