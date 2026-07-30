'use client'

/**
 * The trust framework: five layers, selectable, each listing the controls it
 * holds and the file that enforces each one.
 *
 * The interaction is a tab list rather than an accordion because the five layers
 * are alternatives to be compared rather than a sequence to be read through, and
 * because a tab list keeps the panel height stable while the reader moves
 * between them.
 *
 * The distinction the component is built around: a control either has an
 * enforcement mechanism or it does not. Every row here names one, and the
 * `enforcement` field is required rather than optional, so a control cannot be
 * listed as governance while resting on nothing but intent.
 */
import { Database, FileSearch, Lock, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import { buttonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Heading, Text } from '@/components/ui/typography'
import { cx } from '@/lib/utils'

interface Control {
  readonly control: string
  readonly enforcement: string
  readonly path: string
}

interface Layer {
  readonly id: string
  readonly label: string
  readonly icon: typeof Lock
  readonly summary: string
  readonly controls: readonly Control[]
}

const LAYERS: readonly Layer[] = [
  {
    id: 'data',
    label: 'The data itself',
    icon: Database,
    summary:
      'The strongest privacy control available is not collecting the attribute. Every prohibited field in this project was never designed, so there is nothing to mask, redact or leak.',
    controls: [
      {
        control:
          'No name, address, email, phone, full birth date, government or bank identifier exists in any table',
        enforcement:
          'A dedicated privacy validation check runs against every generated dataset before load, and a unit test asserts it fails when a prohibited attribute is introduced.',
        path: 'src/arpi/validation/privacy.py',
      },
      {
        control: 'Age is a band, not a date. Geography stops at county or market area.',
        enforcement:
          'The dimension DDL has no birth-date column and no street-address column, so the value cannot be stored even by a misbehaving loader.',
        path: 'sql/03_dimensions/05_dim_customer.sql',
      },
      {
        control: 'No real VIN is linked to a synthetic customer',
        enforcement:
          'A written policy fixes the VIN format and its synthetic derivation, and the vehicle generator is tested against it.',
        path: 'docs/architecture-decisions/ADR-0005-synthetic-vin-policy.md',
      },
      {
        control: 'The committed sample dataset is synthetic and small',
        enforcement:
          'Generated output is gitignored. Only a small extract is committed, and the secret check runs over the git index on every push.',
        path: 'data/sample/README.md',
      },
    ],
  },
  {
    id: 'definitions',
    label: 'Definitions',
    icon: SlidersHorizontal,
    summary:
      'A number is trustworthy when its arithmetic is visible. No metric in this project may exist as an unexplained dashboard measure, and the catalogue is a contract rather than documentation.',
    controls: [
      {
        control:
          'Every KPI states a formula, an explicit numerator and an explicit denominator',
        enforcement:
          'An additive measure records "n/a - additive measure" rather than leaving the denominator blank, so an omission is always deliberate and always visible.',
        path: 'KPI_CATALOG.md',
      },
      {
        control: 'Every KPI declares its null and zero-denominator behaviour',
        enforcement:
          'Each ratio is asserted to return NULL rather than zero or infinity on an empty denominator, per KPI, by the integration suite.',
        path: 'tests/integration/test_kpi_verification.py',
      },
      {
        control: 'Every fact declares one grain',
        enforcement:
          'The grain is enforced by a UNIQUE constraint in DDL and asserted by a schema test, so it is a property of the database.',
        path: 'sql/04_facts/',
      },
      {
        control: 'Averages and medians are published as a pair',
        enforcement:
          'Where a distribution is skewed the median is the headline and the mean is retained for reconciliation. Publishing only the mean is a defect in this project, not a stylistic choice.',
        path: 'KPI_CATALOG.md',
      },
    ],
  },
  {
    id: 'lineage',
    label: 'Lineage',
    icon: FileSearch,
    summary:
      'Every value can be traced from the generator that produced it to the measure that would report it, through a documented mapping at each hop.',
    controls: [
      {
        control: 'A source-to-target mapping exists per entity',
        enforcement:
          'Fourteen mapping documents record column-level transformation and the rule applied at each step.',
        path: 'docs/source-to-target/',
      },
      {
        control: 'Generation is deterministic and digest-verified',
        enforcement:
          'The same profile and seed reproduce byte-identical CSV, and the manifest records a SHA-256 digest per entity so a reviewer can confirm which bytes the tests ran against.',
        path: 'data/sample/generation_manifest.json',
      },
      {
        control: 'Every run records its own outcome',
        enforcement:
          'Pipeline runs, row counts, validation results, reconciliations and rejected records land in an audit schema and are reportable from the same governed layer as sales.',
        path: 'sql/00_database/03_audit_tables.sql',
      },
      {
        control: 'The reporting-view-to-KPI map is maintained as a document',
        enforcement:
          'Each KPI names the view that owns its SQL, and the static model check fails the build if the semantic model binds to a table outside the reporting schema.',
        path: 'powerbi/model_documentation/04-reporting-view-to-kpi-map.md',
      },
    ],
  },
  {
    id: 'proof',
    label: 'Proof',
    icon: ShieldCheck,
    summary:
      'Reconciliation is how the project proves its numbers rather than asserting them - and every critical rule has been observed failing, because a check that has never failed is a check nobody has tested.',
    controls: [
      {
        control: 'Reconciliations are recorded on every database run',
        enforcement:
          'Row-count chains, gross identities, funnel nesting bounds and marketing attribution are each reconciled with a declared tolerance, and the results are stored rather than printed.',
        path: 'sql/08_validation/',
      },
      {
        control: 'Every critical rule is proven to fail against a corrupted fixture',
        enforcement:
          'A negative test deliberately breaks the data and requires the reconciliation to catch it.',
        path: 'tests/integration/test_reconciliations.py',
      },
      {
        control: 'The semantic model is checked against its own specification',
        enforcement:
          'The TMDL is parsed as text and compared to the model documentation on every push. A bidirectional filter, a non-reporting schema or a PII-bearing column fails the build. No engine is launched, so this proves shape and never proves arithmetic.',
        path: 'scripts/check_powerbi_model.py',
      },
      {
        control: 'Static evidence is required to go stale',
        enforcement:
          'A hash over the model source is recorded with each real-engine result. When the TMDL changes afterwards the evidence is marked STALE and blocks the build, because a stale pass reads as validated while describing a model that no longer exists.',
        path: 'scripts/check_real_engine_validation.py',
      },
    ],
  },
  {
    id: 'access',
    label: 'Access',
    icon: Lock,
    summary:
      'The reporting identity can reach the reporting schema and provably nothing else, and no credential exists anywhere in the repository.',
    controls: [
      {
        control: 'Three roles with separated duties',
        enforcement:
          'arpi_admin owns objects, arpi_loader writes the pipeline layers, arpi_reporter reads reporting. Grants are re-applied as an ordered build step rather than set by hand.',
        path: 'sql/07_security/01_grants.sql',
      },
      {
        control: 'The reporter role is provably confined',
        enforcement:
          'A test attempts to read raw, staging, warehouse and audit as the reporter and requires each attempt to fail.',
        path: 'tests/integration/test_reporter_role_end_to_end.py',
      },
      {
        control: 'The database password is never read from a file',
        enforcement:
          'Configuration resolves it from an environment variable only. A password in a committed YAML profile would be ignored, not honoured.',
        path: 'src/arpi/config.py',
      },
      {
        control: 'Continuous integration needs no secret',
        enforcement:
          'The workflow runs to completion on a fork with zero repository secrets configured, and never contacts a cloud account, a hosted database or Power BI Service.',
        path: '.github/workflows/ci.yml',
      },
    ],
  },
]

export function TrustFramework() {
  const [activeId, setActiveId] = useState(LAYERS[0]!.id)
  const active = LAYERS.find((layer) => layer.id === activeId) ?? LAYERS[0]!

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
      {/* The layer selector. A radio group rather than tabs, because the panel is
          a sibling region rather than a tab panel and a radio group reads more
          accurately for "choose one of five". */}
      <div
        role="radiogroup"
        aria-label="Governance layers"
        className="flex gap-2 overflow-x-auto pb-1 lg:col-span-4 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {LAYERS.map((layer) => {
          const Icon = layer.icon
          const isActive = layer.id === activeId
          return (
            <button
              key={layer.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setActiveId(layer.id)}
              className={cx(
                buttonClass(isActive ? 'chipActive' : 'chip', 'md'),
                'shrink-0 justify-start gap-3 lg:w-full lg:px-4'
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
              <span className="flex flex-col items-start gap-0.5 text-left">
                <span className="text-sm font-semibold">{layer.label}</span>
                {/* No opacity: it dropped this line to 3.13:1 against the chip
                    ground. The chip's own colour already sets the hierarchy. */}
                <span className="hidden font-mono text-2xs lg:block">
                  {layer.controls.length} controls
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* The panel. `aria-live="polite"` so a keyboard user hears the layer they
          selected rather than only seeing it change. */}
      <div className="lg:col-span-8">
        <Card
          tone="sunken"
          padding="lg"
          className="flex flex-col gap-5"
          aria-live="polite"
          as="section"
        >
          <div className="flex flex-col gap-2">
            <Heading level={3} size="h4">
              {active.label}
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {active.summary}
            </Text>
          </div>

          <ul className="flex flex-col divide-y divide-line-subtle">
            {active.controls.map((control) => (
              <li
                key={control.control}
                className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-verified/50 bg-verified-wash font-mono text-2xs leading-none text-verified"
                  >
                    ✓
                  </span>
                  <p className="text-sm font-semibold text-ink">{control.control}</p>
                </div>
                <p className="pl-7 text-sm leading-relaxed text-ink-muted">
                  {control.enforcement}
                </p>
                <div className="pl-7">
                  <SourceLink path={control.path} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
