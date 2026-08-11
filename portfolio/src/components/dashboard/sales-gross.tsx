/**
 * Gross composition, in brief: where the money came from, and what the mix was.
 *
 * TWO PART-TO-WHOLE READINGS, AND NOTHING ELSE
 * --------------------------------------------
 * "Where did the gross come from" and "what is the unit mix" are share questions, and a
 * share question answered by two numbers side by side makes the reader do the division. So
 * front against back, and new against used, each drawn against its own governed total.
 *
 * THE FRONT PVR CARD LEFT THIS MODULE IN `UX.2A` AND DID NOT LEAVE THE PAGE. It is on the
 * KPI rail now, beside back PVR, which is where the pair belongs: a reader watching back
 * PVR alone cannot tell a finance office that is performing from a front end that has
 * collapsed underneath it. A module about composition does not also need to carry a rate.
 *
 * WHY THERE IS NO RESERVE-AND-PRODUCT SPLIT HERE
 * ----------------------------------------------
 * `UX.2A` §12 offers it "where the Executive grain permits it", and it does not. Finance
 * reserve and product gross are published by `fi-summary`, which this route does not open
 * and `dashboard-boundaries.test.ts` forbids it from opening — and they arrive on their own
 * date bases (`deal_date_basis`, `net_gross_date_basis`), which are not the sale date the
 * gross summary above is aggregated on. Drawing all four as one stack would put two date
 * semantics inside one bar. `/dashboard/fi` owns the split and states both bases.
 *
 * THE DENOMINATORS ARE GOVERNED TOTALS, NOT SUMS OF THE SEGMENTS
 * --------------------------------------------------------------
 * Total gross and retail units come from their own selectors and are handed to the
 * primitives as denominators. Neither is PRINTED here: both are already on the rail above,
 * and a console that shows the same figure twice on one screen invites a reader to check
 * whether the two agree. A component may not add the segments together to find the whole in
 * any case — `dashboard-boundaries.test.ts` forbids exact arithmetic in a component, and
 * that rule is what keeps this honest rather than merely tidy.
 *
 * NO SHARE PERCENTAGE IS PRINTED, AND THE ABSENCE IS CORRECT. A back-gross share of total
 * is a ratio, and every ratio on this console comes from a governed selector with a
 * catalogue entry behind it. There is no such KPI, and dividing two exported columns here
 * to produce one would be the console defining a measure — exactly what ADR-0013 condition
 * 2 forbids. The bar shows the proportion, the amounts are printed, and
 * `/dashboard/sales-gross` — which owns the contribution analysis and computes the share in
 * its own view model — is one link away.
 *
 * Server component.
 */
import type { SalesGrossSummary } from '@/lib/dashboard/executive'
import type { ComparedMetric } from '@/lib/dashboard/selectors'

import { formatMetric } from './metric'
import { GrossComposition, type CompositionSegment } from './visuals'

export function SalesAndGross({ salesGross }: { salesGross: SalesGrossSummary }) {
  return (
    <div className="flex flex-col gap-5">
      <GrossComposition
        title="Front and back gross"
        segments={segmentsOf([
          ['front', 'Front-end gross', salesGross.frontGross],
          ['back', 'Back-end gross', salesGross.backGross],
        ])}
        total={
          salesGross.totalGross.current.kind === 'value'
            ? salesGross.totalGross.current.value
            : null
        }
        shareDisclosure="Front and back are published separately and are not ranked against each other. A store can hold total gross steady while front collapses and the finance office compensates, and which of those is preferable depends on the store rather than on the figure. The contribution share is computed on the sales and gross page, which owns it, and the reserve-and-product split is on the F&I page, which owns that."
        headingLevel={3}
      />

      <GrossComposition
        title="New and used mix"
        segments={segmentsOf([
          ['new', 'New units', salesGross.newUnits],
          ['used', 'Used units', salesGross.usedUnits],
        ])}
        total={
          salesGross.retailUnits.current.kind === 'value'
            ? salesGross.retailUnits.current.value
            : null
        }
        shareDisclosure="The independent pre-owned store contributes no new units, and its scoreboard cell says so in words rather than with a zero. Wholesale disposals and dealer trades are excluded from every retail figure on this page, per KPI-SLS-001: the export publishes all-types totals as separate columns and this console never mixes the two."
        headingLevel={3}
      />
    </div>
  )
}

/**
 * Turn compared metrics into drawable segments, dropping any the scope did not resolve.
 *
 * A segment whose metric is `no-rows` or `null-ratio` is omitted rather than drawn at zero,
 * for the same reason the comparison bars omit a structural absence: a zero-width slice and
 * an unresolved measure look identical, and only one of them is a measurement.
 */
function segmentsOf(
  entries: readonly (readonly [string, string, ComparedMetric])[]
): readonly CompositionSegment[] {
  const segments: CompositionSegment[] = []
  for (const [key, label, metric] of entries) {
    if (metric.current.kind !== 'value') continue
    const display = formatMetric(metric.selector, metric.current)
    if (display === null) continue
    segments.push({ key, label, value: metric.current.value, display })
  }
  return segments
}
