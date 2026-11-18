#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib'
import { REGION, STACK_NAME, loadConfig } from '../lib/config.js'
import { WebStack } from '../lib/web-stack.js'

const app = new App()
const config = loadConfig(app.node)

const stack = new WebStack(app, STACK_NAME, {
  env: { account: config.account, region: REGION },
  description: 'opensteward.dev: S3, CloudFront, ACM, WAF and the GitHub deploy role',
  terminationProtection: true,
  config,
})
Tags.of(stack).add('project', 'opensteward-website')
