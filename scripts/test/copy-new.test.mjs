import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyNewFiles } from '../lib/copy-new.mjs'

// assemble.mjs adds the docs' Markdown copies to the built docs in out/docs/, which already exists.
let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copy-new-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const read = (path) => readFileSync(join(dir, path), 'utf8')

describe('copyNewFiles', () => {
  it('adds files into directories that already exist, keeping what is there', () => {
    write(join(dir, 'from/llms.txt'), 'index')
    write(join(dir, 'from/admin/status.md'), 'markdown')
    write(join(dir, 'to/admin/status/index.html'), 'html')
    copyNewFiles(join(dir, 'from'), join(dir, 'to'))
    expect(read('to/llms.txt')).toBe('index')
    expect(read('to/admin/status.md')).toBe('markdown')
    expect(read('to/admin/status/index.html')).toBe('html')
  })

  it('stops rather than overwrite a file the build made', () => {
    write(join(dir, 'from/admin/index.md'), 'markdown')
    write(join(dir, 'to/admin/index.md'), 'built')
    expect(() => copyNewFiles(join(dir, 'from'), join(dir, 'to'))).toThrow(/admin\/index\.md already exists/)
    expect(read('to/admin/index.md')).toBe('built')
  })
})
