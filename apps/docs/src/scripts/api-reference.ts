// The API reference pages: Swagger UI, and the rail beside it from the product's docs-server
// (apps/docs-server/src/swagger-reference.ts). The rail lists the spec's tag groups and, for the
// active one, its operations; picking a group drives Swagger UI's own tag filter through the
// Redux action its built-in filter box fires (that box is hidden, so there is one filter UI),
// and the rail's text box narrows the visible operations by path or summary.
//
// The spec is fetched once and handed to Swagger UI as an object: it is 1-2 MB, and the rail
// reads the same copy.

interface Operation {
  method: string
  path: string
  summary: string
  operationId: string
}

interface Spec {
  paths?: Record<string, Record<string, { tags?: string[]; summary?: string; operationId?: string }>>
  tags?: { name: string }[]
}

interface SwaggerSystem {
  layoutActions: { updateFilter(value: string): void }
}

interface SwaggerUIBundleFn {
  (options: Record<string, unknown>): { getSystem(): SwaggerSystem }
  presets: { apis: unknown }
}

declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerUIBundleFn
  }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

// Tag name (lower case) -> the vertical whose colour tints its tile and section. The stems match
// the design system's --vertical-<stem> tokens. Tags that are not verticals get a plain tile.
const VERTICAL_MAP: Record<string, string> = {
  accounting: 'accounting', accountancy: 'accounting',
  crm: 'crm', sales: 'crm',
  ecommerce: 'ecommerce', commerce: 'ecommerce', orders: 'ecommerce',
  logistics: 'logistics', shipping: 'logistics', fulfilment: 'logistics',
  payments: 'payments', payment: 'payments', billing: 'payments',
  docsign: 'docsign', docsigning: 'docsign', 'doc signing': 'docsign', esignature: 'docsign',
  projects: 'projects', project: 'projects',
  'customer-support': 'customer-support', 'customer support': 'customer-support',
  customersupport: 'customer-support', support: 'customer-support',
  inventory: 'inventory', stock: 'inventory',
}
const verticalFor = (tag: string) => VERTICAL_MAP[tag.toLowerCase()] ?? ''

