#!/usr/bin/env node
// Copies the design system's logo files from .product/ into an app's public/ folder (both
// git-ignored outputs): favicon.ico at the root, the rest under brand/.
//
//   node scripts/copy-brand.mjs apps/site/public

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logo = join(root, '.product/packages/design-system/logo')
const target = process.argv[2]
if (!target) throw new Error('usage: copy-brand.mjs <public dir>')
const publicDir = resolve(target)
const brand = join(publicDir, 'brand')

mkdirSync(brand, { recursive: true })
copyFileSync(join(logo, 'favicon.ico'), join(publicDir, 'favicon.ico'))
for (const name of ['mark.svg', 'mark-dark.svg', 'wordmark-light.svg', 'wordmark-dark.svg']) {
  copyFileSync(join(logo, name), join(brand, name))
}
for (const name of readdirSync(join(logo, 'icons'))) {
  if (name.endsWith('.png')) copyFileSync(join(logo, 'icons', name), join(brand, name))
}
console.log(`copied the logo files into ${target}`)
