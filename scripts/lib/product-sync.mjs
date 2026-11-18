// What the hourly product sync (scripts/product-sync.mjs) does on each run, and the text of
// its pull request. Pure functions: the script does the git and GitHub work.

/** The branch the sync PR comes from. */
export const BRANCH = 'product-sync'
/** The check that gates merges into main (site.yml's job, required by the main ruleset). */
export const CHECK = 'Build and check'
/** After this long open, the PR is reported as stuck. */
export const STALE_HOURS = 24

const HOUR = 60 * 60 * 1000
/** GitHub's compare API lists at most this many files. */
const COMPARE_FILE_LIMIT = 300

const inPaths = (name, paths) => name !== undefined && paths.some((p) => (p.endsWith('/') ? name.startsWith(p) : name === p))

/** The changed files the site reads (product.json's `paths`), moves out of them included. */
export const syncedFiles = (compare, paths) =>
  compare.files.filter((f) => inPaths(f.filename, paths) || inPaths(f.previous, paths))

/** The product files the site renders as text. A change to anything else it reads (code the build runs, styles) waits for a person. */
const CONTENT = ['docs/', 'README.md', 'COMMERCIAL-LICENSE.md']

/**
 * Whether the product commits since the pin change something the site reads beyond the text in
 * CONTENT (the Platforms list's code, the design system, tsconfig.base.json), or cannot be listed.
 * Such a sync is built and checked as usual, but merges only when someone merges it.
 */
export function needsReview(compare, paths) {
  if (compare === null || compare.files.length >= COMPARE_FILE_LIMIT) return true
  const code = (name) => inPaths(name, paths) && !inPaths(name, CONTENT)
  return syncedFiles(compare, paths).some((f) => code(f.filename) || code(f.previous))
}

/** Whether the product commits since the pin change what the site is built from. */
export function siteChanged(compare, paths) {
  if (compare === null || compare.files.length >= COMPARE_FILE_LIMIT) return true
  return syncedFiles(compare, paths).length > 0
}

/**
 * The one thing this run does.
 *
 * @param {object} state
 * @param {string} state.pinned   product.json's commit on the website's main
 * @param {string} state.latest   the product's main
 * @param {string} state.mainSha  the website's main
 * @param {null | {
 *   headSha: string,         the PR's head commit
 *   productCommit: string,   the commit the PR's product.json pins
 *   baseSha: string,         the website commit the PR's commit sits on
 *   createdAt: number,
 *   checks: 'missing' | 'pending' | 'success' | 'failure',   the CHECK run on its head
 *   notes: string[],         markers of the reports already made on it
 * }} state.pr  the open sync PR
 * @param {string | null} [state.skipped]  the product commit of the last sync PR closed
 *        without merging: closing one is how to skip a product commit
 * @param {boolean} [state.changesSite]  whether the product commits since the pin change what
 *        the site reads: commits that do not (a dependency bump, say) open no PR
 * @param {boolean} [state.reviewFirst]  whether they change more than the docs' text (needsReview):
 *        then a person merges the PR, not this script
 * @param {number} state.now
 * @returns {{ kind: 'none' | 'close' | 'update' | 'check' | 'merge' } | { kind: 'notify', marker: string, message: string }}
 *   update: rebuild the branch and the PR, and start the checks; check: start them again;
 *   merge: the checks passed on what would merge
 */
export function decide({ pinned, latest, mainSha, pr, skipped = null, changesSite = true, reviewFirst = false, now }) {
  if (latest === pinned) return pr ? { kind: 'close' } : { kind: 'none' }
  if (!pr && (latest === skipped || !changesSite)) return { kind: 'none' }
  // A new product commit, or a new website main (a fix for a failed sync, say): rebuild the
  // branch, so the checks run again on what would merge.
  if (!pr || pr.productCommit !== latest || pr.baseSha !== mainSha) return { kind: 'update' }

  if (pr.checks === 'success') {
    if (!reviewFirst) return { kind: 'merge' }
    const marker = `review:${pr.headSha}`
    if (pr.notes.includes(marker)) return { kind: 'none' }
    return {
      kind: 'notify',
      marker,
      message:
        `"Build and check" passed on this sync to opensteward@${latest.slice(0, 7)}, but it changes product code or ` +
        'styles the build uses (something outside `docs/`, `README.md` and `COMMERCIAL-LICENSE.md`), so it does not ' +
        'merge by itself. Read the product commits and files listed above, then merge this PR yourself, with a merge ' +
        'commit. To skip this product commit instead, close this PR: the next commit on the product main opens a new one.',
    }
  }
  if (pr.checks === 'missing') return { kind: 'check' }
  if (pr.checks === 'failure') {
    const marker = `failed:${pr.headSha}`
    if (pr.notes.includes(marker)) return { kind: 'none' }
    return {
      kind: 'notify',
      marker,
      message:
        `"Build and check" failed on this sync to opensteward@${latest.slice(0, 7)}, so it will not merge by itself. ` +
        "The check's log says why. Fix it on main (a new docs page, for example, needs a place in " +
        '`apps/docs/scripts/sections.mjs`), and the next hourly run rebuilds this branch on top of the fix. ' +
        'To skip this product commit instead, close this PR: the next commit on the product main opens a new one.',
    }
  }

  if (now - pr.createdAt > STALE_HOURS * HOUR && !pr.notes.includes('stale')) {
    return {
      kind: 'notify',
      marker: 'stale',
      message:
        `This sync has been open for more than ${STALE_HOURS} hours, and "Build and check" has not finished on it. ` +
        "The repository's Actions tab shows whether the run is stuck; the next hourly run merges once it passes.",
    }
  }
  return { kind: 'none' }
}

