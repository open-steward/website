// How many built-in dashboards the product ships, from its docs/admin/dashboards.md, so the home
// page's number follows the product. A reworded sentence stops the build instead of leaving a
// stale number on the page.

const SHIPS = /OpenSteward ships (\d+),/

/** @param {string} markdown  docs/admin/dashboards.md */
export function builtInDashboardCount(markdown) {
  const match = markdown.match(SHIPS)
  if (match === null) throw new Error('docs/admin/dashboards.md: no "OpenSteward ships <n>," sentence to count the built-in dashboards from')
  return Number(match[1])
}
