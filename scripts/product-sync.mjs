#!/usr/bin/env node
// The hourly product sync, run from main by .github/workflows/product-sync.yml. Each run takes
// one step, which lib/product-sync.mjs decides:
//
//   - the product's main has moved past product.json's pin, in files the site reads: make the
//     branch product-sync one commit on main that moves the pin (minus the patches the product
//     now carries), open or update its pull request, and start site.yml's "Build and check" on
//     the branch;
//   - that check passed: check the branch again (mergeProblem), merge the PR, and start site.yml
//     on main, which checks the merge and deploys it. When the product changed more than its
//     docs text (needsReview), ask for a review on the PR instead, once: a person merges it;
//   - the check failed, or the PR is stuck: say so on the PR, once.
//
// The only credential is the workflow's own GITHUB_TOKEN, which exists only while the job runs.
// What that token does starts no workflow (GitHub's rule, so a workflow cannot loop), except a
// workflow_dispatch: so this script starts the checks and the deploy itself. The commit is made
// through the API, so GitHub signs it; no git credentials are written, and nothing is installed
// in the job. README: "Staying in sync with the product".
//
// --dry-run reads everything and prints the writes instead of making them, changing no file:
//   GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=open-steward/website GITHUB_SHA=<main> node scripts/product-sync.mjs --dry-run

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRANCH, CHECK, checksState, decide, mergeProblem, needsReview, prBody, siteChanged } from './lib/product-sync.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const repo = env('GITHUB_REPOSITORY')
const owner = repo.split('/')[0]
const mainSha = env('GITHUB_SHA')
const token = env('GITHUB_TOKEN')
const assignee = process.env.SYNC_ASSIGNEE ?? ''
const dryRun = process.argv.includes('--dry-run')
// git and fetch-product.mjs run without the token.
const { GITHUB_TOKEN: _token, ...childEnv } = process.env

