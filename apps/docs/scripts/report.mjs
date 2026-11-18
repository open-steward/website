// What sync.mjs tells a GitHub Actions run (its job summary, $GITHUB_STEP_SUMMARY): what it
// built and what needs a look, so a sync PR's problems show on its checks page.

const code = (line) => `- \`${line.replace(/`/g, "'").replace(/\s+/g, ' ')}\``

export function syncReport({ commit, pages, diagrams, files, unresolved, failed }) {
  const parts = [`### Docs from opensteward@${commit.slice(0, 7)}`, `${pages} pages, ${diagrams} diagrams, ${files} files copied.`]
  if (failed.length > 0) parts.push(`**Diagrams shown as source** (Mermaid could not parse them):\n\n${failed.map(code).join('\n')}`)
  if (unresolved.length > 0) parts.push(`**Links left as written** (they point at no page here):\n\n${unresolved.map(code).join('\n')}`)
  if (failed.length === 0 && unresolved.length === 0) parts.push('Every diagram rendered and every link resolved.')
  return `${parts.join('\n\n')}\n`
}
