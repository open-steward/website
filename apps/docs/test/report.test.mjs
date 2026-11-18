import { describe, expect, it } from 'vitest'
import { syncReport } from '../scripts/report.mjs'

const base = { commit: 'a'.repeat(40), pages: 159, diagrams: 34, files: 60, unresolved: [], failed: [] }

describe('syncReport', () => {
  it('says what was built, and that nothing needs a look', () => {
    const text = syncReport(base)
    expect(text).toContain('### Docs from opensteward@aaaaaaa')
    expect(text).toContain('159 pages, 34 diagrams, 60 files copied.')
    expect(text).toContain('Every diagram rendered and every link resolved.')
  })

  it('lists the diagrams shown as source and the links left as written', () => {
    const text = syncReport({ ...base, failed: ['admin/x.md#0: Parse error'], unresolved: ['docs/a.md: /nowhere'] })
    expect(text).toContain('**Diagrams shown as source**')
    expect(text).toContain('- `admin/x.md#0: Parse error`')
    expect(text).toContain('**Links left as written**')
    expect(text).toContain('- `docs/a.md: /nowhere`')
    expect(text).not.toContain('Every diagram rendered')
  })
})