async function api(method, path, body, { allow = [] } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'opensteward-website-product-sync',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text === '' ? null : JSON.parse(text)
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${method} ${path}: ${response.status} ${data?.message ?? ''}`)
  }
  return { ok: response.ok, status: response.status, data }
}
const read = async (path) => (await api('GET', path)).data
async function write(method, path, body, options) {
  if (!dryRun) return api(method, path, body, options)
  console.log(`[dry run] ${method} ${path}\n${JSON.stringify(body, null, 2)}`)
  return { ok: true, status: 200, data: { sha: 'dry-run', number: 0 } }
}

const pinFile = join(root, 'product.json')
const pin = JSON.parse(readFileSync(pinFile, 'utf8'))
const productRepo = pin.repository.replace(/\.git$/, '')
const productSlug = productRepo.replace('https://github.com/', '')
const short = (sha) => sha.slice(0, 7)

const pinAt = async (ref) => {
  const file = await read(`/repos/${repo}/contents/product.json?ref=${ref}`)
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
}
const comment = (number, body) => write('POST', `/repos/${repo}/issues/${number}/comments`, { body })
/** Starts site.yml on a branch: "Build and check", and on main the deploy after it. */
const runSite = (ref) => write('POST', `/repos/${repo}/actions/workflows/site.yml/dispatches`, { ref })

// The product's main, read anonymously (the product repository is public).
const latest = execFileSync('git', ['ls-remote', pin.repository, 'refs/heads/main'], { encoding: 'utf8', env: childEnv }).split('\t')[0]
if (!/^[0-9a-f]{40}$/.test(latest)) throw new Error(`could not read the product's main from ${pin.repository}`)

// The open sync PR, if there is one, and what it holds.
const open = await read(`/repos/${repo}/pulls?state=open&base=main&head=${owner}:${BRANCH}`)
let pr = null
let skipped = null
if (open.length > 0) {
  const p = open[0]
  const headSha = p.head.sha
  const head = await read(`/repos/${repo}/commits/${headSha}`)
  const runs = await read(`/repos/${repo}/commits/${headSha}/check-runs?filter=latest&check_name=${encodeURIComponent(CHECK)}`)
  const comments = await read(`/repos/${repo}/issues/${p.number}/comments?per_page=100`)
  pr = {
    number: p.number,
    title: p.title,
    headSha,
    productCommit: (await pinAt(headSha)).commit,
    baseSha: head.parents[0]?.sha,
    createdAt: Date.parse(p.created_at),
    checks: checksState(runs.check_runs),
    notes: comments.flatMap((c) => [...(c.body ?? '').matchAll(/<!-- product-sync:(\S+) -->/g)].map((m) => m[1])),
  }
} else {
  // A sync PR someone closed without merging skips its product commit. (One this script closed,
  // by rebuilding its branch, does not.)
  const [last] = await read(`/repos/${repo}/pulls?state=closed&base=main&head=${owner}:${BRANCH}&sort=created&direction=desc&per_page=1`)
  if (last && last.merged_at === null) {
    const issue = await read(`/repos/${repo}/issues/${last.number}`)
    if (issue.closed_by?.type !== 'Bot') skipped = (await pinAt(last.head.sha)).commit
  }
}

// The product commits and files since the pin: whether they change the site, and the PR body.
let compare = null
if (latest !== pin.commit) {
  try {
    const c = await read(`/repos/${productSlug}/compare/${pin.commit}...${latest}`)
    compare = {
      totalCommits: c.total_commits,
      commits: c.commits.map((x) => ({ sha: x.sha, message: x.commit.message })),
      files: (c.files ?? []).map((f) => ({ filename: f.filename, previous: f.previous_filename, status: f.status })),
    }
  } catch (error) {
    console.log(`::warning::could not compare the product commits: ${error.message}`)
  }
}
const changesSite = siteChanged(compare, pin.paths)
const reviewFirst = needsReview(compare, pin.paths)

const decision = decide({ pinned: pin.commit, latest, mainSha, pr, skipped, changesSite, reviewFirst, now: Date.now() })
console.log(
  `product main ${short(latest)}, pin ${short(pin.commit)}, sync PR ${pr ? `#${pr.number} (checks: ${pr.checks})` : 'none'}` +
    `${changesSite ? '' : ', nothing the site reads changed'}${reviewFirst && changesSite ? ', waits for a review' : ''}: ${decision.kind}`,
)

/** Says something on the PR once (per marker), assigns SYNC_ASSIGNEE, and fails this run. */
async function report(marker, message) {
  if (!pr.notes.includes(marker)) {
    await comment(pr.number, `${message}\n\n<!-- product-sync:${marker} -->`)
    if (assignee !== '') await write('POST', `/repos/${repo}/issues/${pr.number}/assignees`, { assignees: [assignee] })
  }
  console.log(`::error::sync PR #${pr.number}: ${message}`)
  process.exitCode = 1
}

if (decision.kind === 'close') {
  await comment(pr.number, `main already pins opensteward@${short(latest)}, the product's main, so this sync is no longer needed.`)
  await write('PATCH', `/repos/${repo}/pulls/${pr.number}`, { state: 'closed' })
}

if (decision.kind === 'notify') await report(decision.marker, decision.message)

if (decision.kind === 'check') {
  await runSite(BRANCH)
  console.log(`started "${CHECK}" on ${BRANCH} for #${pr.number}`)
}

if (decision.kind === 'merge') {
  const c = await read(`/repos/${repo}/compare/${mainSha}...${pr.headSha}`)
  const problem = mergeProblem({
    compare: { aheadBy: c.ahead_by, behindBy: c.behind_by, files: c.files.map((f) => ({ filename: f.filename, status: f.status })) },
    mainPin: pin,
    headPin: await pinAt(pr.headSha),
    latest,
  })
  if (problem) {
    await report(`refused:${pr.headSha}`, `The sync will not merge this: ${problem}. Close this PR; the next run opens a fresh one.`)
  } else {
    // `sha`: only the commit that was checked merges. The message is set here, not taken from the PR.
    const merged = await write(
      'PUT',
      `/repos/${repo}/pulls/${pr.number}/merge`,
      { sha: pr.headSha, merge_method: 'merge', commit_title: `${pr.title} (#${pr.number})`, commit_message: `Moves product.json's pin to ${latest}.` },
      { allow: [403, 405, 409, 422] },
    )
    if (!merged.ok) {
      await report(`merge-refused:${pr.headSha}`, `GitHub refused to merge this sync: ${merged.data?.message ?? merged.status}.`)
    } else {
      await runSite('main')
      console.log(`merged #${pr.number}; started site.yml on main, which deploys`)
    }
  }
}

if (decision.kind === 'update') {
  // The new pin, and the patches the product now carries (fetch-product.mjs deletes them).
  const pinText = `${JSON.stringify({ ...pin, commit: latest }, null, 2)}\n`
  let deletedPatches = []
  if (!dryRun) {
    writeFileSync(pinFile, pinText)
    try {
      execFileSync('node', [join(root, 'scripts/fetch-product.mjs'), '--drop-upstream-patches'], { cwd: root, stdio: 'inherit', env: childEnv })
    } catch {
      // A patch that no longer applies: open the PR anyway, so its failed check shows why.
      console.log('::warning::the product could not be fetched and patched at the new commit; the check will fail')
    }
    deletedPatches = execFileSync('git', ['ls-files', '--deleted', '--', 'product-patches'], { cwd: root, encoding: 'utf8', env: childEnv })
      .split('\n')
      .filter(Boolean)
  }

  // One commit on top of main: the new product.json, minus the deleted patches.
  const base = dryRun ? { tree: { sha: 'dry-run' } } : await read(`/repos/${repo}/git/commits/${mainSha}`)
  const tree = await write('POST', `/repos/${repo}/git/trees`, {
    base_tree: base.tree.sha,
    tree: [
      { path: 'product.json', mode: '100644', type: 'blob', content: pinText },
      ...deletedPatches.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ],
  })
  const title = `Sync docs to opensteward@${short(latest)}`
  const message = [
    title,
    '',
    `Moves product.json's pin to ${latest}, the product's main.`,
    ...(deletedPatches.length > 0 ? ['', 'Deletes the patches the product now carries:', ...deletedPatches.map((p) => `- ${p}`)] : []),
  ].join('\n')
  const commit = await write('POST', `/repos/${repo}/git/commits`, { message, tree: tree.data.sha, parents: [mainSha] })

  // Move the branch. GitHub may refuse to move it (it does not let this token move a branch
  // across workflow changes on main, say): then make it afresh, which closes its old PR.
  let replaced = null
  const moved = await write('PATCH', `/repos/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.data.sha, force: true }, { allow: [403, 404, 422] })
  if (!moved.ok) {
    await write('DELETE', `/repos/${repo}/git/refs/heads/${BRANCH}`, undefined, { allow: [404, 422] })
    await write('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.data.sha })
    replaced = pr
    pr = null
  }

  const body = prBody({ productRepo, paths: pin.paths, pinned: pin.commit, latest, compare, deletedPatches, reviewFirst })
  let number = pr?.number
  if (pr) {
    await write('PATCH', `/repos/${repo}/pulls/${pr.number}`, { title, body })
  } else {
    number = (await write('POST', `/repos/${repo}/pulls`, { title, head: BRANCH, base: 'main', body })).data.number
  }
  if (replaced) await comment(replaced.number, `Replaced by #${number}: the branch had to be made afresh.`)

  await runSite(BRANCH)
  console.log(`#${number}: ${title}${deletedPatches.length > 0 ? `, deleting ${deletedPatches.join(', ')}` : ''}; started "${CHECK}"`)
}
