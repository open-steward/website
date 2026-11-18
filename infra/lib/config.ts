import type { Node } from 'constructs'

/** CloudFront takes certificates and WAF web ACLs for distributions from us-east-1 only. */
export const REGION = 'us-east-1'

export const APEX_DOMAIN = 'opensteward.dev'
export const WWW_DOMAIN = `www.${APEX_DOMAIN}`
export const DOCS_DOMAIN = `docs.${APEX_DOMAIN}`
export const DOMAIN_NAMES = [APEX_DOMAIN, WWW_DOMAIN, DOCS_DOMAIN] as const

export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com'
export const GITHUB_OIDC_AUDIENCE = 'sts.amazonaws.com'
/**
 * The repository's tokens carry its immutable subject: owner and repository by numeric ID, so a
 * repository created later under a reused name cannot match. Read it with
 * `gh api repos/open-steward/website/actions/oidc/customization/sub`.
 */
export const GITHUB_OIDC_SUBJECT = 'repo:open-steward@285678617/website@1458238817'
/** A push to main presents this sub. A job that names an environment presents another, on purpose. */
export const GITHUB_DEPLOY_SUBJECT = `${GITHUB_OIDC_SUBJECT}:ref:refs/heads/main`
export const DEPLOY_ROLE_NAME = 'opensteward-website-deploy'

export const STACK_NAME = 'OpenSteward-Website'

/** Requests per IP per 5 minutes before the rate-based rule blocks (context rateLimit). */
export const DEFAULT_RATE_LIMIT = 2000

export interface WebConfig {
  account: string
  /** An existing token.actions.githubusercontent.com provider: an account may hold only one. */
  githubOidcProviderArn?: string
  rateLimit: number
}

export class ConfigError extends Error {}

const ACCOUNT = /^\d{12}$/
const OIDC_PROVIDER_ARN = new RegExp(`^arn:aws:iam::(\\d{12}):oidc-provider/${GITHUB_OIDC_HOST}$`)

/**
 * Reads the deploy-time settings. The account comes from the environment (the cdk CLI sets
 * CDK_DEFAULT_ACCOUNT from the profile) or from context `account`; nothing account-specific is
 * committed.
 */
export function loadConfig(node: Node, env: NodeJS.ProcessEnv = process.env): WebConfig {
  const account = text(node, 'account') ?? env.CDK_DEFAULT_ACCOUNT
  if (account === undefined || !ACCOUNT.test(account)) {
    throw new ConfigError(
      'No AWS account: run cdk with --profile (it sets CDK_DEFAULT_ACCOUNT) or pass -c account=<12 digits>',
    )
  }

  const githubOidcProviderArn = text(node, 'githubOidcProviderArn')
  if (githubOidcProviderArn !== undefined) {
    const match = OIDC_PROVIDER_ARN.exec(githubOidcProviderArn)
    if (match === null) {
      throw new ConfigError(`context githubOidcProviderArn must be an IAM ${GITHUB_OIDC_HOST} provider ARN`)
    }
    if (match[1] !== account) {
      throw new ConfigError('context githubOidcProviderArn belongs to another account')
    }
  }

  const rateLimitText = text(node, 'rateLimit')
  const rateLimit = rateLimitText === undefined ? DEFAULT_RATE_LIMIT : Number(rateLimitText)
  // AWS WAF accepts 10 to 2,000,000,000 requests per evaluation window.
  if (!Number.isInteger(rateLimit) || rateLimit < 10 || rateLimit > 2_000_000_000) {
    throw new ConfigError('context rateLimit must be a whole number from 10 to 2000000000')
  }

  return {
    account,
    rateLimit,
    ...(githubOidcProviderArn === undefined ? {} : { githubOidcProviderArn }),
  }
}

function text(node: Node, key: string): string | undefined {
  const value: unknown = node.tryGetContext(key)
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') throw new ConfigError(`context ${key} must be a string`)
  return value.trim()
}
