// CloudFront Function, viewer request (runtime cloudfront-js-2.0).
//
// One distribution serves three names from one bucket:
//
//   opensteward.dev       -> s3://<bucket>/site/...   (the marketing site)
//   docs.opensteward.dev  -> s3://<bucket>/docs/...   (the Starlight docs)
//   www.opensteward.dev   -> 301 to https://opensteward.dev/<same path and query>
//
// Any other host (the distribution's own <id>.cloudfront.net name) is served as
// the marketing site, so the site can be checked before the DNS switch.
//
// Every install prints https://opensteward.dev/license, and that URL must
// answer with a 301 to the license service, which lists the plans.
//
// /_astro/ holds the content-hashed assets of both builds in one shared prefix,
// so the error page (fetched from the bucket root, without this function) can
// load its stylesheet on either host.
//
// Directory paths serve their index.html. A path whose last segment has no dot
// and no trailing slash gets a 301 to the same path with the slash, the form
// every page links to.
//
// CloudFront does not run the viewer-response function on responses this
// function generates, so the redirects carry HSTS themselves.

var APEX = 'opensteward.dev';
var WWW = 'www.opensteward.dev';
var DOCS = 'docs.opensteward.dev';
var LICENSE_URL = 'https://license.opensteward.dev/';
var HSTS = 'max-age=63072000; includeSubDomains; preload';

function handler(event) {
  var request = event.request;
  var host = hostOf(request);
  var uri = request.uri;

  if (host === WWW) {
    return redirect('https://' + APEX + uri + queryString(request.querystring));
  }
  var lower = uri.toLowerCase();
  if (host !== DOCS && (lower === '/license' || lower === '/license/')) {
    return redirect(LICENSE_URL);
  }
  if (uri.indexOf('/_astro/') === 0) {
    return request;
  }

  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last === '') {
    uri += 'index.html';
  } else if (last.indexOf('.') === -1) {
    // Absolute, on the host that was asked: a relative Location such as //evil.example/x/
    // or /\evil.example/x/ would send the browser to another site.
    return redirect('https://' + (host || APEX) + uri + '/' + queryString(request.querystring));
  }

  request.uri = (host === DOCS ? '/docs' : '/site') + uri;
  return request;
}

function hostOf(request) {
  var header = request.headers.host;
  if (!header) return '';
  var value = header.value.toLowerCase();
  var colon = value.indexOf(':');
  return colon === -1 ? value : value.substring(0, colon);
}

// Rebuilds the query string as the viewer sent it: CloudFront passes the
// values through without decoding them.
function queryString(querystring) {
  var parts = [];
  for (var key in querystring) {
    var entry = querystring[key];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      parts.push(key + '=' + values[i].value);
    }
  }
  return parts.length === 0 ? '' : '?' + parts.join('&');
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location },
      'strict-transport-security': { value: HSTS },
      'cache-control': { value: 'public, max-age=3600' },
    },
  };
}
