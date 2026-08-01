'use client'

/**
 * Chapter five: the engineering proof.
 *
 * Four numbers, set as editorial numerals, each linked to the file that proves
 * it. Then a drawer with the eight secondary counts for a reader who wants them.
 *
 * WHY FOUR AND NOT SEVEN
 * ----------------------
 * The previous credibility strip showed seven counts at equal weight in one row:
 * 3 dealerships, 8 dimensions, 5 facts, 28 views, 29 KPIs, 42 relationships, 49
 * measures. Three of those establish engineering depth and three establish the
 * size of a fictional dealer group, and giving them the same treatment made the
 * strong ones read as weakly as the weak ones. That was finding B-03.
 *
 * The four kept are the four a senior engineer would actually weigh: the
 * governed read surface, the governed metric set, the semantic model's join
 * graph, and the DAX written on top of it. The rest are in the drawer, where
 * they are available and not competing.
 *
 * MANIFEST-DRIVEN, ALWAYS
 * -----------------------
 * Every value and every source path on this page comes from
 * `project-manifest.json`, which is regenerated from repository evidence on
 * every build and fails the build if it disagrees with that evidence. Nothing
 * here is typed as a literal, and `tests/unit/content-integrity.test.ts` fails
 * if one ever is.
 *
 * WHY THE NUMBERS NO LONGER COUNT UP
 * ----------------------------------
 * They did, all seven of them, once per page view. At four figures set this
 * large the animation is the wrong emphasis: it draws the eye to the motion
 * rather than to the size, and it delays the one thing the section is for. The
 * numbers are simply there, at full size, on first paint. That also removes the
 * last requestAnimationFrame loop from the home page.
 *
 * Client only for the drawer's disclosure state. The four figures and their
 * source links are static markup and render on the server.
 */
import { ArrowRight, ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Reveal, RevealGroup, RevealItem } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import { REPOSITORY_URL } from '@/lib/site'
import { cx } from '@/lib/utils'
import type { SourcedCount } from '@/types/manifest'

/**
 * The four headline figures, and one sentence each on why the number matters
 * rather than what it is. The manifest already supplies a `detail`; these say
 * something the manifest cannot, which is what a reviewer should conclude.
 */
const HEADLINE: readonly { count: SourcedCount; meaning: string }[] = [
  {
    count: counts.reportingViews,
    meaning:
      'Nothing above the database reads a warehouse table directly. The read surface is a contract, and the reporting role is provably confined to it.',
  },
  {
    count: counts.governedKpis,
    meaning:
      'Every one carries both sides of its ratio, its grain, its date basis, its null rule and what a reader must not conclude from it.',
  },
  {
    count: counts.semanticRelationships,
    meaning:
      'All single-direction. There is no bidirectional filter and no many-to-many in the model, and the static check fails the build if one appears.',
  },
  {
    count: counts.daxMeasures,
    meaning:
      'Written, source-controlled as TMDL, and statically parsed on every push. None has been evaluated by an engine, which is the one thing this section will not overstate.',
  },
]

/** The secondary counts, behind the drawer. */
const SECONDARY: readonly SourcedCount[] = [
  counts.sqlScripts,
  counts.dataQualityChecks,
  counts.reconciliations,
  counts.dimensions,
  counts.facts,
  counts.semanticTables,
  counts.supportingMeasures,
  counts.staticAssertions,
]

export function EngineeringProof() {
  const [open, setOpen] = useState(false)

  return (
    <Section id="proof" tone="evidence">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The engineering proof"
          title="Four numbers, each one generated from the file that proves it."
          lede="Nothing on this site is typed in by hand. The build regenerates every count from repository evidence and fails if one has drifted."
        />

        <RevealGroup
          as="ol"
          className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8"
        >
          {HEADLINE.map((item, index) => (
            <RevealItem
              key={item.count.label}
              as="li"
              index={index}
              className="flex flex-col gap-3"
            >
              <span className="numeric font-display text-numeral leading-none font-bold tracking-tighter text-ink">
                {item.count.value}
              </span>
              <span className="text-lg leading-snug font-semibold text-ink-secondary">
                {item.count.label}
              </span>
              <Text size="sm" tone="muted" className="grow">
                {item.meaning}
              </Text>
              {item.count.sources[0] ? (
                <SourceLink
                  path={item.count.sources[0].path}
                  field={item.count.sources[0].field}
                  className="mt-1"
                />
              ) : null}
            </RevealItem>
          ))}
        </RevealGroup>

        {/* The evidence drawer.
            A real <button> driving `aria-expanded` and a conditionally rendered
            region, not a `<details>`: the styling a `<summary>` marker needs
            across engines is more trouble than the state, and a keyboard user
            gets identical behaviour either way. Closed content is out of the DOM
            rather than hidden, so nobody tabs into invisible links. */}
        <Reveal className="mt-14 border-t border-line pt-8">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="secondary-counts"
            onClick={() => {
              setOpen(!open)
            }}
            className="inline-flex min-h-touch items-center gap-2 text-base font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent"
          >
            {open ? 'Hide the rest of the evidence' : 'See all engineering evidence'}
            <ChevronDown
              aria-hidden="true"
              className={cx(
                'size-4 transition-transform duration-(--arpi-motion-base)',
                open ? 'rotate-180' : 'rotate-0'
              )}
              strokeWidth={2.5}
            />
          </button>

          {open ? (
            <div id="secondary-counts" className="mt-8 flex flex-col gap-8">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                {SECONDARY.map((count) => (
                  <div key={count.label} className="flex min-w-0 flex-col gap-1.5">
                    <dd className="numeric font-display text-3xl leading-none font-semibold tracking-tighter text-ink">
                      {count.value}
                    </dd>
                    <dt className="text-sm leading-snug font-semibold text-ink-secondary">
                      {count.label}
                    </dt>
                    <p className="text-xs leading-normal text-ink-faint">
                      {count.detail}
                    </p>
                    {count.sources[0] ? (
                      <SourceLink
                        path={count.sources[0].path}
                        field={count.sources[0].field}
                        className="mt-1"
                      />
                    ) : null}
                  </div>
                ))}
              </dl>

              <div className="flex flex-col gap-4 border-t border-line-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
                <Text size="sm" tone="muted" className="max-w-prose">
                  The full evidence ledger, both real-engine validation paths and every
                  lifecycle phase are on the status page. The source for all of it is one
                  repository.
                </Text>
                <LinkButton
                  href={REPOSITORY_URL}
                  variant="secondary"
                  external
                  iconAfter={<ArrowRight />}
                  className="shrink-0"
                >
                  Read the source
                </LinkButton>
              </div>
            </div>
          ) : null}
        </Reveal>
      </Container>
    </Section>
  )
}
