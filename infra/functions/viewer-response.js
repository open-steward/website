// CloudFront Function, viewer response (runtime cloudfront-js-2.0): the security
// headers. The Free flat-rate plan allows no custom response-header policies,
// so they are set here.
//
// The Content-Security-Policy allows no inline script or style at all: the
// build keeps every script and stylesheet in its own file, and
// scripts/check-built-html.mjs fails CI if a page ever carries inline code.
// That way the policy needs no hashes and never changes with the content.
//
// Per host:
//   - the docs add 'wasm-unsafe-eval': Pagefind, the docs search, runs
//     WebAssembly;
//   - SVG files get their own policy: the diagrams carry their styles inside
//     the file, and an SVG must never run script;
//   - the docs' Platforms page (/platforms/) may also load images from
//     Brandfetch: the platform logos, hotlinked as Brandfetch requires.
//
// CloudFront does not run this function when the origin answers 400 or more (the 404 page),
// or on the redirects the viewer-request function returns. The distribution's managed
// SecurityHeadersPolicy, which CloudFront applies before this function, covers the 404 page
// with HSTS, nosniff and X-Frame-Options; the page carries its CSP in a <meta> tag.

var DOCS = 'docs.opensteward.dev';

var OTHER_DIRECTIVES =
  "font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";
var PAGE_DIRECTIVES = "default-src 'none'; style-src 'self'; img-src 'self' data:; " + OTHER_DIRECTIVES;
var SITE_CSP = "script-src 'self'; " + PAGE_DIRECTIVES;
var DOCS_CSP = "script-src 'self' 'wasm-unsafe-eval'; " + PAGE_DIRECTIVES;
var PLATFORMS_CSP =
  "script-src 'self' 'wasm-unsafe-eval'; default-src 'none'; style-src 'self'; " +
  "img-src 'self' data: https://cdn.brandfetch.io; " + OTHER_DIRECTIVES;
var SVG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
  "frame-ancestors 'none'";

var HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-site',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
};

function handler(event) {
  var response = event.response;
  var headers = response.headers;

  for (var name in HEADERS) {
    headers[name] = { value: HEADERS[name] };
  }
  // Added by AWS's managed security headers policy; obsolete, and the CSP does its job.
  delete headers['x-xss-protection'];
  headers['content-security-policy'] = { value: policyFor(event.request, headers) };
  return response;
}

function policyFor(request, headers) {
  var type = headers['content-type'] ? headers['content-type'].value.toLowerCase() : '';
  if (type.indexOf('image/svg+xml') === 0) return SVG_CSP;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (host !== DOCS && host.indexOf(DOCS + ':') !== 0) return SITE_CSP;
  // The uri as the viewer sent it (/<path>) or as the viewer-request function rewrote it
  // (/docs/<path>): match both, so the page keeps its logos whichever one CloudFront passes.
  var uri = request.uri;
  return uri.indexOf('/platforms/') === 0 || uri.indexOf('/docs/platforms/') === 0 ? PLATFORMS_CSP : DOCS_CSP;
}
