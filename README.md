# opensteward.dev

The OpenSteward website and documentation, and the AWS stack that serves them:

| Name | What | Built from |
|---|---|---|
| `opensteward.dev` | The marketing site | `apps/site` (Astro) |
| `docs.opensteward.dev` | The product documentation | `apps/docs` (Starlight), from the product repository's `docs/` |
| `www.opensteward.dev` | 301 to `https://opensteward.dev/<same path>` | the CloudFront function |
| `opensteward.dev/license` | 301 to `https://license.opensteward.dev/` (every install prints this URL) | the CloudFront function |

Both sites are static: no backend, no forms, no cookies and no analytics. Every script and font,
Swagger UI's included, is served from these two hosts; the one thing loaded from another site is
the platform logos on the docs' Platforms page, from Brandfetch (see the Content-Security-Policy
below). They
use the product's design system (`packages/design-system` in
[open-steward/opensteward](https://github.com/open-steward/opensteward)).

## How it fits together

```
GitHub Actions (main)  --OIDC-->  deploy role  --PutObject/DeleteObject-->  S3 bucket (private)
                                               --CreateInvalidation------>  CloudFront
viewer --HTTPS--> CloudFront (WAF web ACL, ACM certificate for the 3 names)
                    viewer-request function: host routing, /license and www redirects, index.html
                    origin: the bucket, read through origin access control (OAC)
                    viewer-response function: HSTS, CSP, nosniff, no framing, referrer policy
```

One bucket holds both sites. The viewer-request function maps each host to its prefix:

```
site/...      opensteward.dev (and the distribution's own <id>.cloudfront.net name)
docs/...      docs.opensteward.dev
_astro/...    both builds' content-hashed CSS, JS, fonts and images, shared by both hosts
404.html      the error page for both hosts (CloudFront fetches it from the bucket root)
```

### Pieces

- `infra/`: the CDK app, one stack (`OpenSteward-Website`) in us-east-1, with its tests.
  - `infra/functions/viewer-request.js`, `viewer-response.js`: the two CloudFront Functions.
- `apps/site/`: opensteward.dev. Platform counts and the list of verified adapters are read
  from the pinned product docs at build time, so the site never disagrees with the docs.
  `/commercial-licensing/` is the product's `COMMERCIAL-LICENSE.md` at the pin
  (`apps/site/src/lib/commercial-license.mjs`). Its "Questions that settle the rest" become a
  decision tree (`apps/site/src/scripts/decision-tree.ts`), and readers without JavaScript keep
  the numbered list. When the product changes those questions in a way the parser cannot read,
  the build stops and names the question.
- `apps/docs/`: docs.opensteward.dev. `apps/docs/scripts/sync.mjs` turns the product's Markdown
  into Starlight pages: titles, link rewriting (pages, images, downloads, and GitHub at the pinned
  commit for files outside `docs/`), and Mermaid diagrams rendered to SVG at build time.
  `apps/docs/src/pages/unified-api/` and `operator-api/` are the two Swagger UI pages
  (`apps/docs/src/components/ApiReference.astro`), as on the product's docs-server.
  `apps/docs/src/pages/platforms/` is the product's platform catalogue, also as on docs-server:
  `apps/docs/scripts/platforms.mjs` runs `packages/platforms-ui` from the pinned commit and writes
  its styles and script into `src/generated/platforms/` for the page to import. Logos are
  hotlinked from Brandfetch when `BRANDFETCH_CLIENT_ID` is set, and are initials otherwise. Under
  the cards are the platform table's Verification section and every platform as a plain list, for
  the docs search and for readers without JavaScript. The table itself is the page's Markdown
  copy, `/platforms.md`.
- `product.json`: the product commit the docs and the design system come from.
  `scripts/fetch-product.mjs` fetches exactly that commit into `.product/` (git-ignored), then
  applies `product-patches/*.patch` (see "Newer docs").
- `scripts/`: assemble the bucket layout (`assemble.mjs`), check the build
  (`check-built-html.mjs`, `browser-check.mjs`), preview it locally through the real CloudFront
  Functions (`preview.mjs`), and deploy it (`deploy.mjs`).
- `.github/workflows/site.yml`: build and check on every pull request and push; deploy on main.
- `.github/workflows/product-sync.yml` and `scripts/product-sync.mjs`: every hour, a pull request
  that moves `product.json` to the product's newest commit, merged once its checks pass (see
  "Staying in sync with the product").

