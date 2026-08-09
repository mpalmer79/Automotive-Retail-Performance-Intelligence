/**
 * The two unchunked accounting datasets, imported once for the routes that read them.
 *
 * WHY THIS IS NOT IN `data.ts`
 * ----------------------------
 * The rule `fi-data.ts`, `targets-data.ts` and `sales-gross-data.ts` follow: an import is a
 * graph edge, and `data.ts` is imported by every dashboard route. Only `/dashboard/accounting`
 * reads the exception set, and only it and `/dashboard` read the reconciliation set, so the
 * edges live in a module those routes import and no others do.
 *
 *   inventory-gl-reconciliation  18 kB, 43 rows, one file
 *   accounting-exceptions         2 kB,  4 rows, one file
 *
 * Both are unchunked on the measurement. The exception set has a second reason: its date
 * column is `exception_date`, the exception's OWN business date, so partitioning it would
 * key partitions by a third date semantic — the same reason `fi-adjustment-summary` is
 * unchunked.
 *
 * WHY THE EXECUTIVE PAGE MAY IMPORT THE RECONCILIATION SET AND NOTHING ELSE
 * -------------------------------------------------------------------------
 * `/dashboard` renders one reconciliation figure. 43 rows and 18 kB is the whole comparison
 * surface, so the narrow set IS the summary and no second aggregate needs inventing — which
 * would have meant a second KPI formula. The two unit-grain doors, `inventory-chunks.ts` and
 * `accounting-chunks.ts`, carry 356 kB and 360 kB of per-vehicle detail and are exactly what
 * `/dashboard` must not acquire. `tests/unit/dashboard-boundaries.test.ts` asserts that.
 *
 * SERVER ONLY, like every module that touches the generated tree.
 */
import type { DashboardDatasetFile, DashboardRow } from '@/types/dashboard'

import exceptionsFile from '@/generated/dashboard/datasets/accounting-exceptions.json'
import reconciliationFile from '@/generated/dashboard/datasets/inventory-gl-reconciliation.json'

import { decodeDataset } from './data'

/**
 * Every store × control account × comparison-date position.
 *
 * COMPARISON-DATE basis, and the balances are SEMI-ADDITIVE: additive across stores and
 * accounts on one date, never across dates. A period figure is the last comparable date in
 * the period, not a sum or an average of them.
 *
 * Both balance columns are nullable and that is the point of the dataset: where one side is
 * absent the variance is null and `comparison_state` says which side is missing. Nothing may
 * coalesce either to zero.
 */
export function glReconciliationRows(): readonly DashboardRow[] {
  return decodeDataset(
    'inventory-gl-reconciliation',
    reconciliationFile as unknown as DashboardDatasetFile
  )
}

/**
 * Every accounting exception, on the EXCEPTION-DATE basis.
 *
 * The rows are not one kind of thing. Valid-but-unreconciled positions, missing-side control
 * states and structural integrity findings all live here, and a count that adds them together
 * and calls itself "total accounting errors" is analytically wrong.
 */
export function accountingExceptionRows(): readonly DashboardRow[] {
  return decodeDataset(
    'accounting-exceptions',
    exceptionsFile as unknown as DashboardDatasetFile
  )
}
