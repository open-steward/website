// What a deploy deletes from the bucket, and which dropped files it keeps for a while.
// Pure, so it is tested without S3; deploy.mjs lists the bucket and carries the plan out.

import { keepWhenStale } from './headers.mjs'

export const MARKERS = '_deploy/stale/'
export const KEEP_STALE_DAYS = 7

/**
 * @param {Map<string, number>} objects  every key in the bucket -> its LastModified (ms)
 * @param {Set<string>} wanted           every key of the build being deployed
 * @param {number} now                   ms
 * @returns {{ toDelete: string[], toMark: string[] }}
 *   toMark: dropped files to keep for now; the deploy writes an empty marker for each, whose
 *   LastModified records when the file was first dropped.
 */
export function planCleanup(objects, wanted, now) {
  const cutoff = now - KEEP_STALE_DAYS * 24 * 60 * 60 * 1000
  const toDelete = []
  const toMark = []
  for (const [key] of objects) {
    if (key.startsWith(MARKERS)) {
      const target = key.slice(MARKERS.length)
      // The file is back in the build, or already gone: the marker has done its job.
      if (wanted.has(target) || !objects.has(target)) toDelete.push(key)
      continue
    }
    if (wanted.has(key)) continue
    if (!keepWhenStale(key)) {
      toDelete.push(key)
      continue
    }
    const marked = objects.get(MARKERS + key)
    if (marked === undefined) toMark.push(key)
    else if (marked < cutoff) toDelete.push(key, MARKERS + key)
  }
  return { toDelete, toMark }
}
