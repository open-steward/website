// /llms.txt (https://llmstxt.org): what OpenSteward is, for AI agents, and where the Markdown
// versions of this site and the docs are. The Markdown copies of the pages (/index.md,
// /security.md, /commercial-licensing.md) are made from the built pages by scripts/assemble.mjs.

import type { APIRoute } from 'astro'
import { LINKS, SUPPORT_EMAIL, docsPage, platformCount, verticals } from '../data/product'

const count = platformCount.toLocaleString('en-US')
const verticalNames = verticals.map((v) => v.label.toLowerCase().replace(/^crm$/, 'CRM'))
const list = `${verticalNames.slice(0, -1).join(', ')} and ${verticalNames.at(-1)}`

export const GET: APIRoute = ({ site }) => {
  const here = (path: string) => new URL(path, site).href
  const text = `# OpenSteward

> OpenSteward is a source-available, self-hosted unified API: one REST API across ${list}, with ${count} platform adapters and one canonical schema per vertical. It runs on your own servers, so your customers' data never passes through a third party.

Limited production use is free, with a free license file from ${LINKS.license}, under the Elastic License 2.0 with an Additional Use Grant. Every page of this site and of the docs is also available as Markdown: the links below point to those copies.

## This site

- [Home](${here('/index.md')}): what OpenSteward does, the verticals, the features, the admin console and licensing
- [Security](${here('/security.md')}): how OpenSteward is built for security reviews, and how to report a vulnerability
- [Commercial licensing](${here('/commercial-licensing.md')}): when you need a commercial licence, and the questions that settle it

## Documentation

- [Docs index](${docsPage('llms.txt')}): every page of the docs, by section, as Markdown
- [All of the docs in one file](${docsPage('llms-full.txt')})
- [Developer Guide](${docsPage('dev-api.md')}): the unified REST API, authentication and Connect Link
- [MCP server](${docsPage('mcp.md')}): giving AI agents read-only access to customer data
- [Platform catalog](${docsPage('platforms.md')}): every adapter, by vertical, and how far each is verified
- [OpenAPI spec, unified API](${docsPage('downloads/openapi/openapi.yaml')}): every operation of the unified API (also [as JSON](${docsPage('downloads/openapi/openapi.json')}))
- [OpenAPI spec, operator API](${docsPage('downloads/openapi/admin-api.openapi.json')}): the admin console's API, for operators

## Licensing and contact

- [Plans and free license](${LINKS.license})
- [Source code](${LINKS.github})
- [Commercial licensing](${here('/commercial-licensing.md')})
- [Terms](${LINKS.terms})
- [Privacy](${LINKS.privacy})
- Contact: ${SUPPORT_EMAIL}
`
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
