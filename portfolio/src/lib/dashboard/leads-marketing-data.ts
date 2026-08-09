/**
 * The data door for `/dashboard/leads-marketing`, and nothing else reads it.
 *
 * WHY THIS EXISTS RATHER THAN SIX MORE LINES IN `data.ts`
 * -------------------------------------------------------
 * `data.ts` is imported by every console route, so every import inside it is an edge in
 * every route's server graph — the bundler inlines the file whether or not anything reads
 * a field from it. This route needs `marketing-performance` (79 kB), `campaigns` (4 kB) and
 * three partitioned datasets totalling 951 kB. Putting any of that in `data.ts` would hand
 * `/dashboard`, `/dashboard/deals` and five other pages a megabyte of BDC detail they have
 * no business holding, which is the shape `fi-data.ts`, `accounting-data.ts`,
 * `sales-gross-data.ts` and `inventory-chunks.ts` were each split out to avoid.
 *
 * `data.ts`'s own comment already anticipated this one: it records that
 * `marketing-performance` and `appointment-funnel` "arrive with the pages that need them —
 * … the leads and marketing page". This is that page's arrival.
 *
 * WHAT IT DOES AND DOES NOT DO
 * ----------------------------
 * It decodes files and SELECTS rows. It adds nothing up. Every aggregation this route
 * performs is declared in `leads-marketing.ts` against the export's governed columns, for
 * the reason ADR-0013 condition 2 gives: a helper here that happened to sum a column would
 * be the first step toward a second KPI engine.
 *
 * ONE CACHE KEY PER PHYSICAL FILE
 * -------------------------------
 * Every `decodeDataset` call below is passed a key prefixed with the dataset name and
 * suffixed with the partition, because a partitioned dataset needs one key per partition and
 * not one per dataset. The failure mode is not theoretical and not loud: every partition has
 * the same columns and the same shape, so a shared key returns the FIRST partition's rows for
 * every store and month, and the result looks entirely reasonable — right columns, plausible
 * counts, wrong store. That defect shipped twice in this project. `decodeDataset` throws on a
 * collision now, and `leads-marketing.test.ts` asserts these five datasets cannot share one.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import campaignsFile from '@/generated/dashboard/datasets/campaigns.json'
import marketingFile from '@/generated/dashboard/datasets/marketing-performance.json'

import { decodeDataset } from './data'
import {
  appointmentSourceChunkFile,
  leadStageLossChunkFile,
  responseDistributionChunkFile,
} from './leads-marketing-chunks'

/* -------------------------------------------------------------------------- */
/* Whole-file datasets                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Marketing spend and attributed outcomes at store x month x source x campaign.
 *
 * MONTH GRAIN IS STRUCTURAL, not a convention this module could relax. The view joins the
 * calendar on the FIRST DAY of the month, so filtering to any other date returns no rows at
 * all — a day-grain cost-per-lead cannot be produced from this dataset even by mistake.
 *
 * `spend_amount` is null, never zero, for an organic or internal source, and every cost
 * measure on such a row is null by rule rather than by absence of data. Nothing here may
 * coalesce either.
 */
export function marketingPerformanceRows(): readonly DashboardRow[] {
  return decodeDataset(
    'marketing-performance',
    marketingFile as unknown as DashboardDatasetFile
  )
}

/**
 * The campaign dimension: name, channel, vendor, target department and vehicle category.
 *
 * `target_vehicle_category` states the campaign's INTENT. It does not assert that every lead
 * the campaign generated belongs to that segment, and off-target activity is modelled
 * behaviour rather than a data-quality defect.
 */
export function campaignRows(): readonly DashboardRow[] {
  return decodeDataset('campaigns', campaignsFile as unknown as DashboardDatasetFile)
}

/* -------------------------------------------------------------------------- */
/* Partitioned datasets                                                        */
/* -------------------------------------------------------------------------- */

function collect(
  dataset: string,
  reader: (store: string, month: string) => DashboardDatasetFile | undefined,
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = reader(store, month)
      if (file === undefined) continue
      rows.push(...decodeDataset(`${dataset}/${store}/${month}`, file))
    }
  }
  return rows
}

/**
 * Appointment measures cut by the source and campaign of the originating lead.
 *
 * APPOINTMENT GRAIN. One lead can produce several appointments, so these denominators are
 * not the lead-funnel denominators and the two must never share a funnel width.
 *
 * Two date bases travel on one `appointment_date` column: the show-rate columns are on the
 * SCHEDULED date, the conversion columns on the SHOW date. Reading a month of partitions
 * therefore collects rows on both bases, which is correct — each column knows which basis it
 * belongs to — and is why `leads-marketing.ts` never sums across the two.
 */
export function appointmentSourceRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  return collect('appointment-source-funnel', appointmentSourceChunkFile, stores, months)
}

/**
 * The lead cohort partitioned by furthest modelled stage reached.
 *
 * Diagnostics, not KPIs. The five stage columns sum exactly to `leads_received`;
 * `sold_without_modelled_showroom_visit` is an overlay on the first three and must never be
 * added to them.
 */
export function leadStageLossRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  return collect('lead-stage-loss', leadStageLossChunkFile, stores, months)
}

/**
 * The first-response population, as counted histogram bins.
 *
 * These are BINS, not leads. A row with `lead_count` 1 is still a bin, and nothing may render
 * one as a lead: the dataset carries no lead key, lead code, customer, employee, sale or
 * vehicle, and this route is not a CRM screen.
 *
 * `first_response_seconds` null is the NEVER-RESPONDED bin. It must be excluded from any
 * order statistic and must never be coalesced to zero — doing so would sort the ignored leads
 * to the fastest end of the distribution and improve the median, which is precisely the
 * failure this shape exists to make impossible to hide.
 */
export function responseDistributionRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  return collect(
    'lead-response-distribution',
    responseDistributionChunkFile,
    stores,
    months
  )
}
