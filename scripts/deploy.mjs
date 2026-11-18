#!/usr/bin/env node
// Uploads out/ to the bucket and invalidates the distribution. Run by the deploy workflow with
// the GitHub OIDC deploy role, which may do exactly this: list, write and delete objects in
// the bucket, and create invalidations on the distribution.
//
//   BUCKET=<name> DISTRIBUTION_ID=<id> node scripts/deploy.mjs [--dry-run]
//
// Order, so a visitor never gets a page whose files are not there yet:
//   1. content-hashed files (_astro/, diagrams), then other files, then the pages;
//   2. delete what the build no longer has. Files a page loads later (hashed assets, the
//      search index) are kept for KEEP_STALE_DAYS after the first deploy that dropped them, so
//      pages still open or cached keep working. That date is recorded as an empty marker object,
//      _deploy/stale/<key>, which neither host can reach (they serve only site/, docs/, _astro/);
//   3. invalidate /* so CloudFront serves the new pages at once.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { KEEP_STALE_DAYS, MARKERS, planCleanup } from './lib/cleanup.mjs'
import { cacheControlFor, contentTypeFor, uploadRank } from './lib/headers.mjs'

const CONCURRENCY = 16
const REGION = 'us-east-1'

const dryRun = process.argv.includes('--dry-run')
const bucket = process.env.BUCKET
const distributionId = process.env.DISTRIBUTION_ID
if (!bucket || !/^[a-z0-9.-]{3,63}$/.test(bucket)) throw new Error('set BUCKET to the bucket name')
if (!distributionId || !/^[A-Z0-9]{8,20}$/.test(distributionId)) throw new Error('set DISTRIBUTION_ID')

const out = join(import.meta.dirname, '..', 'out')

/** Every file in out/ as a bucket key, in upload order. */
function localKeys(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => join(dir, file))
    .filter((path) => statSync(path).isFile())
    .map((path) => relative(dir, path).split(sep).join('/'))
    // .well-known/ (security.txt) ships; editor and OS litter does not.
    .filter((key) => !key.split('/').some((part) => part.startsWith('.') && part !== '.well-known'))
    .sort((a, b) => uploadRank(a) - uploadRank(b) || a.localeCompare(b))
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

const s3 = new S3Client({ region: REGION })
const cloudfront = new CloudFrontClient({ region: REGION })

const keys = localKeys(out)
if (!keys.includes('site/index.html') || !keys.includes('docs/index.html') || !keys.includes('404.html')) {
  throw new Error('out/ is incomplete: run `pnpm build` first')
}
for (const key of keys) contentTypeFor(key) // fail before uploading anything

console.log(`${dryRun ? '[dry run] ' : ''}uploading ${keys.length} files to s3://${bucket}`)
let uploaded = 0
for (const rank of [0, 1, 2]) {
  await inBatches(
    keys.filter((key) => uploadRank(key) === rank),
    CONCURRENCY,
    async (key) => {
      if (!dryRun) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: readFileSync(join(out, key)),
            ContentType: contentTypeFor(key),
            CacheControl: cacheControlFor(key),
          }),
        )
      }
      uploaded++
    },
  )
}
console.log(`${dryRun ? "would upload" : "uploaded"} ${uploaded} files`)

const wanted = new Set(keys)
const now = Date.now()

const objects = new Map()
let token
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }))
  for (const object of page.Contents ?? []) objects.set(object.Key, object.LastModified?.getTime() ?? now)
  token = page.IsTruncated ? page.NextContinuationToken : undefined
} while (token)

const { toDelete, toMark } = planCleanup(objects, wanted, now)

if (!dryRun) {
  await inBatches(toMark, CONCURRENCY, (key) =>
    s3.send(new PutObjectCommand({ Bucket: bucket, Key: MARKERS + key, Body: '', ContentType: 'text/plain' })),
  )
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000)
    const result = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    )
    if (result.Errors?.length) throw new Error(`could not delete: ${result.Errors.map((e) => e.Key).join(', ')}`)
  }
}
console.log(
  `${dryRun ? 'would delete' : 'deleted'} ${toDelete.length} objects; ` +
    `${toMark.length} files the build dropped are kept for ${KEEP_STALE_DAYS} days`,
)

if (!dryRun) {
  const { Invalidation } = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: { CallerReference: `deploy-${Date.now()}`, Paths: { Quantity: 1, Items: ['/*'] } },
    }),
  )
  console.log(`invalidation ${Invalidation?.Id} created for /*`)
}
