/**
 * The two unchunked F&I datasets, imported once for the one route that reads them.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * The rule `targets-data.ts` and `sales-gross-data.ts` follow: an import is a graph edge,
 * and `data.ts` is imported by every dashboard route. Only `/dashboard/fi` reads the F&I
 * production summary and the adjustment summary, so the edge lives in a module only that
 * route imports.
 *
 *   fi-summary             79 kB, 354 rows, one file
 *   fi-adjustment-summary  15 kB,  57 rows, one file
 *
 * Both are unchunked on the measurement, and the adjustment summary for a second reason:
 * its first date column is the ADJUSTMENT date, so partitioning it would key partitions by
 * a different month than every other partition in the console.
 *
 * THE TWO DATASETS ARE ON DIFFERENT DATE BASES AND ARE NEVER JOINED HERE
 * ---------------------------------------------------------------------
 * `fi-summary` is on the sale date. `fi-adjustment-summary` is on the adjustment date. A
 * module that quietly joined them would produce exactly the silent blend the F&I model
 * exists to prevent: an August chargeback restated into the June the contract was written
 * in. They are returned separately and the selectors keep them apart.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import adjustmentFile from '@/generated/dashboard/datasets/fi-adjustment-summary.json'
import summaryFile from '@/generated/dashboard/datasets/fi-summary.json'

import { decodeDataset } from './data'

/**
 * Every store-day-manager row of F&I production.
 *
 * SALE-DATE basis. Carries finance reserve and retail units and NO product category,
 * because both are properties of a deal and a category column would repeat them.
 */
export function fiSummaryRows(): readonly DashboardRow[] {
  return decodeDataset('fi-summary', summaryFile as unknown as DashboardDatasetFile)
}

/**
 * Every adjustment event group, on the ADJUSTMENT-DATE basis.
 *
 * An August chargeback against a June contract is an August row. Nothing in this console
 * may restate it into June.
 */
export function fiAdjustmentRows(): readonly DashboardRow[] {
  return decodeDataset(
    'fi-adjustment-summary',
    adjustmentFile as unknown as DashboardDatasetFile
  )
}
