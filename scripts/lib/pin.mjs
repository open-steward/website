// Whether the pinned product commit is on the product's main branch. GitHub serves any commit
// in a repository's network by ID, including the head of an unmerged pull request, so the
// fetch alone does not show that a pin is merged product work.

/**
 * @param {(...args: string[]) => string | Buffer} git  runs git in a checkout whose origin is the product
 * @param {string} commit  the pinned commit, already fetched
 * @returns {boolean} true when `commit` is main's tip or one of its ancestors
 */
export function isOnMain(git, commit) {
  // Commits only (no trees or blobs): enough to walk main's history back to the pin.
  git('fetch', '--quiet', '--filter=tree:0', 'origin', '+refs/heads/main:refs/remotes/origin/main')
  try {
    git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main')
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
}
