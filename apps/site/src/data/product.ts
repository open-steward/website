// Facts about the product, read at build time from the docs pinned in product.json, so the
// site's numbers always match the docs it links to.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { builtInDashboardCount } from '../lib/dashboards.mjs'
import { isVerifiedLive } from '../lib/verification.mjs'

// Relative to the app folder: Astro bundles this module before running it, so import.meta.url
// does not point here at build time.
const docs = (path: string): string => resolve(process.cwd(), '../../.product/docs', path)

interface Platform {
  vertical: string
  slug: string
  name: string
}

const catalog = JSON.parse(readFileSync(docs('platforms/platforms.json'), 'utf8')) as {
  total: number
  platforms: Platform[]
}

export interface Vertical {
  slug: string
  label: string
  /** The two letters on its tile. */
  abbr: string
  resources: string
  count: number
}

const VERTICALS: Omit<Vertical, 'count'>[] = [
  { slug: 'accounting', label: 'Accounting', abbr: 'Ac', resources: 'Invoices, contacts, accounts, transactions' },
  { slug: 'crm', label: 'CRM', abbr: 'Cr', resources: 'Contacts, deals, companies, activities' },
  { slug: 'ecommerce', label: 'E-commerce', abbr: 'Ec', resources: 'Products, orders, customers, fulfilments' },
  { slug: 'logistics', label: 'Logistics', abbr: 'Lo', resources: 'Shipments, carriers, rates, labels' },
  { slug: 'payments', label: 'Payments', abbr: 'Pa', resources: 'Charges, refunds, subscriptions, payouts' },
  { slug: 'docsign', label: 'E-signature', abbr: 'Es', resources: 'Envelopes, documents, signers, templates' },
  { slug: 'projects', label: 'Projects', abbr: 'Pr', resources: 'Projects, tasks, comments, workspaces' },
  { slug: 'customer-support', label: 'Customer support', abbr: 'Cs', resources: 'Tickets, messages, contacts, macros' },
  { slug: 'inventory', label: 'Inventory', abbr: 'In', resources: 'Products, locations, stock levels, transfers' },
]

const counts = new Map<string, number>()
for (const platform of catalog.platforms) {
  counts.set(platform.vertical, (counts.get(platform.vertical) ?? 0) + 1)
}
const unknown = [...counts.keys()].filter((slug) => !VERTICALS.some((v) => v.slug === slug))
if (unknown.length > 0) throw new Error(`platforms.json has verticals the site does not list: ${unknown}`)

export const verticals: Vertical[] = VERTICALS.map((v) => ({ ...v, count: counts.get(v.slug) ?? 0 }))
export const platformCount = catalog.platforms.length
if (platformCount !== catalog.total) throw new Error('platforms.json: total disagrees with its list')

export interface VerifiedAdapter {
  vertical: string
  name: string
  level: string
}

/** The "Verification" table of docs/platforms/platforms.md: adapters run against real APIs. */
function verifiedAdapters(): VerifiedAdapter[] {
  const markdown = readFileSync(docs('platforms/platforms.md'), 'utf8')
  const section = markdown.split(/^## Verification\s*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) throw new Error('platforms.md has no Verification section')
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*(Vertical|-)/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
  // | vertical | `slug` | Platform | Verified |
  const adapters = rows.map((cells) => ({ vertical: cells[1]!, name: cells[3]!, level: cells[4]! }))
  if (adapters.length === 0) throw new Error('platforms.md: the Verification table is empty')
  return adapters
}

export const verified = verifiedAdapters()
/** Adapters run against the platform's real API, in a sandbox or in production. */
export const verifiedLive = verified.filter((a) => isVerifiedLive(a.level))
if (verifiedLive.length === 0) throw new Error('platforms.md: no adapter verified against a real API')

export const LINKS = {
  license: 'https://license.opensteward.dev/',
  terms: 'https://license.opensteward.dev/terms',
  privacy: 'https://license.opensteward.dev/privacy',
  docs: 'https://docs.opensteward.dev/',
  github: 'https://github.com/open-steward/opensteward',
  securityAdvisory: 'https://github.com/open-steward/opensteward/security/advisories/new',
  support: 'mailto:support@opensteward.dev',
} as const

export const SUPPORT_EMAIL = 'support@opensteward.dev'

/** The free-license call to action, word for word. */
export const LICENSE_CTA = 'Get a free license at license.opensteward.dev'

/** The product commit the site is built from (product.json), for links into the repository. */
const pin = JSON.parse(readFileSync(resolve(process.cwd(), '../../product.json'), 'utf8')) as {
  repository: string
  commit: string
}
export const PRODUCT = { repo: pin.repository.replace(/\.git$/, ''), commit: pin.commit } as const

export const docsPage = (path: string): string => `${LINKS.docs}${path}`

/** Built-in dashboards, from docs/admin/dashboards.md. */
export const builtInDashboards = builtInDashboardCount(readFileSync(docs('admin/dashboards.md'), 'utf8'))
