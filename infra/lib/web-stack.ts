import { fileURLToPath } from 'node:url'
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_iam as iam,
  aws_s3 as s3,
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import {
  APEX_DOMAIN,
  DEPLOY_ROLE_NAME,
  DOCS_DOMAIN,
  DOMAIN_NAMES,
  GITHUB_DEPLOY_SUBJECT,
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_HOST,
  WWW_DOMAIN,
  type WebConfig,
} from './config.js'

export interface WebStackProps extends StackProps {
  config: WebConfig
}

const functionFile = (name: string): string =>
  fileURLToPath(new URL(`../functions/${name}.js`, import.meta.url))

/**
 * opensteward.dev, www.opensteward.dev and docs.opensteward.dev: one private bucket behind one
 * CloudFront distribution, shaped to fit the CloudFront Free flat-rate plan (a WAF web ACL
 * attached, at most 5 WAF rules, AWS managed cache policy, no custom response-header policy,
 * OAC rather than OAI, functions used by this distribution only).
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props)
    const { config } = props

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      // The content is rebuilt from git on every deploy, but deleting the stack should still
      // never delete what the site serves.
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // DNS validation without a hosted zone: the zone lives in another account (and at GoDaddy
    // until the switch). The deploy waits until the validation CNAMEs are published.
    const certificate = new acm.Certificate(this, 'Certificate', {
      certificateName: APEX_DOMAIN,
      domainName: APEX_DOMAIN,
      subjectAlternativeNames: [WWW_DOMAIN, DOCS_DOMAIN],
      validation: acm.CertificateValidation.fromDns(),
    })

    const webAcl = this.webAcl(config.rateLimit)

    const viewerRequest = new cloudfront.Function(this, 'ViewerRequestFunction', {
      functionName: 'opensteward-website-viewer-request',
      comment: 'Routes the three hosts, redirects /license and www, serves directory index pages',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({ filePath: functionFile('viewer-request') }),
    })
    const viewerResponse = new cloudfront.Function(this, 'ViewerResponseFunction', {
      functionName: 'opensteward-website-viewer-response',
      comment: 'Adds the security headers (HSTS, CSP, nosniff, no framing, referrer policy)',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({ filePath: functionFile('viewer-response') }),
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'opensteward.dev, www and docs',
      domainNames: [...DOMAIN_NAMES],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: cloudfront.SSLMethod.SNI,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // AWS's managed security headers (HSTS, nosniff, X-Frame-Options SAMEORIGIN, a referrer
        // policy). CloudFront adds them before the viewer-response function, which replaces them
        // with stricter values; they matter for the 404 page, where that function does not run.
        // A managed policy is allowed on the Free plan; a custom one is not.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          { function: viewerRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          { function: viewerResponse, eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE },
        ],
      },
      // OAC grants the distribution s3:GetObject only, so S3 answers a missing key with 403.
      // Both become the 404 page at the bucket root, shared by the two sites.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: '/404.html',
        ttl: Duration.minutes(5),
      })),
    })

    const deployRole = this.deployRole(config, bucket, distribution)

    new CfnOutput(this, 'BucketName', { value: bucket.bucketName })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName })
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn })
    new CfnOutput(this, 'CertificateArn', { value: certificate.certificateArn })
    new CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn })
  }

  /**
   * The Free plan requires a web ACL on the distribution and allows at most 5 rules and no rule
   * groups of our own; AWS managed rule groups and rate-based rules are allowed. Declared here, so
   * a later deploy never detaches one the console attached.
   */
  private webAcl(rateLimit: number): wafv2.CfnWebACL {
    const visibility = (metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName,
    })
    const managed = (name: string, priority: number): wafv2.CfnWebACL.RuleProperty => ({
      name: `AWS-${name}`,
      priority,
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
      overrideAction: { none: {} },
      visibilityConfig: visibility(name),
    })

    return new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'opensteward-website',
      description: 'opensteward.dev distribution: AWS managed baseline rules and a per-IP rate limit',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('opensteward-website'),
      rules: [
        managed('AWSManagedRulesAmazonIpReputationList', 0),
        managed('AWSManagedRulesCommonRuleSet', 1),
        {
          name: 'RateLimitPerIp',
          priority: 2,
          statement: {
            rateBasedStatement: { limit: rateLimit, aggregateKeyType: 'IP', evaluationWindowSec: 300 },
          },
          action: { block: {} },
          visibilityConfig: visibility('RateLimitPerIp'),
        },
      ],
    })
  }

  /**
   * GitHub Actions on main of open-steward/website, by the repository's immutable subject. It
   * may write and delete objects in the bucket (and list it, which `aws s3 sync --delete` needs)
   * and create invalidations on this distribution. Nothing else.
   */
  private deployRole(
    config: WebConfig,
    bucket: s3.Bucket,
    distribution: cloudfront.Distribution,
  ): iam.Role {
    const providerArn =
      config.githubOidcProviderArn ??
      new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIds: [GITHUB_OIDC_AUDIENCE],
      }).oidcProviderArn

    return new iam.Role(this, 'DeployRole', {
      roleName: DEPLOY_ROLE_NAME,
      description: 'GitHub Actions, main of open-steward/website only: upload the site and invalidate',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: GITHUB_OIDC_AUDIENCE,
          [`${GITHUB_OIDC_HOST}:sub`]: GITHUB_DEPLOY_SUBJECT,
        },
      }),
      inlinePolicies: {
        Deploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'ListBucket',
              actions: ['s3:ListBucket'],
              resources: [bucket.bucketArn],
            }),
            new iam.PolicyStatement({
              sid: 'WriteObjects',
              actions: ['s3:PutObject', 's3:DeleteObject'],
              resources: [bucket.arnForObjects('*')],
            }),
            new iam.PolicyStatement({
              sid: 'Invalidate',
              actions: ['cloudfront:CreateInvalidation'],
              resources: [distribution.distributionArn],
            }),
          ],
        }),
      },
    })
  }
}
