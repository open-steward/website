// The docs' sections, in sidebar order. astro.config.mjs builds the sidebar from them, and
// sync.mjs the llms.txt index, so the two always list the same pages in the same order.

/**
 * Pages at the top of the sidebar: a content file, or a page of src/pages/ (`link`). An entry
 * with `child` is drawn as the second level of the entry before it, and always shown.
 */
export const TOP = [
  { label: 'Overview', content: 'index.md' },
  { label: 'Why OpenSteward', content: 'why-opensteward.md' },
  { label: 'Developer Guide', content: 'dev-api.md' },
  { label: 'MCP (AI agents)', content: 'mcp.md' },
  // src/pages/platforms/: the product's catalogue. sync.mjs writes its Markdown copy (the
  // product's table) as platforms.md, which llms.txt lists.
  { label: 'Platforms', content: 'platforms.md', link: '/platforms/' },
  { label: 'API specs and Postman', content: 'postman.md' },
  // src/pages/: Swagger UI, as on the product's docs-server.
  { label: 'Unified API', link: '/unified-api/', child: true },
  { label: 'Operator API', link: '/operator-api/', child: true },
  { label: 'Glossary', content: 'glossary.md' },
]

/**
 * A TOP or BOTTOM page as a Starlight sidebar entry. A Starlight group cannot be a link, so a
 * child is a top-level link that theme.css draws like a group's item (`data-sidebar-child`).
 */
export function sidebarEntry(page) {
  if (page.link) return { label: page.label, link: page.link, ...(page.child ? { attrs: { 'data-sidebar-child': '' } } : {}) }
  if (page.content === 'index.md') return { label: page.label, link: '/' }
  return { label: page.label, slug: slugFor(page.content) }
}

/** Then one collapsed group per directory. */
export const GROUPS = [
  { label: 'Integration guides', directory: 'integrate' },
  { label: 'Admin console', directory: 'admin' },
  { label: 'Architecture', directory: 'architecture' },
  { label: 'Deployment', directory: 'deployment' },
  { label: 'Security', directory: 'security' },
  { label: 'Operations', directory: 'operations' },
  { label: 'Environment', directory: 'environment' },
  { label: 'SDK', directory: 'sdk' },
  { label: 'Business cases', directory: 'business-cases' },
]

/** And last. */
export const BOTTOM = [{ label: 'Documentation map', content: 'overview.md' }]

/**
 * Pages no sidebar section holds (a new top-level page, a new directory), sorted. sync.mjs
 * refuses to build with any: each needs a place in TOP or GROUPS first.
 */
export function unlistedPages(contentPaths) {
  const listed = new Set([...TOP, ...BOTTOM].map((entry) => entry.content).filter(Boolean))
  return contentPaths
    .filter((path) => !listed.has(path) && !GROUPS.some(({ directory }) => path.startsWith(`${directory}/`)))
    .sort()
}

/** The integration guides' vertical subgroups, named the way the marketing site names them. */
export const VERTICALS = {
  accounting: 'Accounting',
  crm: 'CRM',
  ecommerce: 'E-commerce',
  logistics: 'Logistics',
  payments: 'Payments',
  docsign: 'E-signature',
  projects: 'Projects',
  'customer-support': 'Customer support',
  inventory: 'Inventory',
}

export const verticalLabel = (dir) => VERTICALS[dir] ?? dir.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** A content file's slug, as Starlight's sidebar takes it: `admin/status.md` -> `admin/status`. */
export const slugFor = (content) => content.replace(/\.md$/, '').replace(/(^|\/)index$/, '')

/**
 * The order pages appear in within one directory group, as the sidebar's autogenerate puts
 * them: the index page first, then by file name.
 */
export function sortInGroup(a, b) {
  const rank = (path) => (/(^|\/)index\.md$/.test(path) ? 0 : 1)
  return rank(a) - rank(b) || a.localeCompare(b)
}
