import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { ConfigError, GITHUB_DEPLOY_SUBJECT, loadConfig, type WebConfig } from '../lib/config.js'
import { WebStack } from '../lib/web-stack.js'

const ACCOUNT = '111111111111'

function synth(overrides: Partial<WebConfig> = {}): Template {
  const app = new App()
  const config: WebConfig = { account: ACCOUNT, rateLimit: 2000, ...overrides }
  const stack = new WebStack(app, 'Test', { env: { account: ACCOUNT, region: 'us-east-1' }, config })
  return Template.fromStack(stack)
}

const template = synth()

type Statement = {
  Sid?: string
  Effect: string
  Action: string | string[]
  Resource: unknown
  Principal?: unknown
  Condition?: Record<string, Record<string, unknown>>
}

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value])

function onlyResource(type: string): { logicalId: string; properties: Record<string, any> } {
  const resources = template.findResources(type)
  const ids = Object.keys(resources)
  expect(ids).toHaveLength(1)
  const logicalId = ids[0]!
  return { logicalId, properties: resources[logicalId]!.Properties }
}

describe('bucket', () => {
  it('blocks all public access, enforces TLS and owns its objects', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      BucketEncryption: Match.objectLike({}),
    })
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' })
    template.resourceCountIs('AWS::S3::Bucket', 1)
  })

  it('lets only this distribution read it, through OAC', () => {
    const { properties } = onlyResource('AWS::S3::BucketPolicy')
    const statements = properties.PolicyDocument.Statement as Statement[]
    const allows = statements.filter((s) => s.Effect === 'Allow')
    expect(allows).toHaveLength(1)
    const allow = allows[0]!
    expect(allow.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' })
    expect(asArray(allow.Action)).toEqual(['s3:GetObject'])
    const sourceArn = JSON.stringify(allow.Condition?.StringEquals?.['AWS:SourceArn'])
    expect(sourceArn).toContain(':distribution/')
    expect(sourceArn).toContain(onlyResource('AWS::CloudFront::Distribution').logicalId)

    const denyInsecure = statements.find((s) => s.Effect === 'Deny')
    expect(denyInsecure?.Condition).toEqual({ Bool: { 'aws:SecureTransport': 'false' } })
  })

  it('uses origin access control and no origin access identity', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    })
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0)
    const { properties } = onlyResource('AWS::CloudFront::Distribution')
    const [origin] = properties.DistributionConfig.Origins
    expect(origin.OriginAccessControlId).toBeDefined()
    expect(origin.S3OriginConfig.OriginAccessIdentity).toBe('')
  })
})

