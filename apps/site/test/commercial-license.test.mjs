import { describe, expect, it } from 'vitest'
import { parseDecisionTree, renderCommercialLicense, rewriteHref } from '../src/lib/commercial-license.mjs'

// The section exactly as the product's COMMERCIAL-LICENSE.md has it.
const SECTION = `### Questions that settle the rest

Answer in order and stop at the first verdict.

1. **Is the deployment used only by your own organization and its affiliates,
   for internal purposes?**
   Yes → **Permitted.** No → go to 2.

2. **Do you host, deploy, or support a dedicated instance for one customer,
   used for that customer's own purposes?**
   Yes → **Permitted.** No → go to 3.

3. **Do third parties use OpenSteward's functionality directly — its APIs, MCP
   tools, or connectors — beyond connecting their own accounts through Connect
   Link?**
   No, they see only results inside your product, such as a credit decision, a
   dashboard, or synced records → **Permitted.** Yes → go to 4.

4. **Is that access one feature of a broader product, limited to your
   product's own domain?**
   No, it offers general integration access across platforms or verticals →
   **Not permitted.** Yes → go to 5.

5. **Do you sell or market integration access on its own: as a standalone
   product, a separately priced add-on, or data sold to anyone other than the
   business it belongs to?**
   Yes → **ask us before you deploy** (see [Getting in touch](#getting-in-touch)).
   It turns on whether integration access becomes the primary value you
   offer. No → go to 6.

6. **The removal test: if your product had no integrations at all, would your
   customers still be buying it?**
   Yes → **Permitted.** No → integration access is what they buy → **Not
   permitted.**

If your case still isn't clear, ask. A written answer is free and usually takes
a day.
`

const edit = (from, to) => {
  expect(SECTION).toContain(from)
  return SECTION.replace(from, to)
}

