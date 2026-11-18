import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isOnMain } from '../lib/pin.mjs'

// Real repositories: a product with a main and an unmerged branch, and a shallow one-commit
// fetch of the pin, the way fetch-product.mjs makes .product/.
let product
let checkout
const run = (cwd) => (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const commit = (message) => {
  run(product)('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', message)
  return run(product)('rev-parse', 'HEAD')
}

/** A fresh shallow checkout of `sha`, as fetch-product.mjs fetches it. */
function fetchPin(sha) {
  checkout = mkdtempSync(join(tmpdir(), 'pin-checkout-'))
  const git = run(checkout)
  git('init', '--quiet')
  git('remote', 'add', 'origin', `file://${product}`)
  git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', sha)
  return git
}

let first
let tip
let unmerged
beforeEach(() => {
  product = mkdtempSync(join(tmpdir(), 'pin-product-'))
  run(product)('init', '--quiet', '--initial-branch=main')
  run(product)('config', 'uploadpack.allowFilter', 'true')
  run(product)('config', 'uploadpack.allowAnySHA1InWant', 'true')
  first = commit('first')
  tip = commit('second')
  run(product)('checkout', '--quiet', '-b', 'contributor')
  unmerged = commit('not merged')
  run(product)('checkout', '--quiet', 'main')
})
afterEach(() => {
  rmSync(product, { recursive: true, force: true })
  if (checkout) rmSync(checkout, { recursive: true, force: true })
  checkout = undefined
})

describe('isOnMain', () => {
  it("accepts main's tip", () => {
    expect(isOnMain(fetchPin(tip), tip)).toBe(true)
  })

  it('accepts an older commit on main', () => {
    expect(isOnMain(fetchPin(first), first)).toBe(true)
  })

  it('rejects a commit that only an unmerged branch holds', () => {
    expect(isOnMain(fetchPin(unmerged), unmerged)).toBe(false)
  })
})
