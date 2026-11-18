import { describe, expect, it } from 'vitest'
import { isVerifiedLive, levelTag } from '../src/lib/verification.mjs'

// The product's Verification table: until 2026-11 two live tiers (sandbox, production); then one,
// "Verified". The site reads both, so a product sync in either direction keeps building.
describe('verification levels', () => {
  it('counts every tier that ran against a real API', () => {
    for (const level of ['Production verified', 'Sandbox verified', 'Verified']) expect(isVerifiedLive(level)).toBe(true)
    for (const level of ['Unit tested', '', 'verified', 'Scaffolded']) expect(isVerifiedLive(level)).toBe(false)
  })

  it('tags a tile with its environment only while the product names one', () => {
    expect(levelTag('Production verified')).toBe('production')
    expect(levelTag('Sandbox verified')).toBe('sandbox')
    expect(levelTag('Verified')).toBeNull()
  })
})