describe('parseDecisionTree', () => {
  it('parses the six questions in order', () => {
    const { questions } = parseDecisionTree(SECTION)
    expect(questions.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(questions[0].text).toBe(
      'Is the deployment used only by your own organization and its affiliates, for internal purposes?',
    )
  })

  it("reads each answer's outcome", () => {
    const { questions } = parseDecisionTree(SECTION)
    expect(questions[0]).toMatchObject({ yes: { verdict: 'permitted' }, no: { next: 2 } })
    expect(questions[1]).toMatchObject({ yes: { verdict: 'permitted' }, no: { next: 3 } })
    expect(questions[2]).toMatchObject({
      no: {
        verdict: 'permitted',
        explanation: 'they see only results inside your product, such as a credit decision, a dashboard, or synced records',
      },
      yes: { next: 4 },
    })
    expect(questions[3]).toMatchObject({
      no: { verdict: 'not-permitted', explanation: 'it offers general integration access across platforms or verticals' },
      yes: { next: 5 },
    })
    expect(questions[4]).toMatchObject({
      yes: { verdict: 'ask', note: 'It turns on whether integration access becomes the primary value you offer.' },
      no: { next: 6 },
    })
    expect(questions[5]).toMatchObject({
      yes: { verdict: 'permitted' },
      no: { verdict: 'not-permitted', explanation: 'integration access is what they buy' },
    })
  })

  it('sets exactly one of next and verdict on every answer', () => {
    for (const q of parseDecisionTree(SECTION).questions) {
      for (const answer of [q.yes, q.no]) {
        expect(('next' in answer) !== ('verdict' in answer)).toBe(true)
      }
    }
  })

  it('stops on a question with no No answer', () => {
    expect(() => parseDecisionTree(edit(' No → go to 2.', ''))).toThrow(/^COMMERCIAL-LICENSE\.md: .*question 1/)
  })

  it('stops on an outcome it does not know', () => {
    const markdown = edit('Yes → **Permitted.** No → go to 3.', 'Yes → **Maybe.** No → go to 3.')
    expect(() => parseDecisionTree(markdown)).toThrow(/question 2.*Maybe/)
  })

  it('stops on a go-to that points backwards or nowhere', () => {
    expect(() => parseDecisionTree(edit('Yes → go to 4.', 'Yes → go to 2.'))).toThrow(/question 3/)
    expect(() => parseDecisionTree(edit('Yes → go to 4.', 'Yes → go to 9.'))).toThrow(/question 3/)
  })

  it('stops on words after a verdict or a go-to that the tree would drop', () => {
    const caveat = edit('Yes → **Permitted.** No → go to 2.', 'Yes → **Permitted**, as long as the license checks stay in. No → go to 2.')
    expect(() => parseDecisionTree(caveat)).toThrow(/question 1.*as long as the license checks stay in/)
    const goTo = edit('No → go to 3.', 'No → go to 3, unless you host it.')
    expect(() => parseDecisionTree(goTo)).toThrow(/question 2.*unless you host it/)
  })

  it('stops on a second outcome inside an answer instead of taking the last one', () => {
    const carveOut = edit(
      'No, it offers general integration access across platforms or verticals →\n   **Not permitted.** Yes → go to 5.',
      'No → **Not permitted.** If that access is read-only reporting → **Permitted.** Yes → go to 5.',
    )
    expect(() => parseDecisionTree(carveOut)).toThrow(/question 4.*Not permitted/)
    const thirdOption = edit('Yes → **Permitted.** No → go to 2.', 'Yes → **Permitted.** No → go to 2. Unsure → **ask us**.')
    expect(() => parseDecisionTree(thirdOption)).toThrow(/question 1.*go to 2/)
  })

  it('keeps every word after "ask us" in the note', () => {
    const markdown = edit('**ask us before you deploy** (see', '**ask us before you deploy**, with your architecture (see')
    expect(parseDecisionTree(markdown).questions[4].yes.note).toContain('with your architecture')
  })

  it('stops on an unreachable question', () => {
    expect(() => parseDecisionTree(edit('No → go to 2.', 'No → go to 3.'))).toThrow(/question 2.*reach/)
  })

  it('stops when the section or its list is missing', () => {
    expect(() => parseDecisionTree('# Commercial licensing\n\nNothing here.\n')).toThrow(/^COMMERCIAL-LICENSE\.md: /)
    expect(() => parseDecisionTree('### Questions that settle the rest\n\nAsk us.\n')).toThrow(/^COMMERCIAL-LICENSE\.md: /)
  })

  it('follows a seventh question the product adds', () => {
    const markdown =
      edit('No → integration access is what they buy → **Not\n   permitted.**', 'No → go to 7.') +
      '\n7. **Is it a test?** Yes → **Permitted.** No → **Not permitted.**\n'
    // The appended item continues the list only if it follows it directly.
    const joined = markdown.replace(
      /\n\nIf your case still isn't clear, ask\. A written answer is free and usually takes\na day\.\n/,
      '\n',
    )
    const { questions } = parseDecisionTree(joined)
    expect(questions).toHaveLength(7)
    expect(questions[5].no).toMatchObject({ next: 7 })
    expect(questions[6]).toMatchObject({ text: 'Is it a test?', yes: { verdict: 'permitted' }, no: { verdict: 'not-permitted' } })
  })
})

const CTX = { repo: 'https://github.com/open-steward/opensteward', commit: 'abc' }

describe('rewriteHref', () => {
  it('sends repository files to GitHub at the pinned commit', () => {
    expect(rewriteHref('./LICENSE', CTX)).toBe('https://github.com/open-steward/opensteward/blob/abc/LICENSE')
    expect(rewriteHref('./TRADEMARKS.md', CTX)).toBe('https://github.com/open-steward/opensteward/blob/abc/TRADEMARKS.md')
  })

  it('sends product docs to the docs site', () => {
    expect(rewriteHref('docs/deployment/license.md', CTX)).toBe('https://docs.opensteward.dev/deployment/license/')
    expect(rewriteHref('docs/deployment/license.md#renewing', CTX)).toBe(
      'https://docs.opensteward.dev/deployment/license/#renewing',
    )
  })

  it('leaves anchors, mail and absolute links alone', () => {
    for (const href of ['#getting-in-touch', 'https://license.opensteward.dev/terms', 'https://opensteward.dev/license', 'mailto:support@opensteward.dev']) {
      expect(rewriteHref(href, CTX)).toBe(href)
    }
  })

  it('stops on a link outside the repository', () => {
    expect(() => rewriteHref('../elsewhere.md', CTX)).toThrow(/^COMMERCIAL-LICENSE\.md: /)
  })
})

describe('renderCommercialLicense', () => {
  const FIXTURE = `# Commercial licensing

OpenSteward's code is free to use for almost everything.

## You probably don't need a commercial licence

The [\`LICENSE\`](./LICENSE) already permits it.

| Scenario | Verdict |
|---|---|
| Internal use | **Permitted** |
| Shared managed service | **Not permitted** |

${SECTION}
## Getting in touch

Email **support@opensteward.dev**.
`

  it('takes the title and intro out of the body', () => {
    const { title, intro, html } = renderCommercialLicense(FIXTURE, CTX)
    expect(title).toBe('Commercial licensing')
    expect(intro).toBe("OpenSteward's code is free to use for almost everything.")
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('free to use for almost everything')
  })

  it('gives headings ids, wraps tables and rewrites links', () => {
    const { html } = renderCommercialLicense(FIXTURE, CTX)
    expect(html).toContain('<h2 id="getting-in-touch">')
    expect(html).toContain('<h3 id="questions-that-settle-the-rest">')
    expect(html).toContain('<div class="table-scroll"><table>')
    expect(html).toContain('href="https://github.com/open-steward/opensteward/blob/abc/LICENSE"')
    expect(html).toContain('href="#getting-in-touch"')
  })

  it('marks the decision list, and only that one', () => {
    const { html } = renderCommercialLicense(FIXTURE, CTX)
    expect(html.match(/<ol data-decision-tree/g)).toHaveLength(1)
    const list = html.slice(html.indexOf('<ol data-decision-tree'))
    expect(list).toContain('Is the deployment used only by your own organization')
  })
})