describe('distribution', () => {
  const config = () => onlyResource('AWS::CloudFront::Distribution').properties.DistributionConfig

  it('serves the apex, www and docs over HTTPS only, TLS 1.2 or later, IPv6 on', () => {
    expect(config().Aliases).toEqual(['opensteward.dev', 'www.opensteward.dev', 'docs.opensteward.dev'])
    expect(config().DefaultCacheBehavior.ViewerProtocolPolicy).toBe('https-only')
    expect(config().ViewerCertificate).toMatchObject({
      MinimumProtocolVersion: 'TLSv1.2_2021',
      SslSupportMethod: 'sni-only',
    })
    expect(config().IPV6Enabled).toBe(true)
  })

  it('uses a certificate for all three names, validated by DNS without a hosted zone', () => {
    const { logicalId, properties } = onlyResource('AWS::CertificateManager::Certificate')
    expect(properties.DomainName).toBe('opensteward.dev')
    expect(properties.SubjectAlternativeNames).toEqual(['www.opensteward.dev', 'docs.opensteward.dev'])
    expect(properties.ValidationMethod).toBe('DNS')
    expect(properties.DomainValidationOptions).toBeUndefined()
    expect(config().ViewerCertificate.AcmCertificateArn).toEqual({ Ref: logicalId })
  })

  it('associates both functions, viewer request and viewer response', () => {
    const associations = config().DefaultCacheBehavior.FunctionAssociations as {
      EventType: string
      FunctionARN: { 'Fn::GetAtt': [string, string] }
    }[]
    const byEvent = Object.fromEntries(associations.map((a) => [a.EventType, a.FunctionARN['Fn::GetAtt'][0]]))
    expect(Object.keys(byEvent).sort()).toEqual(['viewer-request', 'viewer-response'])

    const functions = template.findResources('AWS::CloudFront::Function')
    expect(Object.keys(functions)).toHaveLength(2)
    for (const id of Object.values(byEvent)) {
      expect(functions[id]?.Properties.FunctionConfig.Runtime).toBe('cloudfront-js-2.0')
    }
    expect(functions[byEvent['viewer-request']!]?.Properties.FunctionCode).toContain('license.opensteward.dev')
    expect(functions[byEvent['viewer-response']!]?.Properties.FunctionCode).toContain('content-security-policy')
  })

  it('fits the Free plan: managed policies only, one behavior, no logs', () => {
    const behavior = config().DefaultCacheBehavior
    // AWS managed CachingOptimized and SecurityHeadersPolicy.
    expect(behavior.CachePolicyId).toBe('658327ea-f89d-4fab-a63d-7e88639e58f6')
    expect(behavior.ResponseHeadersPolicyId).toBe('67f7725c-6f97-4210-82d7-5512b31e9d03')
    expect(behavior.OriginRequestPolicyId).toBeUndefined()
    expect(behavior.ForwardedValues).toBeUndefined()
    expect(config().CacheBehaviors).toBeUndefined()
    expect(config().Logging).toBeUndefined()
    template.resourceCountIs('AWS::CloudFront::CachePolicy', 0)
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 0)
    template.resourceCountIs('AWS::CloudFront::OriginRequestPolicy', 0)
    template.resourceCountIs('AWS::CloudFront::RealtimeLogConfig', 0)
  })

  it('serves GET and HEAD only', () => {
    expect(config().DefaultCacheBehavior.AllowedMethods).toEqual(['GET', 'HEAD'])
  })

  it('answers missing pages with the 404 page and a 404 status', () => {
    expect(config().CustomErrorResponses).toEqual([
      { ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404.html', ErrorCachingMinTTL: 300 },
      { ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404.html', ErrorCachingMinTTL: 300 },
    ])
  })
})

describe('WAF web ACL', () => {
  it('is attached to the distribution', () => {
    const { logicalId } = onlyResource('AWS::WAFv2::WebACL')
    expect(onlyResource('AWS::CloudFront::Distribution').properties.DistributionConfig.WebACLId).toEqual({
      'Fn::GetAtt': [logicalId, 'Arn'],
    })
  })

  it('has CloudFront scope, at most 5 rules, and no rule groups of its own', () => {
    const { properties } = onlyResource('AWS::WAFv2::WebACL')
    expect(properties.Scope).toBe('CLOUDFRONT')
    expect(properties.DefaultAction).toEqual({ Allow: {} })
    expect(properties.Rules.length).toBeLessThanOrEqual(5)
    template.resourceCountIs('AWS::WAFv2::RuleGroup', 0)
    for (const rule of properties.Rules) {
      expect(rule.Statement.RuleGroupReferenceStatement).toBeUndefined()
      if (rule.Statement.ManagedRuleGroupStatement) {
        expect(rule.Statement.ManagedRuleGroupStatement.VendorName).toBe('AWS')
      }
    }
  })

  it('blocks an IP over the rate limit', () => {
    const rate = onlyResource('AWS::WAFv2::WebACL').properties.Rules.find(
      (rule: any) => rule.Statement.RateBasedStatement,
    )
    // A plain block: the Free plan has no custom WAF responses (Pro and up), so a blocked visitor
    // gets CloudFront's 403 mapping, the 404 page.
    expect(rate.Action).toEqual({ Block: {} })
    expect(rate.Statement.RateBasedStatement).toEqual({
      Limit: 2000,
      AggregateKeyType: 'IP',
      EvaluationWindowSec: 300,
    })
  })

  it('takes the rate limit from config', () => {
    const rules = synth({ rateLimit: 500 }).findResources('AWS::WAFv2::WebACL')
    const rate = Object.values(rules)[0]!.Properties.Rules.find((rule: any) => rule.Statement.RateBasedStatement)
    expect(rate.Statement.RateBasedStatement.Limit).toBe(500)
  })
})

describe('GitHub deploy role', () => {
  const role = () => onlyResource('AWS::IAM::Role').properties

  it('trusts only main of open-steward/website, by the immutable subject', () => {
    const statements = role().AssumeRolePolicyDocument.Statement as Statement[]
    expect(statements).toHaveLength(1)
    const trust = statements[0]!
    expect(trust.Action).toBe('sts:AssumeRoleWithWebIdentity')
    expect(trust.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': 'repo:open-steward@285678617/website@1458238817:ref:refs/heads/main',
      },
    })
    expect(GITHUB_DEPLOY_SUBJECT).toBe('repo:open-steward@285678617/website@1458238817:ref:refs/heads/main')
    expect(JSON.stringify(trust.Condition)).not.toContain('*')
    expect(trust.Condition?.StringLike).toBeUndefined()
  })

  it('may only write this bucket and invalidate this distribution', () => {
    const policies = role().Policies as { PolicyDocument: { Statement: Statement[] } }[]
    expect(role().ManagedPolicyArns).toBeUndefined()
    const statements = policies.flatMap((p) => p.PolicyDocument.Statement)
    const bucketId = onlyResource('AWS::S3::Bucket').logicalId
    const distributionId = onlyResource('AWS::CloudFront::Distribution').logicalId

    const actions = statements.flatMap((s) => asArray(s.Action)).sort()
    expect(actions).toEqual(['cloudfront:CreateInvalidation', 's3:DeleteObject', 's3:ListBucket', 's3:PutObject'])
    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow')
      const resource = JSON.stringify(statement.Resource)
      expect(resource).not.toBe('"*"')
      const owner = asArray(statement.Action).some((a) => a.startsWith('cloudfront:')) ? distributionId : bucketId
      expect(resource).toContain(owner)
    }
    // No IAM policy resources hang extra permissions on the role.
    template.resourceCountIs('AWS::IAM::Policy', 0)
  })

  it('creates the GitHub OIDC provider when the account has none', () => {
    template.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    })
  })

  it('uses the existing provider when one is given', () => {
    const arn = `arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`
    const withProvider = synth({ githubOidcProviderArn: arn })
    withProvider.resourceCountIs('AWS::IAM::OIDCProvider', 0)
    const roles = withProvider.findResources('AWS::IAM::Role')
    const trust = Object.values(roles)[0]!.Properties.AssumeRolePolicyDocument.Statement[0]
    expect(trust.Principal).toEqual({ Federated: arn })
  })
})

