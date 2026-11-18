// Loads the two CloudFront Functions from infra/functions/ the way the runtime does (one script
// defining a global `handler`), for the local preview and the browser check.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const functions = join(dirname(fileURLToPath(import.meta.url)), '../../infra/functions')

function load(name) {
  const context = {}
  runInNewContext(readFileSync(join(functions, `${name}.js`), 'utf8'), context)
  return context.handler
}

export const viewerRequest = load('viewer-request')
export const viewerResponse = load('viewer-response')

/** A CloudFront Functions query string object from a URLSearchParams. */
export function toCloudFrontQuery(params) {
  const query = {}
  for (const [key, value] of params) {
    const entry = { value }
    if (query[key] === undefined) query[key] = entry
    else {
      query[key].multiValue ??= [{ value: query[key].value }]
      query[key].multiValue.push(entry)
    }
  }
  return query
}
