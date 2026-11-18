import { describe, expect, it } from 'vitest'
import { checksState, decide, mergeProblem, needsReview, prBody, siteChanged } from '../lib/product-sync.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const MAIN = 'd'.repeat(40)
const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 15, 12)

const HEAD = 'f'.repeat(40)
const pr = (over = {}) => ({ number: 7, headSha: HEAD, productCommit: B, baseSha: MAIN, createdAt: NOW - HOUR, checks: 'pending', notes: [], ...over })
const run = (over = {}) => decide({ pinned: A, latest: B, mainSha: MAIN, pr: null, now: NOW, ...over })

describe('decide', () => {
  it('does nothing when the pin is the product main', () => {
    expect(run({ latest: A })).toEqual({ kind: 'none' })
  })

  it('closes a sync PR the pin has caught up with (moved by hand)', () => {
    expect(run({ latest: A, pr: pr() })).toEqual({ kind: 'close' })
  })

  it('opens a PR when the product main moved', () => {
    expect(run()).toEqual({ kind: 'update' })
  })

  it('leaves a product commit alone whose sync PR was closed without merging', () => {
    expect(run({ skipped: B })).toEqual({ kind: 'none' })
    expect(run({ skipped: A, latest: C })).toEqual({ kind: 'update' })
  })

  it('opens no PR for product commits that change nothing the site reads', () => {
    expect(run({ changesSite: false })).toEqual({ kind: 'none' })
  })

  it('updates the PR when the product main moved again', () => {
    expect(run({ latest: C, pr: pr() })).toEqual({ kind: 'update' })
  })

  it("rebuilds the PR on the website's main when main moved under it (a fix landed)", () => {
    expect(run({ pr: pr({ baseSha: 'e'.repeat(40), checks: 'failure' }) })).toEqual({ kind: 'update' })
  })

  it('waits while the checks run', () => {
    expect(run({ pr: pr() })).toEqual({ kind: 'none' })
  })

  it('starts the checks when none has run on the branch', () => {
    expect(run({ pr: pr({ checks: 'missing' }) })).toEqual({ kind: 'check' })
  })

  it('merges once the checks pass', () => {
    expect(run({ pr: pr({ checks: 'success' }) })).toEqual({ kind: 'merge' })
  })

  it('leaves a sync that changes product code for a person to merge, and says so once', () => {
    const first = run({ reviewFirst: true, pr: pr({ checks: 'success' }) })
    expect(first.kind).toBe('notify')
    expect(first.marker).toBe(`review:${HEAD}`)
    expect(first.message).toMatch(/merge this PR yourself/)
    expect(run({ reviewFirst: true, pr: pr({ checks: 'success', notes: [`review:${HEAD}`] }) })).toEqual({ kind: 'none' })
    // Failing checks are reported as failures, review or not.
    expect(run({ reviewFirst: true, pr: pr({ checks: 'failure' }) }).marker).toBe(`failed:${HEAD}`)
  })

  it('tells the assignee once when the checks fail on a commit of the branch', () => {
    const first = run({ pr: pr({ checks: 'failure' }) })
    expect(first.kind).toBe('notify')
    expect(first.marker).toBe(`failed:${HEAD}`)
    expect(first.message).toMatch(/will not merge by itself/)
    expect(run({ pr: pr({ checks: 'failure', notes: [`failed:${HEAD}`] }) })).toEqual({ kind: 'none' })
    // The branch rebuilt on a fix that did not work: a new commit, so a new report.
    expect(run({ pr: pr({ checks: 'failure', headSha: 'e'.repeat(40), notes: [`failed:${HEAD}`] }) }).kind).toBe('notify')
  })

  it('tells the assignee once when a PR has been open for more than a day', () => {
    const stale = run({ pr: pr({ createdAt: NOW - 25 * HOUR }) })
    expect(stale.kind).toBe('notify')
    expect(stale.marker).toBe('stale')
    expect(run({ pr: pr({ createdAt: NOW - 25 * HOUR, notes: ['stale'] }) })).toEqual({ kind: 'none' })
  })
})