### The Content-Security-Policy

The policy allows no inline script or style at all (`script-src 'self'; style-src 'self'`, plus
`'wasm-unsafe-eval'` on the docs for the Pagefind search), so it needs no hashes and never changes
with the content. To make the built pages satisfy it:

- Astro writes every stylesheet and script to a file (`inlineStylesheets: 'never'`,
  `assetsInlineLimit: 0`).
- The Starlight components that inline a script or a `style` attribute (ThemeProvider,
  ThemeSelect, Search, the sidebar state persister) are replaced in `apps/docs/src/components/`
  by versions that do the same from files.
- Expressive Code (the docs' code blocks) writes each token's colours as a `style` attribute;
  `assemble.mjs` moves those into one content-hashed stylesheet (`scripts/lib/externalize-styles.mjs`).
- Mermaid diagrams are SVG images, not inline SVG: their styles stay inside the image, and the
  viewer-response function gives SVG files a policy of their own that allows those styles and no
  script.
- Swagger UI is the `swagger-ui-dist` package's bundle, served from `_astro/` like Astro's own
  scripts, so `script-src 'self'` covers it. It is read-only: "Try it out" is off (there is no API
  to call here, and `connect-src 'self'` would block it), and so is the badge Swagger UI would
  otherwise load from `validator.swagger.io`. `swagger-ui-dist` depends on Scarf, an install-time
  telemetry package; `pnpm-workspace.yaml` keeps its install script from running.
- One exception, on one page: on the docs' Platforms page (`/platforms/`), `img-src` also allows
  `https://cdn.brandfetch.io`, for the platform logos. Each logo `<img>` sets
  `referrerpolicy="strict-origin-when-cross-origin"`, because Brandfetch needs to see the
  origin. That overrides the site's `no-referrer` for those requests only, and Brandfetch sees
  `https://docs.opensteward.dev/`, never the path. The browser check stubs Brandfetch, so CI never
  calls it.
- `scripts/check-built-html.mjs` fails the build on any inline script, `<style>`, `style=""`,
  `on*=""`, `javascript:` URL or resource from another origin, on a missing image or file on
  either site, and on a broken link or anchor on the marketing site (its links into the docs
  included). A broken link or anchor on a docs page is a warning, since the product's docs may have one this site cannot fix; on the product sync's
  branch, which merges by itself, it fails the check (`DOCS_STRICT=1`), as do a diagram Mermaid
  cannot parse and an API spec link to no page here. `scripts/browser-check.mjs` then loads the pages in Chromium and WebKit
  through the production functions and fails on any CSP violation, console error, failed request
  or image that does not render, or request to another origin, and checks the theme toggle, the
  docs search, both Swagger UI pages, the Platforms catalogue (with Brandfetch stubbed) and the
  commercial licensing decision tree.

CloudFront does not run the viewer-response function on error responses. For the 404 page, the
distribution also has AWS's managed `SecurityHeadersPolicy` (allowed on the Free plan, unlike a
custom one), which adds HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN` and a referrer policy to
every response; on other responses the viewer-response function, which runs after it, replaces
those with the stricter values above. The 404 page carries the site's CSP in a `<meta>` tag, read
from `viewer-response.js` at build time.

### Caching (the Free plan allows only AWS's managed cache policies)

The distribution uses the managed `CachingOptimized` policy, which honours each object's own
`Cache-Control`, set at upload by `scripts/lib/headers.mjs`:

| Objects | Cache-Control |
|---|---|
| `_astro/*`, `docs/diagrams/*` (content-hashed) | `public, max-age=31536000, immutable` |
| pages and their `.md` copies, `llms.txt`, sitemap, robots.txt, security.txt, `docs/pagefind/*` | `public, max-age=300` |
| everything else (icons, screenshots, downloads) | `public, max-age=3600` |

Every deploy invalidates `/*`, so the edge serves new pages at once. Files a page loads later
(hashed assets, diagrams, the search index) stay in the bucket for 7 days after the deploy that
dropped them, for pages still open or cached; `deploy.mjs` records that date as an empty marker
object under `_deploy/stale/`, which neither host serves.

### For AI agents

Both hosts follow [llms.txt](https://llmstxt.org): `/llms.txt` says what is there, and every page
has a Markdown copy at its URL without the trailing slash plus `.md` (`/dev-api/` is
`/dev-api.md`, the home page `/index.md`), linked from the page's `<head>` with
`rel="alternate" type="text/markdown"`. `docs.opensteward.dev/llms-full.txt` is all of the docs in
one file. The two Swagger UI pages have no copy: for them, agents read the OpenAPI specs, which the
docs' `llms.txt` lists.

- Docs: `apps/docs/scripts/sync.mjs` writes the copies from the product's Markdown, with absolute
  links and the Mermaid diagrams as Mermaid source; the index follows the sidebar
  (`apps/docs/scripts/sections.mjs` defines both).
- Site: `assemble.mjs` converts each built page's `<main>` (`scripts/lib/html-to-markdown.mjs`),
  so the copy says what the page says; `apps/site/src/pages/llms.txt.ts` is the index.
- `check-built-html.mjs` fails on any `llms.txt` link or `alternate` link that does not resolve.

## Working on it

Node 24 and pnpm (the version in `package.json`, for example through `corepack enable`).

```sh
pnpm install
pnpm exec playwright install chromium webkit
pnpm build
pnpm preview
```

For platform logos in a local build, put the Brandfetch client ID in `.env` at the repository root.
The file is git-ignored, and the build never prints the ID. Without it, the Platforms page shows
initials.

```sh
echo "BRANDFETCH_CLIENT_ID=<client ID>" >> .env
```

`pnpm build` fetches the pinned product commit, builds both sites and assembles `out/`.
`pnpm preview` serves `out/` through the real CloudFront Functions and headers on two ports,
`4321` (opensteward.dev) and `4322` (docs.opensteward.dev), on every network interface, so a phone
on the same network can open them (macOS may ask whether to accept incoming connections for node).

Checks, as CI runs them (the type check reads the types `pnpm build` generates, so build first):

```sh
pnpm test
pnpm build
pnpm typecheck
pnpm check:html
pnpm test:browser
```

For live reloading while editing one site: `pnpm --filter @opensteward-website/site dev`
(the docs: `pnpm --filter @opensteward-website/docs dev`).

### Newer docs

The product sync moves the pin by itself (next section). To move it by hand, set `commit` in
`product.json` to the product commit to publish, in a pull request. The commit must be on the
product's `main`, and the fetch stops otherwise: GitHub also serves unmerged pull request commits
by ID. To try a product change before it merges, build it locally with
`PRODUCT_ALLOW_UNMERGED=1 pnpm build`. The build prints any Mermaid
diagram it could not render (it shows those as source) and the links it left as written, and in CI
puts both in the job summary; `pnpm check:html` lists links that do not resolve. A docs page in no sidebar section stops the
build: give it a place in `apps/docs/scripts/sections.mjs` (`TOP` for a page, `GROUPS` for a
directory).

`apps/docs/scripts/local-edits.mjs` holds the few sentences this site words differently from the
product, such as the Developer Guide's pointer to the Unified API, which links to this site's page
rather than to docs-server on localhost. When the product rewrites one of those sentences, the
build stops and names it: redo the edit against the new text, or drop it.

Diagrams use the design system's colours in each theme; a diagram's own `init` directive cannot
change them. Where the product colours a node itself (`classDef` or `style`) with a fill and no
text colour, the build adds the theme text colour that reads best on that fill. It then measures
every label against what is painted behind it, and a label below 4.5:1 (WCAG AA) stops the
build, naming the diagram, the label and both colours. A colour the product's diagram sets badly
is fixed in the product; the rest is `apps/docs/scripts/mermaid.mjs`.

`product-patches/` (absent when there are none, as today) holds fixes to the product's files that
this site applies on top of the pinned commit until the product carries them. Each file applies to the product repository with `git apply`. Once the product carries a patch,
the fetch reports it and the product sync deletes it in its pull request. A patch that neither
applies nor is already there stops the fetch: redo it against the new commit.

The product's generated one-page reference (`docs/api-reference/api-reference.md`) is not
published: the Swagger UI page `/unified-api/` replaces it, and links to it go there
(`apps/docs/scripts/paths.mjs`). Agents read the OpenAPI specs, which `llms.txt` lists.

The specs and Postman collections link their descriptions to docs-server's routes
(`/guides/dev-api.md#3-scopes`), which work only on docs-server. The copies this site publishes
point those links at this site's pages, as full URLs, and change nothing else
(`apps/docs/scripts/spec-links.mjs`).

## Staying in sync with the product

```
every hour, from main: product-sync.yml runs scripts/product-sync.mjs, which takes one step
  product main = product.json's pin, or nothing the site reads changed   -> nothing to do
  no sync PR yet, or the product or main moved since                      -> build the branch
      product-sync: one commit on main moving the pin (minus the patches the product now
      carries); open or update the PR "Sync docs to opensteward@<sha>"; start site.yml on it
  site.yml's "Build and check" passed, only the product's text changed    -> merge
      check the branch again (one commit on main, only the pin and patch deletions), merge it
      with a merge commit, start site.yml on main: Build and check, then Deploy
  it passed, but product code or styles the build uses changed            -> ask for a review, once
  it failed, or the PR has been open a day                                -> say so on the PR, once
```

"Nothing the site reads" means no change under `product.json`'s `paths`: a dependency bump in the
product opens no PR and deploys nothing. The PR lists the product commits and the changed docs
files. A product change is live within one to two hours: one run opens the PR, the next merges
it. `scripts/product-sync.mjs --dry-run` prints what a run would do without doing it.

**No stored credential.** The sync job uses its own `GITHUB_TOKEN`, which GitHub creates for the
job and revokes when it ends: there is no key, App or personal token to leak. The job runs only on
`main`, only code from `main`, and installs nothing. Its token may write contents (the branch and
the merge, which the "Protect main" ruleset still governs), pull requests and workflow runs (to
start `site.yml`). What that token does starts no workflow (GitHub's rule), which is why the
script starts `site.yml` itself; the deploy role still trusts only `main`. The product repository
holds nothing and is read anonymously.

**Guards, because the sync merges with no one reading it:**

- Just before merging, the script checks the branch again: one commit on main, changing nothing
  but `product.json`'s `commit` (to the product's main) and deleting patches under
  `product-patches/`. Anything else, from a bug or from someone pushing to the branch, is not
  merged. It merges only the commit the checks passed on.
- "Build and check" checks a sync like any other change: the pin must be on the product's
  `main`, then the CSP, the built-HTML check, the browser check, and the sidebar check above.
- When the check fails, the run comments once and assigns `SYNC_ASSIGNEE`, so GitHub emails you,
  and that run fails. Fix it on main: the next run rebuilds the branch on top of the fix. To skip
  a product commit instead, close its PR; the next product commit opens a new one. A PR open for
  more than a day gets one comment too.

**Only the product's text merges by itself.** A sync merges unattended when the product changed
nothing the site reads but `docs/`, `README.md` and `COMMERCIAL-LICENSE.md`. When it also changes
code the build runs or styles it uses (`packages/platforms-ui`, `packages/design-system`,
`tsconfig.base.json`), or the changes cannot be listed, it is built and checked as usual, then
comments once and assigns `SYNC_ASSIGNEE`: read it and merge it yourself, with a merge commit, or
close it to skip that product commit.

**What the guards cannot check: the pin is the payload.** Text that reaches the product's `main`
is published on both hosts within one to two hours. So anyone who can merge to
`open-steward/opensteward` main can publish text here, and the protection on that branch protects
this site too. The deploy role keeps the reach to this site's bucket and distribution.

**To pause it:** `gh variable set PRODUCT_SYNC --repo open-steward/website --body off` (and `on`
to resume). GitHub also pauses scheduled workflows in a public repository after 60 days without a
commit; every sync merge counts. After a quiet stretch, the Actions tab shows "Enable workflow".

**Cost:** nothing on GitHub (Actions minutes are free in a public repository; a run takes well
under a minute, the branch's "Build and check" about as long as on any PR). On AWS, a sync that
changes the docs costs one deploy: about 720 PUT requests and one invalidation path, under half a
cent.

### Turning it on (once the product repository is public and main is deployed)

The sync's token can open pull requests only if the repository allows it. "Approve" in the
setting's name changes nothing here, since main needs no approvals; workflows run for pull
requests from forks still get a read-only token.

```sh
gh api -X PUT repos/open-steward/website/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
gh variable set SYNC_ASSIGNEE --repo open-steward/website --body "$(gh api user --jq .login)"
gh variable set PRODUCT_SYNC --repo open-steward/website --body on
gh workflow run product-sync.yml --repo open-steward/website --ref main
gh run watch --repo open-steward/website
```

If the pin is already the product's main, the run says so and stops. Otherwise it opens the PR
and starts "Build and check" on it; the next hourly run merges it (or run the workflow again once
the check has passed), and the deploy follows.

## Deploying

The commands, in order, for an administrator of the site's AWS account. Each `cdk` command runs
in `infra/`.

### 1. Sign in

Every command below uses the AWS CLI profile in `AWS_PROFILE`, so set it to your SSO profile for
the site's account first.

```sh
export AWS_PROFILE="<your profile>"
aws sso login
```

### 2. Check for an existing GitHub OIDC provider

```sh
aws iam list-open-id-connect-providers
```

An account can hold only one provider for `token.actions.githubusercontent.com`. If the list shows
one, add `-c githubOidcProviderArn=<its ARN>` to every `cdk` command below; otherwise the stack
creates it.

### 3. Bootstrap CDK in us-east-1 (once)

```sh
cd infra
pnpm exec cdk bootstrap
```

The app pins the stack to us-east-1, and the account comes from the profile, so this bootstraps
`aws://<account>/us-east-1`. Cost: a staging S3 bucket and an ECR repository, cents a month at
most. Security: the bootstrap's CloudFormation execution role has AdministratorAccess in the
account, as in every CDK bootstrap; only the account's administrators can use it.

### 4. Review and deploy the stack

```sh
pnpm exec cdk diff
pnpm exec cdk deploy
```

The diff should list one stack, `OpenSteward-Website`, with: the bucket and its policy, the
certificate, the WAF web ACL, the two CloudFront Functions, the origin access control, the
distribution, the deploy role, and the GitHub OIDC provider (unless you passed its ARN). There are
no Lambda functions or custom resources. `cdk deploy` asks you to approve the IAM changes.

**While it waits on the certificate**, add ACM's three validation CNAMEs at GoDaddy (one each for
`opensteward.dev`, `www.opensteward.dev` and `docs.opensteward.dev`). Find them in the ACM console
(region **us-east-1**: Certificates, `opensteward.dev`, Domains), or:

```sh
aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='opensteward.dev'].CertificateArn"
aws acm describe-certificate --region us-east-1 --certificate-arn <arn from the line above> --query "Certificate.DomainValidationOptions[].ResourceRecord"
```

The CloudFormation stack events also show each record ("Content of DNS Record is: ..."). At
GoDaddy, the CNAME's name is the part before `.opensteward.dev.` (for example `_3a1b…`), and its
value is the full `_….acm-validations.aws.` name. Validation takes a few minutes once the records
resolve; the deploy then creates the distribution (another few minutes). Add the same three records
to the Route 53 zone before the nameserver switch, so renewals keep working.

The stack has termination protection on, and the bucket is retained if the stack is ever deleted.

Cost: $0 a month once the distribution is on the Free plan (step 7), which covers CloudFront, the
functions, the WAF web ACL and its rules. Until then the web ACL is billed pay-as-you-go, about
$8 a month ($5 for the web ACL, $1 per rule) prorated by the hour, so about a cent per hour: do
step 7 as soon as the deploy finishes. The certificate is free; S3 storage for about 40 MB is a
fraction of a cent.

### 5. Set the repository variables

The stack prints its outputs; or read them again:

```sh
aws cloudformation describe-stacks --stack-name OpenSteward-Website --region us-east-1 --query "Stacks[0].Outputs"
```

Then set three variables (variables, not secrets: none of them is a credential):

```sh
gh variable set DEPLOY_ROLE_ARN --repo open-steward/website --body "<DeployRoleArn>"
gh variable set BUCKET_NAME --repo open-steward/website --body "<BucketName>"
gh variable set DISTRIBUTION_ID --repo open-steward/website --body "<DistributionId>"
```

The build also reads `BRANDFETCH_CLIENT_ID` (already set), for the Platforms page's logos. It is
not a secret, since it appears in every logo URL, but it belongs to OpenSteward's Brandfetch account.
To change it:

```sh
gh variable set BRANDFETCH_CLIENT_ID --repo open-steward/website --body "<client ID>"
```

### 6. Run the workflow

The deploy job runs on pushes to main once `DEPLOY_ROLE_ARN` is set. After the first merge, or to
deploy again without a change:

```sh
gh workflow run site.yml --repo open-steward/website --ref main
```

Security: the role trusts only tokens whose subject is
`repo:open-steward@285678617/website@1458238817:ref:refs/heads/main` (the repository's immutable
subject; `gh api repos/open-steward/website/actions/oidc/customization/sub` shows it), with
audience `sts.amazonaws.com`. Pull requests, other branches, forks and jobs that name an
environment present other subjects and cannot assume it. The role may list the bucket (for
deleting what a build no longer has), put and delete objects in it, and create invalidations on
this distribution; nothing else. The deploy job installs without install scripts and gets its
credentials only after that. Cost per deploy: about 720 PUT requests and one invalidation path,
well under a cent.

The trust binds the repository and `main`, not a particular workflow file: any workflow on main
that asks for `id-token: write` could assume the role. `main` is protected by the repository
ruleset "Protect main" (`gh api repos/open-steward/website/rulesets`): changes only through a pull
request, merged with a merge commit, after the "Build and check" job passes; no force pushes, no
deletion, and no one, admins included, bypasses it. So no workflow reaches main without a merged
pull request. To narrow it further, add `job_workflow_ref` to the repository's OIDC subject
template (`gh api -X PUT repos/open-steward/website/actions/oidc/customization/sub`), which changes
the subject, so the role's trust condition in `infra/lib/config.ts` must change with it.

### 7. Subscribe the distribution to the Free plan

Right after the deploy, in the CloudFront console: Distributions, the distribution, then choose
the **Free** pricing plan. Every flat-rate plan requires a WAF web ACL to stay attached, so the
web ACL is not optional even though the site is static; on the plan it costs nothing. The stack
already attached the one the plan requires, with 3 of the 5 rules the Free plan
allows (AWS's IP reputation list, AWS's common rule set, and a rate limit of 2,000 requests per IP
per 5 minutes; change it with `-c rateLimit=<n>`). Keep that web ACL: the stack declares it, so a
later deploy keeps it attached. If the console offers to create a different one, decline. A
request the web ACL blocks gets the 404 page with status 404, because CloudFront serves that page
for every 403. The Free plan has no custom WAF responses (they start with Pro), so a visitor over
the rate limit cannot be told "too many requests" instead.

### 8. Check, before the nameserver switch

```sh
curl -sSI https://<id>.cloudfront.net/license
curl -sSI --resolve "opensteward.dev:443:$(dig +short <id>.cloudfront.net | head -1)" https://opensteward.dev/
curl -sSI --resolve "docs.opensteward.dev:443:$(dig +short <id>.cloudfront.net | head -1)" https://docs.opensteward.dev/
curl -sSI --resolve "docs.opensteward.dev:443:$(dig +short <id>.cloudfront.net | head -1)" https://docs.opensteward.dev/platforms/ | grep -i '^content-security-policy'
```

The first prints `301` and `location: https://license.opensteward.dev/` (it works as soon as the
stack is deployed, before any upload). The second and third print `200` with
`strict-transport-security: max-age=63072000; includeSubDomains; preload`,
`content-security-policy`, `x-content-type-options: nosniff`, `x-frame-options: DENY` and
`referrer-policy: no-referrer`. The fourth shows `img-src 'self' data: https://cdn.brandfetch.io`:
the Platforms page is the one page allowed Brandfetch's logos.

### 9. Point DNS at the distribution

DNS is managed outside this repository. The `opensteward.dev` zone needs the three ACM validation
CNAMEs (so renewals keep working) and A and AAAA alias records to the distribution's
`<id>.cloudfront.net` name for `opensteward.dev`, `www.opensteward.dev` and
`docs.opensteward.dev`.

## Design notes

- **One distribution for three names.** The Free plan covers one distribution with one apex
  domain and its subdomains, and an account may have three Free plans. One distribution means one
  certificate, one web ACL and one pair of functions, and the docs share the plan's allowance
  (1M requests and 100 GB a month).
- **Docs at a pinned commit, fetched at build time** rather than copied into this repository: the
  pin is reviewable in a pull request, git verifies the content against the commit ID, the fetch
  checks that the commit is on the product's `main`, and this repository carries no second copy
  of 160 pages.
- **Things docs-server does that a static site does not:** "Try it out" in the two Swagger UI
  pages (there is no API here to call); clicking a node in an architecture diagram does nothing
  (each diagram links to its full-size SVG instead); the sidebar does not remember open groups
  between pages.
- **Marketing copy** comes from the product README, `docs/why-opensteward.md` and the docs-server
  landing page. It does not claim more than the docs do: the "verified" row lists only adapters the
  catalog marks sandbox- or production-verified.