describe('outputs', () => {
  it('include the bucket, distribution ID and domain, and the role ARN', () => {
    const outputs = Object.keys(template.findOutputs('*'))
    expect(outputs).toEqual(
      expect.arrayContaining(['BucketName', 'DistributionId', 'DistributionDomainName', 'DeployRoleArn']),
    )
  })
})

describe('config', () => {
  const node = (context: Record<string, unknown>) => {
    const app = new App({ context })
    return app.node
  }

  it('takes the account from the environment', () => {
    expect(loadConfig(node({}), { CDK_DEFAULT_ACCOUNT: ACCOUNT })).toEqual({ account: ACCOUNT, rateLimit: 2000 })
  })

  it('refuses to run without an account', () => {
    expect(() => loadConfig(node({}), {})).toThrow(ConfigError)
    expect(() => loadConfig(node({ account: '12' }), {})).toThrow(ConfigError)
  })

  it('checks the OIDC provider ARN and its account', () => {
    const env = { CDK_DEFAULT_ACCOUNT: ACCOUNT }
    expect(() => loadConfig(node({ githubOidcProviderArn: 'arn:aws:iam::111111111111:role/x' }), env)).toThrow(
      ConfigError,
    )
    expect(() =>
      loadConfig(
        node({ githubOidcProviderArn: 'arn:aws:iam::222222222222:oidc-provider/token.actions.githubusercontent.com' }),
        env,
      ),
    ).toThrow(/another account/)
  })

  it('checks the rate limit', () => {
    const env = { CDK_DEFAULT_ACCOUNT: ACCOUNT }
    expect(loadConfig(node({ rateLimit: '500' }), env).rateLimit).toBe(500)
    expect(() => loadConfig(node({ rateLimit: '5' }), env)).toThrow(ConfigError)
    expect(() => loadConfig(node({ rateLimit: 'lots' }), env)).toThrow(ConfigError)
  })
})
