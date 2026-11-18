import { describe, expect, it } from 'vitest'
import { builtInDashboardCount } from '../src/lib/dashboards.mjs'

// docs/admin/dashboards.md, as the product words it.
const PAGE = `## What you can do

- **Open a built-in dashboard.** OpenSteward ships 22, grouped by vertical:
  - **System health**;
`

describe('builtInDashboardCount', () => {
  it('reads how many built-in dashboards the product ships', () => {
    expect(builtInDashboardCount(PAGE)).toBe(22)
    expect(builtInDashboardCount(PAGE.replace('ships 22', 'ships 25'))).toBe(25)
  })

  it('stops the build when the sentence changes, rather than show a stale number', () => {
    expect(() => builtInDashboardCount(PAGE.replace('OpenSteward ships 22', 'There are 22'))).toThrow(/dashboards\.md/)
  })
})