const escapeHtml = (text: string) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function start() {
  const root = document.querySelector<HTMLElement>('[data-api-ref]')
  const Swagger = window.SwaggerUIBundle
  if (!root || !Swagger) return
  const specUrl = root.dataset.spec!
  const noun = root.dataset.noun ?? 'group'
  const tagsHost = root.querySelector<HTMLElement>('[data-rail-tags]')!
  const opsHost = root.querySelector<HTMLElement>('[data-rail-ops]')!
  const filterInput = root.querySelector<HTMLInputElement>('[data-filter]')!
  const swaggerRoot = root.querySelector<HTMLElement>('#swagger-ui')!
  let system: SwaggerSystem | undefined

  fetch(specUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`${specUrl}: HTTP ${response.status}`)
      return response.json() as Promise<Spec>
    })
    .then((spec) => {
      const byTag = groupByTag(spec)
      const ui = Swagger({
        spec,
        dom_id: '#swagger-ui',
        presets: [Swagger.presets.apis],
        layout: 'BaseLayout',
        deepLinking: true,
        filter: true,
        // Read-only, and nothing leaves this site: no "Try it out", and no badge from the
        // public validator (validator.swagger.io) that Swagger UI shows by default.
        tryItOutEnabled: false,
        supportedSubmitMethods: [],
        validatorUrl: null,
        onComplete: () => {
          tintSections()
          applyTextFilter()
        },
      })
      system = ui.getSystem()
      renderTags(byTag)
      const hashTag = decodeURIComponent(/#tag\/([^/]+)/.exec(location.hash)?.[1] ?? '')
      if (hashTag && byTag.has(hashTag)) activate(hashTag, byTag)
      else renderOps(null, byTag)
    })
    .catch((error) => {
      tagsHost.innerHTML = '<div class="api-ref__empty">The spec failed to load.</div>'
      console.error('[api-reference]', error)
    })

  function groupByTag(spec: Spec) {
    const byTag = new Map<string, Operation[]>()
    for (const tag of spec.tags ?? []) byTag.set(tag.name, [])
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(item)) {
        if (!METHODS.includes(method)) continue
        for (const tag of op.tags?.length ? op.tags : ['default']) {
          if (!byTag.has(tag)) byTag.set(tag, [])
          byTag.get(tag)!.push({
            method,
            path,
            summary: op.summary || op.operationId || '',
            operationId: op.operationId || `${method}-${path}`,
          })
        }
      }
    }
    return byTag
  }

  function renderTags(byTag: Map<string, Operation[]>) {
    let total = 0
    for (const ops of byTag.values()) total += ops.length
    const all =
      '<button type="button" class="api-ref__tag" data-tag="" aria-current="true">' +
      '<span class="api-ref__tag-label">All operations</span>' +
      `<span class="api-ref__tag-count">${total}</span></button>`
    const rest = [...byTag]
      .map(([tag, ops]) => {
        const vertical = verticalFor(tag)
        const tile = `<span class="vtile${vertical ? ` vtile--${vertical}` : ''}" aria-hidden="true">${escapeHtml(tag.slice(0, 2))}</span>`
        return (
          `<button type="button" class="api-ref__tag" data-tag="${escapeHtml(tag)}">${tile}` +
          `<span class="api-ref__tag-label">${escapeHtml(tag)}</span>` +
          `<span class="api-ref__tag-count">${ops.length}</span></button>`
        )
      })
      .join('')
    tagsHost.innerHTML = all + rest
    tagsHost.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('.api-ref__tag')
      if (button) activate(button.dataset.tag ?? '', byTag)
    })
  }

  function renderOps(tag: string | null, byTag: Map<string, Operation[]>) {
    const ops = tag ? byTag.get(tag) : undefined
    if (!ops) {
      opsHost.innerHTML = `<div class="api-ref__empty">Pick a ${escapeHtml(noun)} to list operations.</div>`
      return
    }
    if (ops.length === 0) {
      opsHost.innerHTML = '<div class="api-ref__empty">No operations.</div>'
      return
    }
    opsHost.innerHTML = ops
      .slice(0, 80)
      .map((op) => {
        const anchor = `#/${encodeURIComponent(tag!)}/${encodeURIComponent(op.operationId)}`
        const method = op.method.toUpperCase()
        return (
          `<a class="api-ref__op" href="${escapeHtml(anchor)}" title="${escapeHtml(`${method} ${op.path}`)}">` +
          `<span class="api-ref__op-method api-ref__op-method--${op.method}">${method}</span>` +
          `<span class="api-ref__op-name">${escapeHtml(op.summary || op.operationId || op.path)}</span></a>`
        )
      })
      .join('')
  }

  function activate(tag: string, byTag: Map<string, Operation[]>) {
    for (const button of tagsHost.querySelectorAll<HTMLElement>('[data-tag]')) {
      if (button.dataset.tag === tag) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    }
    renderOps(tag || null, byTag)
    system?.layoutActions.updateFilter(tag)
    applyTextFilter()
  }

  // Swagger UI's filter matches tag names only; this narrows the visible operations by path,
  // summary or method too.
  function applyTextFilter() {
    const query = filterInput.value.trim().toLowerCase()
    for (const section of swaggerRoot.querySelectorAll<HTMLElement>('.opblock-tag-section')) {
      if (section.offsetParent === null) continue
      for (const block of section.querySelectorAll<HTMLElement>('.opblock')) {
        const text = ['.opblock-summary-path', '.opblock-summary-description', '.opblock-summary-method']
          .map((selector) => block.querySelector(selector)?.textContent ?? '')
          .join(' ')
          .toLowerCase()
        block.hidden = query !== '' && !text.includes(query)
      }
    }
  }

  // Marks each tag section with its vertical, so the theme tints its header and the
  // operations' accent stripe. Swagger UI re-renders sections as filters change, so this runs
  // again on every change.
  function tintSections() {
    for (const section of swaggerRoot.querySelectorAll<HTMLElement>('.opblock-tag-section')) {
      const tagEl = section.querySelector('.opblock-tag')
      const vertical = verticalFor((tagEl?.getAttribute('data-tag') ?? tagEl?.textContent ?? '').trim())
      if (vertical) section.setAttribute('data-vertical', vertical)
      else section.removeAttribute('data-vertical')
    }
  }

  filterInput.addEventListener('input', applyTextFilter)
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      tintSections()
      applyTextFilter()
    })
  }).observe(swaggerRoot, { childList: true, subtree: true })
}
