/**
 * Deployment flags, and the rule that a flag may only ever withhold.
 *
 * The case-study flag is the one that matters. It is one of five conditions on
 * the case-study gate, and the property being defended is that a Railway
 * deployment which sets NO variable at all resolves to "locked" — because that is
 * exactly the configuration the staging deployment ships with.
 *
 * `case-study-gate.test.ts` covers the conjunction of all five conditions. This
 * covers the parsing of the one input an operator can change without committing
 * anything.
 */
import { describe, expect, it } from 'vitest'

import {
  CASE_STUDY_FLAG_VARIABLE,
  isCaseStudyFlagEnabled,
  isEnvironmentFlagEnabled,
  resolveIsPreview,
} from '../../src/lib/flags.ts'

describe('environment flag parsing defaults to off', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('treats %s as false', (_label, value) => {
    expect(isEnvironmentFlagEnabled(value)).toBe(false)
  })

  it('treats the exact string "true" as true', () => {
    expect(isEnvironmentFlagEnabled('true')).toBe(true)
  })

  it('tolerates casing and surrounding whitespace', () => {
    // A dashboard text field collects whitespace silently, and `TRUE` is
    // unambiguous in intent.
    for (const value of ['TRUE', 'True', ' true ', '\ttrue\n']) {
      expect(isEnvironmentFlagEnabled(value), value).toBe(true)
    }
  })

  it.each([
    ['false', 'false'],
    ['the string FALSE', 'FALSE'],
    ['1', '1'],
    ['yes', 'yes'],
    ['on', 'on'],
    ['enabled', 'enabled'],
    ['t', 't'],
    ['y', 'y'],
    ['truthy', 'truthy'],
    ['true-ish', 'true-ish'],
    ['"true" with quotes', '"true"'],
    ['0', '0'],
    ['nonsense', 'banana'],
  ])('treats %s as false', (_label, value) => {
    expect(isEnvironmentFlagEnabled(value)).toBe(false)
  })

  it('does not treat "false" as truthy, which Boolean() would', () => {
    // The classic environment-variable defect: `Boolean('false') === true`. An
    // operator who set the flag to `false` must get `false`.
    expect(Boolean('false')).toBe(true)
    expect(isEnvironmentFlagEnabled('false')).toBe(false)
  })

  it('accepts exactly one enabling spelling, ignoring case and whitespace', () => {
    // A flag that can be enabled five ways is a flag that gets enabled by
    // accident. Enumerated rather than asserted in prose.
    const candidates = [
      'true',
      'false',
      '1',
      '0',
      'yes',
      'no',
      'on',
      'off',
      'enabled',
      'disabled',
      'y',
      'n',
      't',
      'f',
    ]
    const enabling = candidates.filter((value) => isEnvironmentFlagEnabled(value))
    expect(enabling).toEqual(['true'])
  })
})

describe('the case-study flag', () => {
  it('names the published variable, so nothing can drift from the generator', () => {
    expect(CASE_STUDY_FLAG_VARIABLE).toBe('NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED')
  })

  it('defaults to locked when the variable is absent — the Railway staging case', () => {
    expect(isCaseStudyFlagEnabled(undefined)).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['whitespace', ' '],
    ['malformed', 'ture'],
    ['numeric', '1'],
  ])('treats %s as locked', (_label, value) => {
    expect(isCaseStudyFlagEnabled(value)).toBe(false)
  })

  it('is the same function as the generic flag parser, not a second implementation', () => {
    // Two parsers would eventually disagree, and the generator uses this one.
    for (const value of ['true', 'TRUE', 'false', '', ' ', '1', undefined, null]) {
      expect(isCaseStudyFlagEnabled(value)).toBe(isEnvironmentFlagEnabled(value))
    }
  })
})

describe('the unpublished-deployment rule', () => {
  it('is false for a local build with no platform variables', () => {
    // Local development and the Playwright suite must not render the banner, and
    // have no search index to stay out of.
    expect(resolveIsPreview({})).toBe(false)
  })

  it('is true for a Vercel preview', () => {
    expect(resolveIsPreview({ VERCEL_ENV: 'preview' })).toBe(true)
  })

  it('is false for a Vercel production build', () => {
    expect(resolveIsPreview({ VERCEL_ENV: 'production' })).toBe(false)
  })

  it('honours the explicit override flag', () => {
    expect(resolveIsPreview({ NEXT_PUBLIC_ARPI_PREVIEW: 'true' })).toBe(true)
    expect(resolveIsPreview({ NEXT_PUBLIC_ARPI_PREVIEW: 'false' })).toBe(false)
    // And the override parses through the same conservative rule.
    expect(resolveIsPreview({ NEXT_PUBLIC_ARPI_PREVIEW: '1' })).toBe(false)
  })

  it('is TRUE on Railway staging — the deployment this change creates', () => {
    // The consequence: robots.txt disallows everything, metadata is noindex, and
    // the banner renders. A staging site that stated Gate 2 is closed and got
    // indexed would put that snapshot into search results, where it would outlive
    // the state it describes.
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(true)
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT: 'staging' })).toBe(true)
  })

  it('fails CLOSED: any Railway environment that is not production is unpublished', () => {
    // A rule that had to name each new environment would fail open the first time
    // somebody added one.
    for (const name of ['staging', 'preview', 'pr-12', 'qa', 'sandbox', 'anything']) {
      expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: name }), name).toBe(true)
    }
  })

  it('is false only for the Railway production environment', () => {
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(false)
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT: 'production' })).toBe(false)
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: 'Production' })).toBe(false)
    expect(resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: ' PRODUCTION ' })).toBe(false)
  })

  it('prefers RAILWAY_ENVIRONMENT_NAME over RAILWAY_ENVIRONMENT', () => {
    expect(
      resolveIsPreview({
        RAILWAY_ENVIRONMENT_NAME: 'production',
        RAILWAY_ENVIRONMENT: 'staging',
      })
    ).toBe(false)
  })

  it('ignores an empty Railway environment name rather than treating it as a preview', () => {
    // An empty platform variable must not turn a local build into a preview.
    expect(
      resolveIsPreview({ RAILWAY_ENVIRONMENT_NAME: '', RAILWAY_ENVIRONMENT: '' })
    ).toBe(false)
  })
})
