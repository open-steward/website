// The commercial licensing page's decision tree, bundled into a file by Astro (no inline script).
// The page holds the questions as a numbered list, which readers without JavaScript keep; this
// replaces it with one question at a time, read from the JSON beside it.

type Verdict = 'permitted' | 'not-permitted' | 'ask'

interface Outcome {
  explanation: string
  next?: number
  verdict?: Verdict
  note: string
}

interface Question {
  n: number
  text: string
  yes: Outcome
  no: Outcome
}

interface Data {
  tree: { questions: Question[] }
  cta: { label: string; href: string }
  email: string
}

type Answer = 'yes' | 'no'

const STANDING_NOTE =
  'Whatever your answers, removing, disabling or working around the license checks is never permitted.'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  node.append(...children)
  return node
}

const sentence = (text: string): string => {
  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.?!]$/.test(capital) ? capital : `${capital}.`
}

const label = (answer: Answer): string => (answer === 'yes' ? 'Yes' : 'No')

function start(list: HTMLOListElement, data: Data): void {
  const byNumber = new Map(data.tree.questions.map((q) => [q.n, q]))
  const first = data.tree.questions[0]
  if (first === undefined) return

  const steps = el('ol', { class: 'decision-tree__steps' })
  const result = el('div', { class: 'decision-tree__result', 'aria-live': 'polite' })
  const restart = el('button', { type: 'button', class: 'btn btn--ghost decision-tree__restart', 'data-restart': '' }, 'Start over')
  restart.hidden = true
  const app = el(
    'div',
    { class: 'decision-tree' },
    steps,
    result,
    el('p', { class: 'decision-tree__note' }, STANDING_NOTE),
    restart,
  )
  list.replaceWith(app)

  function verdictBox(question: Question, answer: Answer): HTMLElement {
    const outcome = question[answer]
    const kind = outcome.verdict!
    const box = el('div', { class: `verdict verdict--${kind}`, 'data-verdict': kind, tabindex: '-1' })
    const email = el('a', { class: 'btn btn--secondary', href: `mailto:${data.email}` }, `Email ${data.email}`)
    if (kind === 'permitted') {
      box.append(
        el('h4', {}, 'Permitted: no commercial licence needed.'),
        el('p', {}, 'The standard terms already allow this. Each install needs a license file, and there is a free one.'),
      )
    } else if (kind === 'not-permitted') {
      box.append(
        el('h4', {}, 'This needs a commercial licence.'),
        el('p', {}, "This is the one use OpenSteward reserves. A commercial licence is available: tell us what you're building."),
      )
    } else {
      box.append(
        el('h4', {}, 'Ask us before you deploy.'),
        el('p', {}, `${outcome.note} A written answer is free and usually takes a day.`.trim()),
      )
    }
    if (outcome.explanation !== '') {
      box.append(
        el('p', { class: 'verdict__why' }, `Your answer to question ${question.n}: ${label(answer)}, ${outcome.explanation}.`),
      )
    }
    const action =
      kind === 'permitted' ? el('a', { class: 'btn btn--primary', href: data.cta.href }, data.cta.label) : email
    box.append(el('p', { class: 'verdict__actions' }, action))
    return box
  }

  function choose(step: HTMLElement, question: Question, answer: Answer): void {
    // Re-answering drops every later question and the old verdict.
    while (step.nextElementSibling) step.nextElementSibling.remove()
    result.replaceChildren()
    for (const button of step.querySelectorAll<HTMLButtonElement>('button[data-answer]')) {
      button.setAttribute('aria-pressed', String(button.dataset.answer === answer))
    }
    step.querySelector('[data-explanation]')?.remove()
    const outcome = question[answer]
    if (outcome.explanation !== '') {
      step.append(el('p', { class: 'decision-tree__explanation', 'data-explanation': '' }, sentence(outcome.explanation)))
    }
    restart.hidden = false

    const next = outcome.next === undefined ? undefined : byNumber.get(outcome.next)
    if (next !== undefined) {
      const added = ask(next)
      added.querySelector<HTMLButtonElement>('button[data-answer="yes"]')?.focus()
      return
    }
    const box = verdictBox(question, answer)
    result.append(box)
    box.focus()
  }

  function ask(question: Question): HTMLElement {
    const step = el('li', { class: 'decision-tree__step', 'data-question': String(question.n) })
    const buttons = (['yes', 'no'] as const).map((answer) => {
      const button = el(
        'button',
        { type: 'button', class: 'btn btn--secondary', 'data-answer': answer, 'aria-pressed': 'false' },
        label(answer),
      )
      button.addEventListener('click', () => choose(step, question, answer))
      return button
    })
    step.append(
      el(
        'p',
        { class: 'decision-tree__question', id: `decision-question-${question.n}` },
        el('span', { class: 'decision-tree__n' }, `Question ${question.n}`),
        question.text,
      ),
      el(
        'div',
        { class: 'decision-tree__answers', role: 'group', 'aria-labelledby': `decision-question-${question.n}` },
        ...buttons,
      ),
    )
    steps.append(step)
    return step
  }

  restart.addEventListener('click', () => {
    steps.replaceChildren()
    result.replaceChildren()
    restart.hidden = true
    ask(first).querySelector<HTMLButtonElement>('button[data-answer="yes"]')?.focus()
  })

  ask(first)
}

const list = document.querySelector<HTMLOListElement>('ol[data-decision-tree]')
const json = document.getElementById('decision-tree-data')?.textContent
if (list && json) start(list, JSON.parse(json) as Data)
