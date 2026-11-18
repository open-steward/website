#!/usr/bin/env node
// Serves out/ the way CloudFront will: every request runs the real viewer-request function,
// every successful response the real viewer-response function (so the security headers and
// the Content-Security-Policy are the production ones), files get the deploy's Content-Type
// and Cache-Control, and a missing file gets the shared 404 page with only the managed
// policy's headers, as CloudFront does for origin errors.
//
// Two ports stand in for the two names, so it works from a phone on the same network:
//   PORT       (default 4321)  opensteward.dev
//   PORT + 1   (default 4322)  docs.opensteward.dev
//
//   node scripts/preview.mjs            then open http://<this machine's LAN address>:4321/

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join, normalize } from 'node:path'
import { cacheControlFor, contentTypeFor } from './lib/headers.mjs'
import { toCloudFrontQuery, viewerRequest, viewerResponse } from './lib/cloudfront.mjs'

const out = join(import.meta.dirname, '..', 'out')

// AWS's managed SecurityHeadersPolicy, which the distribution uses: CloudFront adds these to
// every response (the 404 page too) before the viewer-response function runs.
const MANAGED_SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-xss-protection': '1; mode=block',
}
const managed = () => Object.fromEntries(Object.entries(MANAGED_SECURITY_HEADERS).map(([k, v]) => [k, { value: v }]))
const base = Number(process.env.PORT ?? 4321)
const HOSTS = [
  { port: base, host: 'opensteward.dev' },
  { port: base + 1, host: 'docs.opensteward.dev' },
]

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

/** In the preview, links between the two sites point at the other port instead. */
function localise(location, req) {
  const here = (req.headers.host ?? 'localhost').replace(/:\d+$/, '')
  return location
    .replace(/^https:\/\/opensteward\.dev(?=\/|$)/, `http://${here}:${base}`)
    .replace(/^https:\/\/docs\.opensteward\.dev(?=\/|$)/, `http://${here}:${base + 1}`)
}

function send(res, status, headers, file) {
  res.writeHead(status, headers)
  if (file && res.req.method !== 'HEAD') createReadStream(file).pipe(res)
  else res.end()
}

function handle(host, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD' })
  const url = new URL(req.url ?? '/', 'http://preview')
  const request = {
    method: req.method,
    uri: url.pathname,
    querystring: toCloudFrontQuery(url.searchParams),
    headers: { host: { value: host } },
  }
  const result = viewerRequest({ version: '1.0', context: { eventType: 'viewer-request' }, request })

  if ('statusCode' in result) {
    const headers = Object.fromEntries(Object.entries(result.headers).map(([k, v]) => [k, v.value]))
    if (headers.location) headers.location = localise(headers.location, req)
    return send(res, result.statusCode, headers)
  }

  const key = normalize(decodeURIComponent(result.uri)).replace(/^\/+/, '')
  const file = join(out, key)
  if (!file.startsWith(out) || !existsSync(file) || !statSync(file).isFile()) {
    // CloudFront: the error response serves /404.html with a 404, and skips viewer-response.
    return send(
      res,
      404,
      { ...MANAGED_SECURITY_HEADERS, 'content-type': contentTypeFor('404.html'), 'cache-control': cacheControlFor('404.html') },
      join(out, '404.html'),
    )
  }

  const response = {
    statusCode: 200,
    headers: {
      ...managed(),
      'content-type': { value: contentTypeFor(key) },
      'cache-control': { value: cacheControlFor(key) },
      'content-length': { value: String(statSync(file).size) },
    },
  }
  const final = viewerResponse({ version: '1.0', context: { eventType: 'viewer-response' }, request, response })
  send(res, final.statusCode, Object.fromEntries(Object.entries(final.headers).map(([k, v]) => [k, v.value])), file)
}

if (!existsSync(join(out, '404.html'))) {
  console.error('out/ is empty: run `pnpm build` first')
  process.exit(1)
}
for (const { port, host } of HOSTS) {
  createServer((req, res) => {
    try {
      handle(host, req, res)
    } catch (error) {
      console.error(error)
      send(res, 500, { 'content-type': 'text/plain' })
    }
  }).listen(port, '0.0.0.0', () => {
    const urls = ['localhost', ...lanAddresses()].map((a) => `http://${a}:${port}/`).join('  ')
    console.log(`${host.padEnd(22)} ${urls}`)
  })
}
