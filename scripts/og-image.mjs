#!/usr/bin/env node
// Renders the social preview image (apps/site/public/og.png, 1200×630) from the design system's
// fonts and colours. Run it again after changing the tagline; the PNG is committed.
//
//   node scripts/og-image.mjs

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const root = join(import.meta.dirname, '..')
const dataUrl = (file) =>
  `data:font/ttf;base64,${readFileSync(join(root, '.product/packages/design-system/fonts', file)).toString('base64')}`
const font = dataUrl('InterTight-Variable.ttf')
const mono = dataUrl('JetBrainsMono-Variable.ttf')

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Inter Tight'; src: url('${font}'); font-weight: 100 900; }
@font-face { font-family: 'JetBrains Mono'; src: url('${mono}'); font-weight: 100 800; }
html, body { margin: 0; width: 1200px; height: 630px; }
body { background: #FAF9F6; font-family: 'Inter Tight', sans-serif; color: #17180F; display: flex;
  flex-direction: column; justify-content: space-between; padding: 72px 80px; box-sizing: border-box;
  background-image: radial-gradient(circle at 100% 0%, #DDE7D3 0, transparent 45%); }
.brand { display: flex; align-items: center; gap: 18px; font-size: 40px; letter-spacing: -0.02em; }
.brand svg { width: 64px; height: 64px; color: #4E7340; }
.brand b { font-weight: 700; } .brand span { font-weight: 500; }
h1 { font-size: 92px; line-height: 1.02; letter-spacing: -0.035em; margin: 0; font-weight: 700; max-width: 16ch; }
.foot { display: flex; justify-content: space-between; align-items: flex-end; font-size: 26px; color: #46483A; }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 22px; color: #3D5A33; background: #F1F5EE;
  border: 1px solid #B9CDA6; border-radius: 10px; padding: 10px 16px; }
</style></head><body>
<div class="brand"><svg viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="32" r="8.5"/><line x1="26.5" y1="32" x2="52" y2="32"/><line x1="44" y1="32" x2="44" y2="40"/><line x1="50" y1="32" x2="50" y2="38"/></g></svg><div><span>Open</span><b>Steward</b></div></div>
<h1>Your customers' data. On your servers.</h1>
<div class="foot"><div>One self-hosted REST API across 9 verticals.<br>Source available. License verified offline.</div><div class="mono">opensteward.dev</div></div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(root, 'apps/site/public/og.png') })
await browser.close()
console.log('wrote apps/site/public/og.png')
