import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPatches } from '../lib/patches.mjs'

// A real git checkout and real patches: applyPatches is a thin layer over `git apply`.
let dir
let patchDir
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })

/** A patch that turns `before` into `after` in doc.md. */
function makePatch(name, before, after) {
  writeFileSync(join(dir, 'doc.md'), before)
  git('add', 'doc.md')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'base')
  writeFileSync(join(dir, 'doc.md'), after)
  const file = join(patchDir, name)
  writeFileSync(file, git('diff'))
  git('checkout', '--quiet', 'doc.md')
  return { name, file }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'patches-repo-'))
  patchDir = mkdtempSync(join(tmpdir(), 'patches-'))
  git('init', '--quiet')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(patchDir, { recursive: true, force: true })
})

describe('applyPatches', () => {
  it('applies a patch the product still needs', () => {
    const patch = makePatch('0001-fix.patch', 'one\ntwo\n', 'one\nTWO\n')
    expect(applyPatches(git, [patch])).toEqual({ applied: ['0001-fix.patch'], upstream: [] })
    expect(readFileSync(join(dir, 'doc.md'), 'utf8')).toBe('one\nTWO\n')
  })

  it('reports a patch the product already carries, and leaves the file alone', () => {
    const patch = makePatch('0001-fix.patch', 'one\ntwo\n', 'one\nTWO\n')
    writeFileSync(join(dir, 'doc.md'), 'one\nTWO\n')
    expect(applyPatches(git, [patch])).toEqual({ applied: [], upstream: ['0001-fix.patch'] })
    expect(readFileSync(join(dir, 'doc.md'), 'utf8')).toBe('one\nTWO\n')
  })

  it('stops on a patch whose lines the product changed some other way', () => {
    const patch = makePatch('0001-fix.patch', 'one\ntwo\n', 'one\nTWO\n')
    writeFileSync(join(dir, 'doc.md'), 'one\nzwei\n')
    expect(() => applyPatches(git, [patch])).toThrow(/0001-fix\.patch no longer applies.*redo it/s)
  })
})
