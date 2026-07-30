/**
 * Deployment flags, and the one rule that governs all of them.
 *
 * A flag on this site may only ever WITHHOLD. Nothing an operator can type into
 * a deployment dashboard is permitted to make the website claim more than the
 * repository can prove, so every flag here defaults to its most conservative
 * value and treats anything it does not recognise as "off".
 *
 * The case-study flag is the one that matters. It is one of five conditions on
 * the case-study gate, the other four are statements about whether the
 * analytical work has actually been done, and all five are required - so a flag
 * flipped by mistake, or a flag left unset because a bootstrap tool did not set
 * it, both resolve to "locked". See
 * `portfolio/scripts/generate-project-manifest.ts` section 8 and
 * docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md.
 */

/**
 * The exact string that enables a flag. There is exactly one, and it is
 * lower-case `true`.
 *
 * Not `Boolean(value)`: that makes the string `"false"` truthy, which is the
 * classic environment-variable defect and would read as "enabled" for an
 * operator who thought they had disabled it. Not a permissive parser accepting
 * `1`, `yes` or `on` either - a flag that can be enabled five ways is a flag
 * that gets enabled by accident.
 */
const ENABLED_LITERAL = 'true'

/**
 * Parse an environment flag with a safe default.
 *
 * `undefined`, an empty or whitespace-only string, and any value other than
 * `true` all resolve to `false`. Surrounding whitespace is tolerated because a
 * dashboard text field silently collects it; casing is tolerated because
 * `TRUE` is unambiguous in intent. Nothing else is.
 */
export function isEnvironmentFlagEnabled(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return false
  return raw.trim().toLowerCase() === ENABLED_LITERAL
}

/**
 * Whether the case-study build flag is set.
 *
 * NECESSARY AND NEVER SUFFICIENT. This function answering `true` does not unlock
 * the case study; it removes one of five reasons it is locked. The environment
 * variable name is retained under its published `NEXT_PUBLIC_` prefix because it
 * is genuinely public information and because renaming it would silently change
 * the behaviour of an existing deployment that sets it.
 */
export function isCaseStudyFlagEnabled(raw: string | undefined | null): boolean {
  return isEnvironmentFlagEnabled(raw)
}

/** The variable the case-study flag is read from. Exported so tests and the
 *  deployment verifier cannot drift from the generator. */
export const CASE_STUDY_FLAG_VARIABLE = 'NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED'

/* -------------------------------------------------------------------------- */
/* Deployment environment                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The one Railway environment name that counts as published.
 *
 * Compared case-insensitively against `RAILWAY_ENVIRONMENT_NAME`, falling back to
 * `RAILWAY_ENVIRONMENT`. Both are platform-provided; neither is ever set by this
 * repository.
 */
const PUBLISHED_RAILWAY_ENVIRONMENT = 'production'

/**
 * The subset of the environment the preview rule reads.
 *
 * Carries an index signature for the same reason `SiteUrlEnvironment` does:
 * `process.env` cannot be assigned to an all-optional object type.
 */
export interface DeploymentEnvironment {
  readonly VERCEL_ENV?: string | undefined
  readonly NEXT_PUBLIC_ARPI_PREVIEW?: string | undefined
  readonly RAILWAY_ENVIRONMENT?: string | undefined
  readonly RAILWAY_ENVIRONMENT_NAME?: string | undefined
  readonly [key: string]: string | undefined
}

/**
 * Whether this build is an unpublished deployment.
 *
 * Fails CLOSED: on Railway, anything that is not the `production` environment is
 * a preview. A build with no platform variables at all - local development, CI,
 * the Playwright suite - is NOT a preview, because a local build has no search
 * index to stay out of and marking it one would put the preview banner on every
 * screenshot taken during development.
 */
export function resolveIsPreview(env: DeploymentEnvironment): boolean {
  if (env.VERCEL_ENV === 'preview') return true
  if (isEnvironmentFlagEnabled(env.NEXT_PUBLIC_ARPI_PREVIEW)) return true

  const railwayEnvironment = (
    env.RAILWAY_ENVIRONMENT_NAME ??
    env.RAILWAY_ENVIRONMENT ??
    ''
  ).trim()
  if (railwayEnvironment === '') return false

  return railwayEnvironment.toLowerCase() !== PUBLISHED_RAILWAY_ENVIRONMENT
}
