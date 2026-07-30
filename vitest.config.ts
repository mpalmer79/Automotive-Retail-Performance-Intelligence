import { defineConfig } from 'vitest/config'

/**
 * Deployment-tooling tests.
 *
 * Separate from `portfolio/vitest.config.ts`, which covers the website. This one
 * covers `scripts/railway/`, `.railway/railway.ts` and the deployment
 * specification, and runs in a Node environment because none of it touches a DOM.
 *
 * NOTHING HERE CONTACTS RAILWAY. Two mechanisms:
 *
 *   - the IaC declaration is exercised through the SDK's own `evaluate` command,
 *     which compiles the declaration and needs no credential and no network
 *   - the bootstrap tool is exercised against a FAKE Railway CLI on
 *     RAILWAY_CLI_BIN, which returns canned JSON and records every invocation, so
 *     "the dry run mutated nothing" is checked by reading what was actually
 *     invoked rather than by trusting the flag
 *
 * A test needing live Railway access is an explicit opt-in and is not part of this
 * suite; see deployment/railway/README.md section 10.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/railway/**/*.test.ts'],
    // Generous, because two things here are genuinely slow and are slow for good
    // reasons: the IaC runner compiles TypeScript in a child process, and the
    // bootstrap tests spawn the real tool as a real process against a real fake
    // binary. Both are what makes those checks worth having.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    restoreMocks: true,
    clearMocks: true,
  },
})
