#!/usr/bin/env node
// Fetches the product repository's docs and design system at the commit pinned in product.json,
// into .product/ (git-ignored). Both builds read from there: the docs site renders docs/, and
// both sites use packages/design-system/ for their look.
//
// A shallow, sparse fetch of exactly one commit: git checks every object against the commit ID,
// so the pin is also the integrity check. The pin must also be on the product's main branch:
// GitHub serves unmerged pull request commits by ID too. To build an unmerged product commit
// locally (to try a product change before it merges), set PRODUCT_ALLOW_UNMERGED=1. To move to
// newer docs, change `commit` in a pull request.
//
// Then it applies product-patches/*.patch in name order: fixes to the product's docs that this
// site needs before the product carries them (the product repo is not changed from here). A
// patch the product already carries is reported (and, with --drop-upstream-patches, deleted:
// the sync workflow does that); a patch that neither applies nor is already there stops the
// fetch. See scripts/lib/patches.mjs.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatches } from './lib/patches.mjs'
import { isOnMain } from './lib/pin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(join(root, 'product.json'), 'utf8'))
const target = join(root, '.product')
const marker = join(target, '.pinned-commit')
const patchDir = join(root, 'product-patches')
const patches = existsSync(patchDir)
  ? readdirSync(patchDir)
      .filter((name) => name.endsWith('.patch'))
      .sort()
      .map((name) => ({ name, file: join(patchDir, name) }))
  : []
const dropUpstream = process.argv.includes('--drop-upstream-patches')
const allowUnmerged = process.env.PRODUCT_ALLOW_UNMERGED === '1'

/**
 * What .product/ holds: the commit, the paths checked out, and the patches it was given. A copy
 * fetched under PRODUCT_ALLOW_UNMERGED=1 is only reused while that is still set.
 */
function stateFor(list) {
  const hash = createHash('sha256').update(`${pin.paths.join('\0')}\0\0`)
  for (const { name, file } of list) hash.update(`${name}\0`).update(readFileSync(file)).update('\0')
  return `${pin.commit} ${hash.digest('hex').slice(0, 16)}${allowUnmerged ? ' unmerged-allowed' : ''}`
}
const state = stateFor(patches)

if (!/^[0-9a-f]{40}$/.test(pin.commit)) {
  throw new Error('product.json: commit must be a full 40-character commit ID')
}
if (!pin.repository.startsWith('https://github.com/')) {
  throw new Error('product.json: repository must be an https://github.com/ URL')
}

// --drop-upstream-patches always fetches: it needs the check that only a fresh copy gives.
if (!dropUpstream && existsSync(marker) && readFileSync(marker, 'utf8').trim() === state) {
  console.log(`.product/ already holds ${pin.commit.slice(0, 12)} with ${patches.length} patch(es)`)
  process.exit(0)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: target, stdio: ['ignore', 'pipe', 'inherit'] })
// For the patch checks, whose failures are expected and handled.
const quietGit = (...args) => execFileSync('git', args, { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] })

git('init', '--quiet')
git('remote', 'add', 'origin', pin.repository)
git('sparse-checkout', 'set', '--no-cone', ...pin.paths.map((p) => `/${p}`))
git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', pin.commit)
git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD')

const head = git('rev-parse', 'HEAD').toString().trim()
if (head !== pin.commit) throw new Error(`fetched ${head}, expected ${pin.commit}`)
for (const path of pin.paths) {
  if (!existsSync(join(target, path))) throw new Error(`the pinned commit has no ${path}`)
}
const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : ''
if (!isOnMain(git, pin.commit)) {
  if (!allowUnmerged) {
    rmSync(target, { recursive: true, force: true })
    throw new Error(
      `product.json: ${pin.commit} is not on main in ${pin.repository}. Pin a merged commit, or set PRODUCT_ALLOW_UNMERGED=1 to build it locally.`,
    )
  }
  console.warn(`${annotate}${pin.commit.slice(0, 12)} is not on the product's main (PRODUCT_ALLOW_UNMERGED=1)`)
}
const { applied, upstream } = applyPatches(quietGit, patches)
for (const name of upstream) {
  if (dropUpstream) {
    rmSync(join(patchDir, name))
    console.log(`deleted product-patches/${name}: ${pin.commit.slice(0, 12)} already carries it`)
  } else {
    console.warn(`${annotate}product-patches/${name} is already in the product at ${pin.commit.slice(0, 12)}: delete it`)
  }
}
writeFileSync(marker, `${dropUpstream ? stateFor(patches.filter((p) => !upstream.includes(p.name))) : state}\n`)
console.log(
  `fetched ${pin.repository} at ${pin.commit.slice(0, 12)} into .product/, ${applied.length} patch(es) applied`,
)
