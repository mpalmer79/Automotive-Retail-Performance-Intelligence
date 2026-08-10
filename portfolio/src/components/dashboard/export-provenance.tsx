import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/typography'
import type { ExportTrust, PowerBiTrust } from '@/lib/dashboard/trust'
import { formatIsoDate } from '@/lib/dashboard/format'
import { technicalHref } from '@/lib/technical'

/**
 * The provenance of the figures on an operating route, collapsed behind
 * methodology.
 *
 * WHERE THE THREE HEADER BADGES WENT
 * ----------------------------------
 * Every operating route opened with the same three: a dataset version, an export
 * as-of date, and the real-engine validation state. They were the first three
 * visual elements on eight screens, above the figures.
 *
 * All three are true and all three are still rendered — here, inside the control
 * band's `methodology` disclosure, on every operating route. `<details>` keeps
 * them in the accessibility tree's reading order, in a browser text search, in the
 * printed page and in the no-JavaScript rendering, so this is a change of position
 * rather than of disclosure. The reasoning is ADR-0015: a general manager opening
 * a dashboard is not asking what version of a contract produced it, and putting
 * that question first made the engineering a toll gate on the business.
 *
 * The real-engine clause is DERIVED from the manifest, never authored. If an
 * accepted validation path ever records a current pass, this stops saying pending
 * on every route at once, and no string here can be edited to say so early.
 */
export function ExportProvenance({
  exportState,
  powerBi,
  asOf,
}: {
  readonly exportState: ExportTrust
  readonly powerBi: PowerBiTrust
  /** The route's own as-of date, where it differs from the export's. */
  readonly asOf?: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" mono>
          Dataset v{exportState.datasetVersion} &middot; {exportState.profile}
        </Badge>
        <Badge tone="neutral" mono>
          As of {formatIsoDate(asOf ?? exportState.asOfDate)}
        </Badge>
        <Badge tone={powerBi.validated ? 'verified' : 'pending'}>
          {powerBi.validated
            ? 'Real-engine validation recorded'
            : 'Real-engine validation pending'}
        </Badge>
      </div>
      <Text size="xs" tone="faint">
        {powerBi.claim}
      </Text>
      <Text size="xs" tone="faint">
        <Link
          href={technicalHref('status')}
          className="underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          The evidence behind both statements
        </Link>
      </Text>
    </div>
  )
}
