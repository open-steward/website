// The "API specs and Postman" page, docs-server's /postman: the specs and collections for
// download. The two Swagger UI pages are src/pages/unified-api and src/pages/operator-api.

const FILES = [
  ['openapi/openapi.yaml', 'Unified API: OpenAPI 3.1, YAML'],
  ['openapi/openapi.json', 'Unified API: OpenAPI 3.1, JSON'],
  ['openapi/admin-api.openapi.json', 'Operator (admin) API: OpenAPI, JSON'],
  ['postman/openapi.postman_collection.json', 'Unified API: Postman collection'],
  ['postman/openapi-local.postman_environment.json', 'Unified API: local environment'],
  ['postman/openapi-production.postman_environment.json', 'Unified API: production environment'],
  ['postman/openapi-test.postman_environment.json', 'Unified API: sandbox (/test/v1) environment'],
  ['postman/admin-api.postman_collection.json', 'Operator API: Postman collection'],
  ['postman/admin-api-local.postman_environment.json', 'Operator API: local environment'],
]

export function postmanPage({ exists }) {
  const present = FILES.filter(([path]) => exists(`docs/${path}`) === 'file')
  const rows = present.map(([path, label]) => `| ${label} | [\`${path.split('/').pop()}\`](/downloads/${path}) |`)
  const body = `The OpenAPI specs and Postman collections are generated from the code, so they always
match the version of OpenSteward these docs describe. Import them into Postman, Insomnia or any
OpenAPI tool. Browse them here in the [Unified API](/unified-api/) and
[Operator API](/operator-api/) references.

| File | Download |
|---|---|
${rows.join('\n')}
`
  return {
    contentPath: 'postman.md',
    front: { title: 'API specs and Postman', description: 'Download the OpenAPI specs and Postman collections for the unified API and the operator API.' },
    body,
    downloads: present.map(([path]) => ({ from: `docs/${path}`, to: path, kind: 'download' })),
    links: present.map(([path, label]) => ({ label, href: `/downloads/${path}` })),
  }
}
