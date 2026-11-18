import { defineConfig } from 'vitest/config'

// The build scripts' tests. infra/ has its own config (pnpm test runs both).
export default defineConfig({
  test: {
    include: ['scripts/test/**/*.test.mjs', 'apps/docs/test/**/*.test.mjs', 'apps/site/test/**/*.test.mjs'],
  },
})
