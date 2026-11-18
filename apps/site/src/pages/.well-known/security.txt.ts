// RFC 9116 security.txt. Expires is a year after the build, and every deploy rebuilds it.
import type { APIRoute } from 'astro'

export const GET: APIRoute = () => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  expires.setUTCHours(0, 0, 0, 0)
  const body = [
    'Contact: https://github.com/open-steward/opensteward/security/advisories/new',
    'Contact: mailto:support@opensteward.dev',
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en, sv',
    'Canonical: https://opensteward.dev/.well-known/security.txt',
    'Policy: https://github.com/open-steward/opensteward/blob/main/SECURITY.md',
    '',
  ].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
