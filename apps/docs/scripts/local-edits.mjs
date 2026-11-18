// Sentences this site words differently from the product, by product page. sync.mjs applies them
// to the product's Markdown before anything else, so links in the new text resolve like any other.
//
// Each `find` must be in the page exactly once. When the product rewrites the sentence, the
// build stops here: redo the edit against the new text, or drop it.

export const LOCAL_EDITS = {
  'docs/dev-api.md': [
    {
      // The product points at the reference on its own docs-server; here it is a page of this site.
      find: 'and rendered as the Unified API reference at `http://localhost:3003/unified-api` when docs-server is running.',
      replace: 'and rendered as the [Unified API reference](/unified-api/).',
    },
  ],
}

/** The page's Markdown with this site's edits made. */
export function applyLocalEdits(path, source, edits = LOCAL_EDITS) {
  let text = source
  for (const { find, replace } of edits[path] ?? []) {
    const count = text.split(find).length - 1
    if (count !== 1) {
      throw new Error(
        `${path}: a local edit expects its text once, and found it ${count} times. The product ` +
          `changed the page: update or remove the edit in apps/docs/scripts/local-edits.mjs.\n  ${find}`,
      )
    }
    text = text.replace(find, () => replace)
  }
  return text
}