/** The state of the PR's head, from its CHECK check runs (the API's latest per name). */
export function checksState(runs) {
  if (runs.length === 0) return 'missing'
  if (runs.some((run) => run.status !== 'completed')) return 'pending'
  return runs.every((run) => run.conclusion === 'success') ? 'success' : 'failure'
}

/**
 * Why the sync branch must not merge, or null: checked again just before the merge, so a branch
 * changed by anything but this sync (or a bug in it) does not reach main and the deploy.
 *
 * @param {object} state
 * @param {{ aheadBy: number, behindBy: number, files: { filename: string, status: string }[] }} state.compare
 *        main...branch, from GitHub's compare API
 * @param {object} state.mainPin  product.json on main
 * @param {object} state.headPin  product.json on the branch
 * @param {string} state.latest   the product's main
 */
export function mergeProblem({ compare, mainPin, headPin, latest }) {
  if (compare.aheadBy !== 1 || compare.behindBy !== 0) return 'the branch is not one commit on main'
  const others = compare.files.filter(
    (f) => !((f.filename === 'product.json' && f.status === 'modified') || (/^product-patches\/[^/]+\.patch$/.test(f.filename) && f.status === 'removed')),
  )
  if (others.length > 0) return `the branch changes more than the pin: ${others.map((f) => `${f.filename} (${f.status})`).join(', ')}`
  const rest = (pin) => JSON.stringify({ ...pin, commit: undefined })
  if (rest(headPin) !== rest(mainPin)) return "the branch's product.json changes more than only the commit"
  if (headPin.commit !== latest) return `the branch pins ${headPin.commit}, not the product's main ${latest}`
  return null
}

/**
 * The words that make GitHub skip the workflows of a push. The product's commit subjects carry
 * them; in this repository a merge commit holding one would skip the deploy.
 */
const CI_SKIP = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/gi
const subjectOf = (message) => message.split('\n')[0].replace(CI_SKIP, '').replace(/\s+/g, ' ').trim()

/**
 * `text` as a Markdown code span: GitHub turns no @name or #number inside one into a mention or
 * a link, so a product commit's subject notifies no one and points at no issue of this repo.
 */
function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/** A pull request body for moving the pin from `pinned` to `latest`. */
export function prBody({ productRepo, paths, pinned, latest, compare, deletedPatches, reviewFirst = false }) {
  const short = (sha) => sha.slice(0, 7)
  const link = (sha) => `[opensteward@${short(sha)}](${productRepo}/commit/${sha})`
  const parts = [
    `Moves the docs from ${link(pinned)} to ${link(latest)} ([comparison](${productRepo}/compare/${pinned}...${latest})).`,
    reviewFirst
      ? 'Opened by the hourly product sync (`.github/workflows/product-sync.yml`). It changes product code or ' +
        'styles the build uses (something outside `docs/`, `README.md` and `COMMERCIAL-LICENSE.md`), so it does ' +
        'not merge by itself: once "Build and check" passes, review it and merge it yourself, with a merge commit.'
      : 'Opened by the hourly product sync (`.github/workflows/product-sync.yml`). It merges by itself once ' +
        '"Build and check" passes, and that check also confirms this PR changes nothing but the pin and ' +
        'deletions of patches the product now carries.',
  ]

  if (compare === null) {
    parts.push("The sync could not read the product's commits for this range: see the comparison.")
  } else {
    const newest = [...compare.commits].reverse().slice(0, 50)
    const more = compare.totalCommits - newest.length
    const lines = newest.map((c) => `- [${short(c.sha)}](${productRepo}/commit/${c.sha}) ${codeSpan(subjectOf(c.message))}`)
    if (more > 0) lines.push(`- and ${more} more`)
    parts.push(`### Product commits (${compare.totalCommits})\n\n${lines.join('\n')}`)

    const synced = syncedFiles(compare, paths)
    const files = synced.slice(0, 100).map((f) => `- \`${f.filename}\` (${f.status})`)
    if (synced.length > 100) files.push(`- and ${synced.length - 100} more`)
    parts.push(
      synced.length > 0
        ? `### Files changed in what the site reads\n\n${files.join('\n')}`
        : '### Files changed in what the site reads\n\nNone: the site is rebuilt from the same docs and design system.',
    )
  }

  if (deletedPatches.length > 0) {
    parts.push(`### Patches deleted: the product now carries them\n\n${deletedPatches.map((p) => `- \`${p}\``).join('\n')}`)
  }
  return `${parts.join('\n\n')}\n`
}