describe('needsReview', () => {
  const paths = ['README.md', 'COMMERCIAL-LICENSE.md', 'tsconfig.base.json', 'docs/', 'packages/design-system/', 'packages/platforms-ui/']
  const files = (...list) => ({ files: list.map((f) => (typeof f === 'string' ? { filename: f, status: 'modified' } : f)) })

  it('lets text the site renders merge by itself', () => {
    expect(needsReview(files('docs/admin/status.md', 'docs/platforms/platforms.json', 'README.md', 'COMMERCIAL-LICENSE.md'), paths)).toBe(false)
    expect(needsReview(files('apps/admin/src/x.ts'), paths)).toBe(false) // nothing the site reads
  })

  it('holds a change to code the build runs or styles it uses for review', () => {
    expect(needsReview(files('docs/x.md', 'packages/platforms-ui/src/index.ts'), paths)).toBe(true)
    expect(needsReview(files('packages/design-system/tokens.css'), paths)).toBe(true)
    expect(needsReview(files('tsconfig.base.json'), paths)).toBe(true)
    expect(needsReview(files({ filename: 'docs/moved.md', previous: 'packages/platforms-ui/x.md', status: 'renamed' }), paths)).toBe(true)
  })

  it('holds it for review when the changes cannot be listed', () => {
    expect(needsReview(null, paths)).toBe(true)
    expect(needsReview(files(...Array.from({ length: 300 }, (_, i) => `docs/p${i}.md`)), paths)).toBe(true)
  })
})

describe('prBody', () => {
  const productRepo = 'https://github.com/open-steward/opensteward'
  const paths = ['README.md', 'docs/', 'packages/design-system/']
  const commit = (n) => ({ sha: n.toString(16).padStart(40, '0'), message: `Change ${n}\n\nLonger text` })

  it('says whether it merges by itself or waits for a review', () => {
    const auto = prBody({ productRepo, paths, pinned: A, latest: B, compare: null, deletedPatches: [] })
    expect(auto).toContain('It merges by itself')
    const held = prBody({ productRepo, paths, pinned: A, latest: B, compare: null, deletedPatches: [], reviewFirst: true })
    expect(held).not.toContain('It merges by itself')
    expect(held).toContain('does not merge by itself')
  })

  it('links both commits and the comparison', () => {
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: null, deletedPatches: [] })
    expect(body).toContain(`[opensteward@aaaaaaa](${productRepo}/commit/${A})`)
    expect(body).toContain(`[opensteward@bbbbbbb](${productRepo}/commit/${B})`)
    expect(body).toContain(`${productRepo}/compare/${A}...${B}`)
    expect(body).toMatch(/could not read the product's commits/)
  })

  it('lists the commits by subject, at most 50', () => {
    const commits = Array.from({ length: 53 }, (_, i) => commit(i + 1))
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: { totalCommits: 53, commits, files: [] }, deletedPatches: [] })
    expect(body).toContain('### Product commits (53)')
    expect(body).toContain(`- [${commit(53).sha.slice(0, 7)}](${productRepo}/commit/${commit(53).sha}) \`Change 53\``)
    expect(body).not.toContain('Longer text')
    expect(body).not.toContain('`Change 3`')
    expect(body).toContain('- and 3 more')
  })

  it("drops the subjects' CI skip words, which would stop the deploy if they reached the merge commit", () => {
    const commits = [
      { sha: A, message: 'Bump x (#645) [skip ci]' },
      { sha: B, message: '[ci skip] Bump y [no ci] [skip actions] [actions skip] [SKIP CI]' },
    ]
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: { totalCommits: 2, commits, files: [] }, deletedPatches: [] })
    expect(body).toContain(') `Bump x (#645)`\n')
    expect(body).toContain(') `Bump y`\n')
    expect(body).not.toMatch(/skip|no ci/i)
  })

  it("shows subjects as code, so a product commit's @name or #number mentions no one here", () => {
    const commits = [
      { sha: A, message: 'Bump @types/node from 24.1 to 24.2 (#650), thanks @someone' },
      { sha: B, message: 'Quote `pnpm build` in the guide' },
    ]
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: { totalCommits: 2, commits, files: [] }, deletedPatches: [] })
    expect(body).toContain(') `Bump @types/node from 24.1 to 24.2 (#650), thanks @someone`\n')
    expect(body).toContain(') ``Quote `pnpm build` in the guide``\n')
  })

  it('lists only the files the site reads', () => {
    const files = [
      { filename: 'docs/admin/status.md', status: 'modified' },
      { filename: 'README.md', status: 'modified' },
      { filename: 'apps/api/src/server.ts', status: 'modified' },
      { filename: 'docs/new.md', status: 'added' },
    ]
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: { totalCommits: 1, commits: [commit(1)], files }, deletedPatches: [] })
    expect(body).toContain('- `docs/admin/status.md` (modified)\n- `README.md` (modified)\n- `docs/new.md` (added)')
    expect(body).not.toContain('server.ts')
  })

  it('names the patches it deleted', () => {
    const body = prBody({ productRepo, paths, pinned: A, latest: B, compare: null, deletedPatches: ['product-patches/0001-x.patch'] })
    expect(body).toContain('- `product-patches/0001-x.patch`')
  })
})

