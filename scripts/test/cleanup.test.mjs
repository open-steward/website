import { describe, expect, it } from 'vitest'
import { KEEP_STALE_DAYS, MARKERS, planCleanup } from '../lib/cleanup.mjs'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 15)

const plan = (bucket, build) => planCleanup(new Map(Object.entries(bucket)), new Set(build), NOW)

describe('planCleanup', () => {
  it('keeps everything the build has', () => {
    const result = plan({ 'site/index.html': NOW, '_astro/a.css': NOW }, ['site/index.html', '_astro/a.css'])
    expect(result).toEqual({ toDelete: [], toMark: [] })
  })

  it('deletes dropped pages and other files at once', () => {
    const result = plan({ 'site/old/index.html': NOW, 'site/brand/old.svg': NOW }, [])
    expect(result.toDelete.sort()).toEqual(['site/brand/old.svg', 'site/old/index.html'])
    expect(result.toMark).toEqual([])
  })

  it('marks a dropped hashed file instead of deleting it, however old the file is', () => {
    // Uploaded long ago, dropped only now: cached pages may still ask for it.
    const result = plan({ '_astro/old.js': NOW - 60 * DAY, 'docs/pagefind/fragment/x.pf_fragment': NOW - 60 * DAY }, [])
    expect(result.toDelete).toEqual([])
    expect(result.toMark.sort()).toEqual(['_astro/old.js', 'docs/pagefind/fragment/x.pf_fragment'])
  })

  it('keeps a marked file until the marker is older than the grace period', () => {
    const fresh = plan({ '_astro/old.js': NOW - 60 * DAY, [`${MARKERS}_astro/old.js`]: NOW - (KEEP_STALE_DAYS - 1) * DAY }, [])
    expect(fresh).toEqual({ toDelete: [], toMark: [] })
    const expired = plan({ '_astro/old.js': NOW - 60 * DAY, [`${MARKERS}_astro/old.js`]: NOW - (KEEP_STALE_DAYS + 1) * DAY }, [])
    expect(expired.toDelete.sort()).toEqual(['_astro/old.js', `${MARKERS}_astro/old.js`])
  })

  it('drops the marker of a file that is back in the build, or already gone', () => {
    const back = plan({ '_astro/a.js': NOW, [`${MARKERS}_astro/a.js`]: NOW - DAY }, ['_astro/a.js'])
    expect(back).toEqual({ toDelete: [`${MARKERS}_astro/a.js`], toMark: [] })
    const gone = plan({ [`${MARKERS}_astro/b.js`]: NOW - DAY }, [])
    expect(gone).toEqual({ toDelete: [`${MARKERS}_astro/b.js`], toMark: [] })
  })

  it('ships and keeps .well-known/security.txt like any other file', () => {
    const result = plan({ 'site/.well-known/security.txt': NOW }, ['site/.well-known/security.txt'])
    expect(result).toEqual({ toDelete: [], toMark: [] })
  })
})
