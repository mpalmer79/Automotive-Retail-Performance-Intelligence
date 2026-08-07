/**
 * The trust panel: the console stating its own evidence.
 *
 * This is a product feature, not a footer disclaimer. An operating console asks a
 * reader to act on its numbers, and the honest form of that request includes what
 * the numbers are, where they came from, what was checked, what was not, and what
 * this page is explicitly not evidence for.
 *
 * TWO LANES, SIDE BY SIDE, WITH DIFFERENT SOURCES
 * ----------------------------------------------
 * The left lane is the SQL export: dataset version, as-of date, contract
 * fingerprint, reconciliation, privacy scan, pipeline validation, freshness. Every
 * field comes from `src/generated/dashboard/manifest.json`.
 *
 * The right lane is Power BI, and it comes from somewhere else entirely — the
 * ADR-0008 evidence files, through the project manifest. The dashboard export
 * carries no Power BI field at all, by design, so there is no path by which a green
 * export could make the semantic model look validated. Both accepted paths are
 * pending, and the panel says so in the same words the status page uses.
 *
 * Server component.
 */
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Disclosure } from '@/components/ui/disclosure'
import { Heading, Text } from '@/components/ui/typography'
import type { ExportTrust, PowerBiTrust, TrustCheck } from '@/lib/dashboard/trust'
import { GATE_2_STATEMENT } from '@/lib/dashboard/trust'
import { formatIsoDate } from '@/lib/dashboard/format'
import { ROUTES } from '@/lib/site'

export function TrustPanel({
  exportState,
  powerBi,
}: {
  exportState: ExportTrust
  powerBi: PowerBiTrust
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ExportLane state={exportState} />
      <PowerBiLane state={powerBi} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Export lane                                                                 */
/* -------------------------------------------------------------------------- */

function ExportLane({ state }: { state: ExportTrust }) {
  return (
    <Card as="section" padding="md" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Heading level={3} size="h5">
          The SQL export lane
        </Heading>
        <Text size="sm" tone="muted">
          Every figure on this page is read from a versioned export taken from the{' '}
          <code className="font-mono text-xs">reporting</code> schema by a read-only role
          at build time. The browser holds no database connection, no credential and no
          query.
        </Text>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Fact term="Dataset version">v{state.datasetVersion}</Fact>
        <Fact term="Contract version">v{state.contractVersion}</Fact>
        <Fact term="Data as of">{formatIsoDate(state.asOfDate)}</Fact>
        <Fact term="Contract digest">{state.contractFingerprint}</Fact>
        <Fact term="Profile">{state.profile}</Fact>
        <Fact term="Random seed">{state.randomSeed}</Fact>
      </dl>

      <ul className="flex flex-col gap-2.5">
        {state.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>

      <Disclosure label="Which reporting views produced these figures?">
        <Text size="sm" tone="muted">
          The exporter reads an explicit allowlist and nothing else. It never touches the
          raw, staging, warehouse or audit schemas, and a column outside the declared
          contract fails the export rather than being dropped.
        </Text>
        <ul className="flex flex-col gap-1">
          {state.sourceViews.map((view) => (
            <li key={view} className="font-mono text-2xs text-ink-secondary">
              {view}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure label="What are the known limits of this data?">
        <ul className="flex flex-col gap-2">
          {state.limitations.map((limitation) => (
            <li key={limitation.slice(0, 48)}>
              <Text size="sm" tone="muted">
                {limitation}
              </Text>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Text size="xs" tone="faint">
        Generated {state.generatedAt} from source commit{' '}
        <code className="font-mono">{state.sourceCommit.slice(0, 12)}</code>, pipeline run{' '}
        <code className="font-mono">{state.pipelineRunUuid}</code>. The generation
        timestamp is provenance, not freshness: freshness is the contract comparison
        above.
      </Text>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Power BI lane                                                               */
/* -------------------------------------------------------------------------- */

function PowerBiLane({ state }: { state: PowerBiTrust }) {
  return (
    <Card
      as="section"
      padding="md"
      tone={state.validated ? 'default' : 'pending'}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={3} size="h5">
            The Power BI lane
          </Heading>
          <Badge tone={state.validated ? 'verified' : 'pending'}>
            {state.validated ? 'Validated' : `Real-engine validation ${state.state}`}
          </Badge>
        </div>
        <Text size="sm" tone="muted">
          {state.claim}
        </Text>
      </div>

      <ul className="flex flex-col gap-3">
        {state.paths.map((path) => (
          <li key={path.id} className="flex flex-col gap-1 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{path.label}</span>
              <Badge tone={path.result === 'passed' ? 'verified' : 'pending'} mono>
                {path.result}
              </Badge>
            </div>
            <Text size="xs" tone="muted">
              {path.note}
            </Text>
            {/*
              `SourceLink` rather than a bare anchor, and the axe sweep is why.
              An 11px monospace line is 17.8px tall, so two of them side by side
              are a WCAG 2.2 Target Size failure - which is exactly the defect
              `SourceLink` already carries a 24px minimum height for. It also
              supplies the external-tab treatment (`target`, `rel`, and the hint
              in the accessible name) that `navigation.spec.ts` requires of every
              off-site link on this site.
            */}
            <div className="flex flex-col gap-0.5">
              <SourceLink path={path.evidencePath} field="evidence" variant="block" />
              <SourceLink path={path.procedurePath} field="procedure" variant="block" />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Text size="sm" tone="muted">
          {GATE_2_STATEMENT}
        </Text>
        <Text size="xs" tone="faint">
          Power BI remains the canonical analytical product for this project. This console
          renders exported SQL figures; it does not run DAX, does not validate the
          semantic model, and may not be cited as evidence toward Gate 2 or ADR-0008.{' '}
          <Link
            href={ROUTES.status.href}
            className="underline decoration-dotted underline-offset-4 hover:text-accent"
          >
            The status page holds the full validation ledger.
          </Link>
        </Text>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
        {term}
      </dt>
      <dd className="font-mono text-xs break-words text-ink">{children}</dd>
    </div>
  )
}

/**
 * One check, with its state in a word and not only in a colour.
 *
 * The marker is a glyph that differs per verdict — a tick, a cross, a dash — so the
 * row reads correctly in greyscale, which is both the WCAG 1.4.1 requirement and
 * the honest way to present a panel whose whole subject is what has and has not
 * been proved.
 */
function CheckRow({ check }: { check: TrustCheck }) {
  const glyph = check.verdict === 'pass' ? '✓' : check.verdict === 'fail' ? '✕' : '-'
  const tone =
    check.verdict === 'pass'
      ? 'border-verified/50 bg-verified-wash text-verified'
      : check.verdict === 'fail'
        ? 'border-failed/50 bg-failed-wash text-failed'
        : 'border-pending/50 bg-pending-wash text-pending'

  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs leading-none ${tone}`}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-ink">{check.label}</span>
          <span className="font-mono text-2xs text-ink-secondary">
            <span className="sr-only">
              {check.verdict === 'pass'
                ? 'Passed: '
                : check.verdict === 'fail'
                  ? 'Failed: '
                  : 'Pending: '}
            </span>
            {check.value}
          </span>
        </span>
        <span className="block text-xs leading-normal text-ink-muted">
          {check.detail}
        </span>
      </span>
    </li>
  )
}