describe('checksState', () => {
  it('is missing before any run, and pending until it has finished', () => {
    expect(checksState([])).toBe('missing')
    expect(checksState([{ status: 'queued', conclusion: null }])).toBe('pending')
    expect(checksState([{ status: 'in_progress', conclusion: null }])).toBe('pending')
  })

  it('is success or failure by the finished run', () => {
    expect(checksState([{ status: 'completed', conclusion: 'success' }])).toBe('success')
    expect(checksState([{ status: 'completed', conclusion: 'failure' }])).toBe('failure')
    expect(checksState([{ status: 'completed', conclusion: 'timed_out' }])).toBe('failure')
  })
})

describe('siteChanged', () => {
  const paths = ['README.md', 'docs/', 'packages/design-system/']
  const compare = (files) => ({ totalCommits: 1, commits: [], files })

  it('is false when only other files changed', () => {
    expect(siteChanged(compare([{ filename: 'apps/api/src/server.ts', status: 'modified' }]), paths)).toBe(false)
  })

  it('is true when a file the site reads changed, was added, or was moved away', () => {
    expect(siteChanged(compare([{ filename: 'docs/a.md', status: 'modified' }]), paths)).toBe(true)
    expect(siteChanged(compare([{ filename: 'README.md', status: 'added' }]), paths)).toBe(true)
    expect(siteChanged(compare([{ filename: 'old/a.md', previous: 'docs/a.md', status: 'renamed' }]), paths)).toBe(true)
  })

  it('assumes a change when it cannot tell: no comparison, or a truncated file list', () => {
    expect(siteChanged(null, paths)).toBe(true)
    const many = Array.from({ length: 300 }, (_, i) => ({ filename: `apps/x${i}.ts`, status: 'modified' }))
    expect(siteChanged(compare(many), paths)).toBe(true)
  })
})

describe('mergeProblem', () => {
  const mainPin = { repository: 'https://github.com/open-steward/opensteward.git', commit: A, paths: ['docs/'] }
  const ok = {
    compare: { aheadBy: 1, behindBy: 0, files: [{ filename: 'product.json', status: 'modified' }, { filename: 'product-patches/0001-x.patch', status: 'removed' }] },
    mainPin,
    headPin: { ...mainPin, commit: B },
    latest: B,
  }

  it('finds none in a branch that only moves the pin and deletes patches', () => {
    expect(mergeProblem(ok)).toBeNull()
  })

  it('refuses a branch that is not one commit on main', () => {
    expect(mergeProblem({ ...ok, compare: { ...ok.compare, aheadBy: 2 } })).toMatch(/one commit on main/)
    expect(mergeProblem({ ...ok, compare: { ...ok.compare, behindBy: 1 } })).toMatch(/one commit on main/)
  })

  it('refuses any other file, added patches included', () => {
    const files = (f) => ({ ...ok, compare: { ...ok.compare, files: [...ok.compare.files, f] } })
    expect(mergeProblem(files({ filename: 'scripts/deploy.mjs', status: 'modified' }))).toMatch(/scripts\/deploy\.mjs/)
    expect(mergeProblem(files({ filename: 'product-patches/0002-y.patch', status: 'added' }))).toMatch(/0002-y\.patch/)
  })

  it('refuses a pin that changes more than the commit, or not to the product main', () => {
    expect(mergeProblem({ ...ok, headPin: { ...ok.headPin, repository: 'https://github.com/someone/fork.git' } })).toMatch(/only the commit/)
    expect(mergeProblem({ ...ok, headPin: { ...ok.headPin, commit: C } })).toMatch(/product's main/)
  })
})
